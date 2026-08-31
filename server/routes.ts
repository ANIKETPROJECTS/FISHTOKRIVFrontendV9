import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { normalizePreorderMode } from "../shared/productVisibility";
import { isPreorderDateAvailable, isPreorderDateAvailableForAll, normalizePreorderAvailability } from "../shared/preorderAvailability";
import passport from "passport";
import { setupAuth } from "./auth";
import { connectOrdersDb, generateOrderId, getOrderModel, getPendingCheckoutModel } from "./ordersDb";
import { setImage, getImage, deleteImage } from "./imageStore";
import { insertCarouselSlideSchema, insertCategorySchema, insertSectionSchema, insertComboSchema, insertCustomerAddressSchema, updateCustomerSchema, insertInventoryBatchSchema } from "@shared/schema";
import { SuperHubModel, SubHubModel, OtpModel } from "./adminDb";
import { getHubModels } from "./hubConnections";
import { CustomerDbModel } from "./customerDb";
import { computeExpiryDate, computeRemainingTime } from "./inventorySync";
import Razorpay from "razorpay";
import { createHmac } from "crypto";
import {
  buildSuccessfulRazorpayPaymentState,
  isFtwStorefrontOrder,
  isSuccessfulRazorpayStatus,
} from "./razorpayPayment";

declare module "express-session" {
  interface SessionData {
    customerPhone?: string;
  }
}

const OTP_TTL_MS = 5 * 60 * 1000;
const INDIA_TIME_ZONE = "Asia/Kolkata";

function getIndiaDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getIndiaMinutesSinceMidnight(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: INDIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function parseTimeslotStartMinutes(timeslot: any): number | null {
  const source = String(timeslot.startTime ?? timeslot.label ?? "").trim();
  const match = source.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const period = match[3]?.toUpperCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return null;
  if (period === "AM" && hour === 12) hour = 0;
  if (period === "PM" && hour !== 12) hour += 12;
  if (hour > 23) return null;
  return hour * 60 + minute;
}

async function validateTimeslotBeforeCheckout(params: {
  hubDbName?: string | null;
  timeslotId?: string | null;
  deliveryDate?: string | null;
  scheduleType?: string | null;
}): Promise<string | null> {
  if (!params.hubDbName || !params.timeslotId || params.scheduleType === "instant") return null;

  const hub = await getHubModels(params.hubDbName);
  const timeslot = await hub.Timeslot.findById(params.timeslotId).lean() as any;
  if (!timeslot || timeslot.isActive === false) {
    return "This delivery time slot is no longer available.";
  }

  const dateKey = params.deliveryDate ?? getIndiaDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "Please choose a valid delivery date.";
  const date = new Date(`${dateKey}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateKey) {
    return "Please choose a valid delivery date.";
  }
  if (dateKey < getIndiaDateKey()) return "Delivery date cannot be in the past.";

  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayConfig = (timeslot.activeDays ?? []).find(
    (entry: any) => String(entry.day).toLowerCase() === dayNames[date.getUTCDay()],
  );
  if (dayConfig?.status === "off") {
    return "This time slot is disabled for the selected date.";
  }

  // The browser removes today's slots 30 minutes before their start time.
  // Repeat that check here so stale tabs cannot submit an old selection.
  if (dateKey === getIndiaDateKey()) {
    const startMinutes = parseTimeslotStartMinutes(timeslot);
    if (startMinutes !== null && getIndiaMinutesSinceMidnight() >= startMinutes - 30) {
      return "This delivery time slot has closed for today. Please choose another slot.";
    }
  }

  const todayKey = getIndiaDateKey();
  const tomorrowDate = new Date(`${todayKey}T00:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowKey = tomorrowDate.toISOString().slice(0, 10);
  if (timeslot.orderLimit > 0 && dateKey === todayKey &&
      (timeslot.todaysOrderCount ?? 0) >= timeslot.orderLimit) {
    return "This time slot is full for today.";
  }
  if (timeslot.orderLimit > 0 && dateKey === tomorrowKey &&
      (timeslot.nextDayOrderCount ?? 0) >= timeslot.orderLimit) {
    return "This time slot is full for the selected date.";
  }

  return null;
}

// ── Admark WhatsApp helper ────────────────────────────────────────────────
const ADMARK_API_URL = "https://verifiedwhatsapp.admarksolution.com/api/send/bytemplate";

async function sendWhatsApp(templateName: string, phone: string, csvVariables: string[]) {
  const apiKey = process.env.ADMARK_API_KEY;
  const phoneNumberId = process.env.ADMARK_PHONE_NUMBER_ID;
  if (!apiKey || !phoneNumberId) {
    console.warn("[WhatsApp] ADMARK_API_KEY or ADMARK_PHONE_NUMBER_ID not set — skipping");
    return;
  }
  const destination = `91${phone}`;
  try {
    const params = new URLSearchParams({
      "api-key": apiKey,
      templateName,
      phoneNumber: destination,
      phoneNumberId,
      csvVariables: csvVariables.join(","),
    });
    const res = await fetch(`${ADMARK_API_URL}?${params.toString()}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    const text = await res.text();
    if (!res.ok) console.error(`[WhatsApp] ${templateName} failed ${res.status}:`, text);
    else console.log(`[WhatsApp] ${templateName} → ${destination}`);
  } catch (err) {
    console.error(`[WhatsApp] ${templateName} error:`, err);
  }
}

// ── Coupon lifecycle helpers ──────────────────────────────────────────────
// These helpers keep activeCoupons and usedCoupons in sync with order lifecycle.

async function addActiveCoupon(
  phone: string,
  couponId: string,
  couponCode: string,
  couponTitle: string,
  subHubId: string,
  orderId: string
) {
  const result = await CustomerDbModel.updateOne(
    { phone, "activeCoupons.couponId": couponId },
    {
      $inc: { "activeCoupons.$.usedCount": 1 },
      $addToSet: { "activeCoupons.$.orderIds": orderId },
    }
  );
  if (result.matchedCount === 0) {
    await CustomerDbModel.updateOne(
      { phone },
      {
        $push: {
          activeCoupons: {
            couponId,
            couponCode,
            couponTitle,
            subHubId,
            usedCount: 1,
            orderIds: [orderId],
            appliedAt: new Date(),
          },
        },
      }
    );
  }
}

async function removeActiveCoupon(phone: string, couponId: string, orderId: string) {
  await CustomerDbModel.updateOne(
    { phone, "activeCoupons.couponId": couponId },
    { $inc: { "activeCoupons.$.usedCount": -1 } }
  );
  await (CustomerDbModel as any).updateOne(
    { phone },
    { $pull: { "activeCoupons.$[elem].orderIds": orderId } },
    { arrayFilters: [{ "elem.couponId": couponId }] }
  );
  await CustomerDbModel.updateOne(
    { phone },
    { $pull: { activeCoupons: { couponId, usedCount: { $lte: 0 } } } }
  );
}

async function addDeliveredCoupon(
  phone: string,
  couponId: string,
  couponCode: string,
  couponTitle: string,
  subHubId: string,
  orderId: string
) {
  await CustomerDbModel.updateOne(
    { phone },
    {
      $push: {
        usedCoupons: {
          couponId,
          couponCode,
          couponTitle,
          orderId,
          subHubId,
          usedAt: new Date(),
        },
      },
    }
  );
}

async function removeDeliveredCoupon(phone: string, couponId: string, orderId: string) {
  await CustomerDbModel.updateOne(
    { phone },
    { $pull: { usedCoupons: { couponId, orderId } } }
  );
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await connectOrdersDb();
  setupAuth(app);

  const requireAuth = (req: any, res: any, next: any) => {
    if (req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ message: "Unauthorized" });
  };

  // Auth routes
  app.post(api.auth.login.path, passport.authenticate("local"), (req, res) => {
    const user = req.user as any;
    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  });

  app.post(api.auth.logout.path, (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ message: "Logged out successfully" });
    });
  });

  app.get(api.auth.me.path, (req, res) => {
    if (req.isAuthenticated()) {
      const user = req.user as any;
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } else {
      res.status(401).json({ message: "Unauthorized" });
    }
  });

  // ── Hub discovery routes ────────────────────────────────────────────────
  app.get("/api/hubs/super", async (_req, res) => {
    try {
      const hubs = await SuperHubModel.find({ status: "Active" }).lean();
      res.json(hubs.map((h: any) => ({
        id: h._id.toString(),
        name: h.name,
        location: h.location ?? null,
        imageUrl: h.imageUrl ?? null,
      })));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch super hubs" });
    }
  });

  app.get("/api/hubs/sub", async (req, res) => {
    try {
      const { superHubId } = req.query;
      const filter: any = { status: "Active" };
      if (superHubId) filter.superHubId = superHubId;
      const hubs = await SubHubModel.find(filter).lean();
      const response = await Promise.all(hubs.map(async (h: any) => {
        let pincodes = h.pincodes ?? [];
        // Imported hubs may store pincode delay/charge records in the hub DB
        // rather than the admin SubHub document. Prefer the admin config, but
        // transparently use the hub-local collection when it is empty.
        if (pincodes.length === 0 && h.dbName) {
          try {
            const hub = await getHubModels(h.dbName);
            pincodes = await hub.Pincode.find({ isActive: { $ne: false } }).lean();
          } catch (err) {
            console.warn(`[hubs/sub] Could not read legacy pincodes for ${h.dbName}:`, err);
          }
        }
        return ({
        id: h._id.toString(),
        superHubId: h.superHubId?.toString() ?? null,
        name: h.name,
        location: h.location ?? null,
        imageUrl: h.imageUrl ?? null,
        dbName: h.dbName,
        pincodes: pincodes.map((p: any) =>
          typeof p === "string"
            ? { pincode: p, charge: 0, timeDelay: 0 }
            : { pincode: p.pincode, charge: p.charge ?? 0, timeDelay: p.timeDelay ?? 0 }
        ),
      });
      }));
      res.json(response);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch sub hubs" });
    }
  });

  // Helper: get hub models for the dbName in the X-Hub-DB header
  const getReqHubModels = async (req: any) => {
    const dbName = req.headers["x-hub-db"] as string | undefined;
    if (dbName) return getHubModels(dbName);
    return null;
  };

  // ── Inline mappers ──────────────────────────────────────────────────────
  const toProduct = (doc: any) => {
    const now = new Date();

    // Internal inventory batches (managed by this app)
    const allInvBatches: any[] = doc.inventoryBatches ?? [];
    const activeInvBatches = allInvBatches.filter((b: any) => {
      if (b.remainingTime === "expired") return false;
      if (b.expiryDate && new Date(b.expiryDate) <= now) return false;
      return true;
    });

    // External admin batches (stored in the `batches` field by the separate admin system)
    const allExtBatches: any[] = doc.batches ?? [];
    const activeExtBatches = allExtBatches.filter((b: any) => {
      if (b.expiryDate && new Date(b.expiryDate) <= now) return false;
      return true;
    });

    const hasAnyBatches = allInvBatches.length > 0 || allExtBatches.length > 0;
    const hasActiveBatches = activeInvBatches.length > 0 || activeExtBatches.length > 0;

    // If product has batches and ALL are expired, mark as unavailable
    const batchExpired = hasAnyBatches && !hasActiveBatches;
    const effectiveStatus = batchExpired ? "unavailable" : doc.status;

    // Available quantity: sum active batches from both systems; fall back to doc.quantity if no batches
    const availableQty = hasAnyBatches
      ? activeInvBatches.reduce((sum: number, b: any) => sum + (b.quantity ?? 0), 0)
        + activeExtBatches.reduce((sum: number, b: any) => sum + (b.quantity ?? 0), 0)
      : (doc.quantity != null ? doc.quantity : null);
    return {
      id: doc._id.toString(), name: doc.name, category: doc.category,
      subCategory: doc.subCategory ?? null, status: effectiveStatus,
      limitedStockNote: doc.limitedStockNote ?? null, price: doc.price ?? null,
      originalPrice: doc.originalPrice ?? null, unit: doc.unit ?? null,
      imageUrl: doc.imageUrl ?? null, isArchived: doc.isArchived ?? false,
      updatedAt: doc.updatedAt, sectionId: doc.sectionId ?? null,
      description: doc.description ?? null,
      grossWeight: doc.grossWeight ?? null, netWeight: doc.netWeight ?? null,
      pieces: doc.pieces ?? null, serves: doc.serves ?? null,
      discountPct: doc.discountPct ?? null, quantity: doc.quantity ?? null,
      availableQty, batchExpired,
      // The external admin has used both spellings over time; normalize them
      // into the single storefront field while treating missing values as normal.
      preorderMode: normalizePreorderMode(doc.preorderMode ?? doc.preOrderMode),
      preorderAvailability: normalizePreorderAvailability(doc.preorderAvailability),
      couponIds: (doc.couponIds ?? []).map((id: any) => id.toString()),
      recipes: (doc.recipes ?? []).map((r: any) => ({
        title: r.title ?? "", description: r.description ?? "",
        image: r.image ?? "", totalTime: r.totalTime ?? "",
        prepTime: r.prepTime ?? "", cookTime: r.cookTime ?? "",
        servings: r.servings ?? 2, difficulty: r.difficulty ?? "Medium",
        ingredients: (r.ingredients ?? []).map((i: any) => String(i)),
        method: (r.method ?? []).map((m: any) => String(m)),
      })),
    };
  };

  const toCoupon = (doc: any) => ({
    id: doc._id.toString(), code: doc.code, title: doc.title,
    description: doc.description, type: doc.type, discountValue: doc.discountValue,
    minOrderAmount: doc.minOrderAmount ?? 0, maxUsage: doc.maxUsage ?? null,
    isFirstTimeOnly: doc.isFirstTimeOnly ?? false,
    isActive: doc.isActive ?? true, applicableCategories: doc.applicableCategories ?? [],
    expiresAt: doc.expiresAt ?? null, color: doc.color ?? "",
    visibleOnWebsite: doc.visibleOnWebsite ?? true,
    applicableCustomers: (doc.applicableCustomers ?? []).map((id: any) => id.toString()),
    createdAt: doc.createdAt, updatedAt: doc.updatedAt,
  });
  const toSection = (doc: any) => ({
    id: doc._id.toString(), title: doc.title, type: doc.type ?? "products",
    sortOrder: doc.sortOrder ?? 0, isActive: doc.isActive ?? true,
  });
  const toCategory = (doc: any) => ({
    id: doc._id.toString(), name: doc.name, imageUrl: doc.imageUrl ?? null,
    sortOrder: doc.sortOrder ?? 0, isActive: doc.isActive ?? true,
    subCategories: (doc.subCategories ?? []).map((s: any) => ({ name: s.name, imageUrl: s.imageUrl ?? null })),
  });
  const toCarousel = (doc: any) => ({
    id: doc._id.toString(), imageUrl: doc.imageUrl, title: doc.title ?? null,
    linkUrl: doc.linkUrl ?? null, order: doc.order ?? 0, isActive: doc.isActive ?? true,
  });
  const toCombo = (doc: any) => ({
    id: doc._id.toString(), name: doc.name, description: doc.description ?? null,
    fullDescription: doc.fullDescription ?? null, serves: doc.serves ?? null,
    weight: doc.weight ?? null, discountedPrice: doc.discountedPrice,
    originalPrice: doc.originalPrice, discount: doc.discount ?? 0,
    includes: (doc.includes ?? []).map((i: any) => ({ productId: i.productId, label: i.label })),
    tags: doc.tags ?? [], nutrition: (doc.nutrition ?? []).map((n: any) => ({ label: n.label, value: n.value, icon: n.icon ?? "" })),
    isActive: doc.isActive ?? true, sortOrder: doc.sortOrder ?? 0,
  });

  // Products routes
  app.get(api.products.list.path, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Product.find({
      isArchived: { $ne: true },
      quantity: { $ne: 0 },
    }).lean();
    res.json(docs.map(toProduct));
  });

  app.post(api.products.create.path, requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = api.products.create.input.parse(req.body);
      const doc = await hub.Product.create({ ...input, status: input.status ?? "available", updatedAt: new Date() });
      res.status(201).json(toProduct(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch(api.products.update.path, requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = api.products.update.input.parse(req.body);
      const doc = await hub.Product.findByIdAndUpdate(
        req.params.id,
        { ...input, updatedAt: new Date() },
        { new: true }
      ).lean();
      if (!doc) return res.status(404).json({ message: "Product not found" });
      res.json(toProduct(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post(api.products.bulkUpdateStatus.path, requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const { category, status } = api.products.bulkUpdateStatus.input.parse(req.body);
      await hub.Product.updateMany({ category }, { status, updatedAt: new Date() });
      res.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete(api.products.delete.path, requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (hub) {
      await hub.Product.findByIdAndUpdate(req.params.id, { isArchived: true });
    }
    deleteImage(req.params.id);
    res.status(204).end();
  });

  // Image upload (in-memory)
  app.post("/api/products/:id/image", requireAuth, async (req: any, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", async () => {
      const buffer = Buffer.concat(chunks);
      const mimeType = req.headers["content-type"] || "image/jpeg";
      const id = req.params.id;
      setImage(id, buffer, mimeType);
      const imageUrl = `/api/products/${id}/image`;
      const hub = await getReqHubModels(req);
      if (hub) {
        await hub.Product.findByIdAndUpdate(id, { imageUrl, updatedAt: new Date() });
      }
      res.json({ imageUrl });
    });
    req.on("error", () => res.status(500).json({ message: "Upload failed" }));
  });

  // Image serve (from in-memory)
  app.get("/api/products/:id/image", (req, res) => {
    const img = getImage(req.params.id);
    if (!img) return res.status(404).end();
    res.setHeader("Content-Type", img.mimeType);
    res.setHeader("Cache-Control", "public, max-age=604800, stale-while-revalidate=86400");
    res.setHeader("ETag", `"${req.params.id}"`);
    if (req.headers["if-none-match"] === `"${req.params.id}"`) {
      return res.status(304).end();
    }
    res.send(img.data);
  });

  // Inventory batch routes
  const toBatch = (b: any) => ({
    id: b._id.toString(),
    quantity: b.quantity,
    shelfLifeDays: b.shelfLifeDays,
    entryDate: b.entryDate,
    expiryDate: b.expiryDate ?? null,
    remainingTime: b.remainingTime ?? null,
  });

  app.get("/api/products/:id/batches", requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.status(400).json({ message: "No hub selected" });
    const doc = await hub.Product.findById(req.params.id).lean() as any;
    if (!doc) return res.status(404).json({ message: "Product not found" });
    const batches = ((doc.inventoryBatches ?? []) as any[])
      .sort((a: any, b: any) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
    res.json(batches.map(toBatch));
  });

  app.post("/api/products/:id/batches", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertInventoryBatchSchema.parse(req.body);
      const doc = await hub.Product.findById(req.params.id).lean() as any;
      if (!doc) return res.status(404).json({ message: "Product not found" });
      const entryDate = new Date();
      const expiryDate = computeExpiryDate(entryDate, input.shelfLifeDays);
      const remainingTime = computeRemainingTime(expiryDate);
      const newBatch = { quantity: input.quantity, shelfLifeDays: input.shelfLifeDays, entryDate, expiryDate, remainingTime };
      const updatedDoc = await hub.Product.findByIdAndUpdate(
        req.params.id,
        {
          $push: { inventoryBatches: newBatch },
          $inc: { quantity: input.quantity },
          updatedAt: new Date(),
        },
        { new: true }
      ).lean() as any;
      const addedBatch = updatedDoc.inventoryBatches[updatedDoc.inventoryBatches.length - 1];
      res.status(201).json(toBatch(addedBatch));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/products/:id/batches/:batchId", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const doc = await hub.Product.findById(req.params.id).lean() as any;
      if (!doc) return res.status(404).json({ message: "Product not found" });
      const batch = (doc.inventoryBatches ?? []).find((b: any) => b._id.toString() === req.params.batchId) as any;
      if (!batch) return res.status(404).json({ message: "Batch not found" });
      await hub.Product.findByIdAndUpdate(
        req.params.id,
        {
          $pull: { inventoryBatches: { _id: batch._id } },
          $inc: { quantity: -batch.quantity },
          updatedAt: new Date(),
        }
      );
      res.status(204).end();
    } catch (err) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Razorpay Payment Routes ──────────────────────────────────────────────
  const razorpay = (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;

  if (!razorpay) {
    console.warn("[Razorpay] RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set — payment routes disabled");
  }

  const fetchVerifiedRazorpayPayment = async (
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ) => {
    if (!razorpay) {
      throw new Error("Payment service not configured");
    }
    const payment = await (razorpay as any).payments.fetch(razorpayPaymentId);
    if (
      payment.order_id !== razorpayOrderId ||
      !isSuccessfulRazorpayStatus(payment.status)
    ) {
      return null;
    }
    return {
      id: String(payment.id),
      orderId: String(payment.order_id),
      amount: Number(payment.amount ?? 0) / 100,
    };
  };

  app.post("/api/razorpay/create-order", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    try {
      const { amount, orderPayload } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }
      if (orderPayload && typeof orderPayload === "object") {
        try {
          const slotError = await validateTimeslotBeforeCheckout({
            hubDbName: orderPayload.hubDbName,
            timeslotId: orderPayload.timeslotId,
            deliveryDate: orderPayload.deliveryDate,
            scheduleType: orderPayload.scheduleType,
          });
          if (slotError) return res.status(400).json({ message: slotError });
        } catch (slotValidationErr) {
          console.error("[Razorpay] Pre-payment timeslot validation error:", slotValidationErr);
          return res.status(400).json({ message: "Could not validate the selected delivery slot." });
        }
      }
      const order = await razorpay.orders.create({
        amount: Math.round(amount * 100),
        currency: "INR",
        receipt: `ft_${Date.now()}`,
      });

      // Store the full order payload so the webhook can reconstruct the order if
      // the browser closes before the client-side handler fires.
      if (orderPayload && typeof orderPayload === "object") {
        try {
          const PendingCheckout = getPendingCheckoutModel();
          await PendingCheckout.findOneAndUpdate(
            { razorpayOrderId: order.id },
            { razorpayOrderId: order.id, orderPayload },
            { upsert: true, new: true }
          );
        } catch (storeErr) {
          // Non-fatal — webhook fallback just won't have the payload
          console.error("[Razorpay] Failed to store pending checkout:", storeErr);
        }
      }

      return res.json({ order_id: order.id, amount: order.amount, currency: order.currency });
    } catch (err: any) {
      console.error("[Razorpay] create-order error:", err);
      return res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  // ── Razorpay webhook ──────────────────────────────────────────────────────────
  // Safety net: if the browser closes after Razorpay captures the payment but
  // before the client-side handler can call /api/orders, this webhook creates
  // the FishTokri order server-side so no paid order is ever lost.
  //
  // Setup: Razorpay Dashboard → Settings → Webhooks → add your domain's
  //   POST /api/webhooks/razorpay URL, select "payment.captured", and copy
  //   the generated secret into the RAZORPAY_WEBHOOK_SECRET env var.
  app.post("/api/webhooks/razorpay", async (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error("[Razorpay webhook] RAZORPAY_WEBHOOK_SECRET not configured — webhook disabled");
      return res.status(500).json({ message: "Webhook not configured" });
    }

    // Verify HMAC-SHA256 signature using the raw body captured by express.json verify()
    const rawBody = (req as any).rawBody as Buffer | undefined;
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    if (!rawBody || !signature) {
      return res.status(400).json({ message: "Missing body or signature" });
    }
    const expectedSig = createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex");
    if (expectedSig !== signature) {
      console.warn("[Razorpay webhook] Signature mismatch — possible spoofed request");
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;
    // Only handle payment.captured; acknowledge all other events immediately
    if (event.event !== "payment.captured") {
      return res.status(200).json({ message: "Event ignored" });
    }

    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) {
      return res.status(400).json({ message: "Invalid payment payload" });
    }

    const razorpayPaymentId: string = payment.id;
    const razorpayOrderId: string = payment.order_id;
    const amountPaid: number = (payment.amount ?? 0) / 100; // Razorpay sends paise

    console.log(`[Razorpay webhook] payment.captured: payment_id=${razorpayPaymentId} order_id=${razorpayOrderId} amount=₹${amountPaid}`);

    try {
      // Idempotency: skip if a FishTokri order already exists for this payment
      const OrderModel = getOrderModel();
      const existing = await OrderModel.findOne({
        $or: [
          { razorpayOrderId },
          { "payments.reference": razorpayPaymentId },
          { upiTransactionId: razorpayPaymentId },
        ],
      }).lean();
      if (existing) {
        if (isFtwStorefrontOrder(existing as any)) {
          const paymentState = buildSuccessfulRazorpayPaymentState({
            total: Number((existing as any).total ?? amountPaid),
            paymentAmount: amountPaid,
            paymentId: razorpayPaymentId,
            existingPayments: (existing as any).payments,
          });
          await OrderModel.updateOne(
            { _id: (existing as any)._id },
            {
              $set: {
                ...paymentState,
                razorpayOrderId,
                updatedAt: new Date(),
              },
            },
          );
          console.log(`[Razorpay webhook] Repaired FTW payment metadata for ${razorpayPaymentId}`);
        } else {
          console.log(`[Razorpay webhook] Non-FTW order already exists for payment ${razorpayPaymentId} — skipping`);
        }
        return res.status(200).json({ message: "Already processed" });
      }

      // Fetch the pending checkout payload saved at create-order time
      const PendingCheckout = getPendingCheckoutModel();
      const pending = await PendingCheckout.findOne({ razorpayOrderId }).lean() as any;
      if (!pending?.orderPayload) {
        console.warn(`[Razorpay webhook] No pending checkout found for Razorpay order ${razorpayOrderId} — cannot reconstruct order`);
        return res.status(200).json({ message: "No pending checkout" });
      }

      // Build the complete order payload: merge stored payload with actual payment details
      const walletPayments = (pending.orderPayload.payments ?? []).filter((p: any) => p.mode === "wallet");
      const paidAt = new Date().toISOString();
      const orderPayload = {
        ...pending.orderPayload,
        razorpayOrderId,
        ...buildSuccessfulRazorpayPaymentState({
          total: Number(pending.orderPayload.total ?? amountPaid),
          paymentAmount: amountPaid,
          paymentId: razorpayPaymentId,
          existingPayments: walletPayments,
          paidAt: new Date(paidAt),
        }),
      };

      // Create the order via the existing /api/orders route (reuses all validation,
      // inventory deduction, coupon tracking, and WhatsApp notification logic).
      const port = process.env.PORT || "5000";
      const createRes = await fetch(`http://localhost:${port}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FishTokri-Paid-Recovery": "1",
        },
        body: JSON.stringify(orderPayload),
      });

      if (createRes.ok) {
        const created = await createRes.json() as any;
        console.log(
          `[Razorpay webhook] Order created: orderId=${created.orderId ?? created.id} ` +
          `for payment ${razorpayPaymentId}; inventory review required`,
        );
        // Clean up the pending checkout
        await PendingCheckout.deleteOne({ razorpayOrderId });
      } else {
        const errText = await createRes.text();
        console.error(`[Razorpay webhook] Order creation failed (${createRes.status}): ${errText}`);
        // Do not delete the pending checkout. It remains recoverable by the
        // reconciliation process/admin while Razorpay retries transient errors.
      }
    } catch (err) {
      console.error("[Razorpay webhook] Unexpected error:", err);
    }

    // Always return 200 — non-200 causes Razorpay to retry, which is only correct
    // for transient infra errors (handled above with logging instead).
    return res.status(200).json({ message: "OK" });
  });

  // Mobile UPI return: check if a Razorpay order has been paid (verifies server-side)
  app.get("/api/razorpay/order-status/:orderId", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    try {
      const { orderId } = req.params;
      const payments = await razorpay.orders.fetchPayments(orderId) as any;
      const captured = (payments.items ?? []).find(
        (p: any) => p.status === "captured" || p.status === "authorized"
      );
      if (captured) {
        const secret = process.env.RAZORPAY_KEY_SECRET!;
        const signature = createHmac("sha256", secret)
          .update(`${orderId}|${captured.id}`)
          .digest("hex");
        return res.json({ paid: true, paymentId: captured.id, signature });
      }
      return res.json({ paid: false });
    } catch (err) {
      console.error("[Razorpay] order-status error:", err);
      return res.status(500).json({ paid: false, message: "Failed to fetch order status" });
    }
  });

  app.post("/api/razorpay/verify-payment", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return res.status(400).json({ verified: false, message: "Missing fields" });
      }
      const secret = process.env.RAZORPAY_KEY_SECRET!;
      const generated = createHmac("sha256", secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest("hex");
      if (generated === razorpay_signature) {
        return res.json({ verified: true });
      }
      return res.status(400).json({ verified: false, message: "Signature mismatch" });
    } catch (err) {
      console.error("[Razorpay] verify error:", err);
      return res.status(500).json({ message: "Verification error" });
    }
  });

  // Orders routes
  app.post(api.orders.create.path, async (req, res) => {
    try {
      const input = api.orders.create.input.parse(req.body);
      // A captured payment must never disappear just because inventory changed
      // between checkout and webhook delivery. The webhook sets this internal
      // header so we record a paid order for admin resolution without deducting
      // stock a second time or rejecting the payment.
      const recoveryHeader = req.headers["x-fishtokri-paid-recovery"] === "1";
      const localAddress = req.socket.remoteAddress ?? "";
      const isPaidWebhookRecovery = recoveryHeader &&
        (localAddress === "127.0.0.1" || localAddress === "::1" || localAddress === "::ffff:127.0.0.1");

      // Preorder dates are product eligibility metadata, not a client-trusted
      // calendar choice. Re-read the current products and validate the one
      // shared delivery date before any payment or inventory mutation.
      if (input.orderType === "preorder") {
        const dateText = input.deliveryDate;
        if (!dateText || !/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
          return res.status(400).json({ message: "Please choose a valid preorder delivery date." });
        }
        const parsedDate = new Date(`${dateText}T00:00:00Z`);
        if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateText) {
          return res.status(400).json({ message: "Please choose a valid preorder delivery date." });
        }
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowKey = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
        if (dateText < tomorrowKey) {
          return res.status(400).json({ message: "Preorder delivery must be from tomorrow onward." });
        }

        const hub = input.hubDbName ? await getHubModels(input.hubDbName) : null;
        if (!hub) return res.status(400).json({ message: "No hub selected for preorder validation." });
        const productIds = (input.items as any[]).map((item) => item.productId);
        const products = await hub.Product.find({ _id: { $in: productIds } })
          .select("_id name preorderMode preOrderMode preorderAvailability")
          .lean() as any[];
        const productsById = new Map(products.map((product) => [String(product._id), product]));

          const unavailableProductNames = (input.items as any[])
            .map((item) => productsById.get(String(item.productId)))
            .filter((product): product is any => !!product)
            .filter((product) => !isPreorderDateAvailable(dateText, product.preorderAvailability))
            .map((product) => product.name);

          if (!isPreorderDateAvailableForAll(
            dateText,
            products.map((product) => product.preorderAvailability),
          )) {
            const unavailableName = unavailableProductNames[0];
            return res.status(400).json({
              message: unavailableName
                ? `"${unavailableName}" is not available on ${dateText}. Please choose another preorder date.`
                : "Some preorder products are not available on the selected date. Please choose another preorder date.",
            });
          }

          for (const item of input.items as any[]) {
            const product = productsById.get(String(item.productId));
            if (!product) {
              return res.status(400).json({ message: `Product "${item.name}" is no longer available.` });
            }
            const mode = normalizePreorderMode(product.preorderMode ?? product.preOrderMode);
            if (mode === "normal") {
              return res.status(400).json({ message: `"${product.name}" is not available for preorder.` });
            }
          }
          if (input.timeslotId) {
            const weekday = String(parsedDate.getUTCDay());
            const selectedSlot = await hub.Timeslot.findById(input.timeslotId)
              .select("_id isActive").lean() as any;
            if (!selectedSlot || selectedSlot.isActive === false) {
              return res.status(400).json({ message: "This preorder time slot is no longer available." });
            }
            const invalidProduct = products.find((product) => {
              const rules = normalizePreorderAvailability(product.preorderAvailability);
              const allowed = rules.timeslotIdsByWeekday?.[weekday];
              return allowed !== undefined && !allowed.includes(String(input.timeslotId));
            });
            if (invalidProduct) {
              return res.status(400).json({
                message: `"${invalidProduct.name}" is not available in the selected time slot.`,
              });
            }
          }
      }

      // ── Pre-flight: payment-reference idempotency check ──────────────────────
      // Client-side, two things can race and both call this endpoint for the SAME
      // Razorpay payment: the checkout modal's own `handler` callback, and the
      // `visibilitychange` UPI-resume poll (both fire when the user returns from
      // paying in GPay/PhonePe/etc.). If a request arrives whose UPI payment
      // reference already exists on another order, treat it as a duplicate
      // submission and return the existing order instead of creating a new one —
      // this is the server-side safety net in case the client-side guard is ever
      // bypassed (double network retry, multiple tabs, etc.).
      const upiReference = (input.payments ?? []).find((p: any) => p.mode === "upi" && p.reference)?.reference;
      if (upiReference) {
        const existing = await getOrderModel().findOne({
          $or: [
            { "payments.reference": upiReference },
            { upiTransactionId: upiReference },
            ...(input.razorpayOrderId
              ? [{ razorpayOrderId: input.razorpayOrderId }]
              : []),
          ],
        }).lean() as any;
        if (existing) {
          if (!input.razorpayOrderId) {
            return res.status(400).json({ message: "Razorpay order ID is required" });
          }
          let verifiedPayment: {
            id: string;
            orderId: string;
            amount: number;
          } | null;
          try {
            verifiedPayment = await fetchVerifiedRazorpayPayment(
              input.razorpayOrderId,
              upiReference,
            );
          } catch (paymentErr) {
            console.error("[Razorpay] Duplicate payment verification lookup failed:", paymentErr);
            return res.status(502).json({ message: "Could not verify Razorpay payment" });
          }
          if (!verifiedPayment) {
            return res.status(400).json({ message: "Razorpay payment is not successful" });
          }

          if (isFtwStorefrontOrder(existing)) {
            const paymentState = buildSuccessfulRazorpayPaymentState({
              total: Number(existing.total ?? verifiedPayment.amount),
              paymentAmount: verifiedPayment.amount,
              paymentId: verifiedPayment.id,
              existingPayments: existing.payments,
            });
            const repaired = await getOrderModel().findByIdAndUpdate(
              existing._id,
              {
                $set: {
                  ...paymentState,
                  razorpayOrderId: verifiedPayment.orderId,
                  updatedAt: new Date(),
                },
              },
              { new: true },
            ).lean();
            console.log(`[order:dedupe] Repaired FTW payment metadata for ${verifiedPayment.id}`);
            return res.status(200).json({ ...repaired, id: String(existing._id) });
          }

          console.warn(`[order:dedupe] Duplicate order-create request for razorpay reference=${upiReference} — returning existing order ${existing.orderId ?? existing._id}`);
          return res.status(200).json({ ...existing, id: String(existing._id) });
        }
      }

      // Validate the selected slot against the requested calendar date on the
      // server as well as in the checkout UI. This prevents a stale tab or a
      // handcrafted request from ordering on a weekday that the admin disabled.
      if (input.timeslotId && input.hubDbName && input.scheduleType !== "instant") {
        try {
          const slotError = await validateTimeslotBeforeCheckout({
            hubDbName: input.hubDbName,
            timeslotId: input.timeslotId,
            deliveryDate: input.deliveryDate,
            scheduleType: input.scheduleType,
          });
          if (slotError) return res.status(400).json({ message: slotError });
        } catch (timeslotValidationErr) {
          console.error("[Timeslot] Validation error:", timeslotValidationErr);
          return res.status(400).json({ message: "Could not validate the selected delivery slot." });
        }
      }

      // ── Pre-flight: coupon usage check (runs BEFORE inventory is touched) ───
      if (input.hubDbName && input.couponCode) {
        try {
          const hub = await getHubModels(input.hubDbName);
          const code = String(input.couponCode).trim().toUpperCase();
          const coupon = await hub.Coupon.findOne({ code, isActive: true }).lean() as any;
          if (coupon && coupon.maxUsage != null && Number(coupon.maxUsage) > 0) {
            const couponId = String(coupon._id);
            const phone = String(input.phone ?? "");
            if (phone) {
              const custDoc = await CustomerDbModel.findOne(
                { phone },
                { activeCoupons: 1, usedCoupons: 1 }
              ).lean() as any;
              const activeEntry = (custDoc?.activeCoupons ?? []).find(
                (ac: any) => String(ac.couponId) === couponId
              );
              const activeCount = activeEntry
                ? (activeEntry.usedCount != null ? Number(activeEntry.usedCount) : 1)
                : 0;
              const historicalCount = (custDoc?.usedCoupons ?? []).filter(
                (uc: any) => String(uc.couponId) === couponId
              ).length;
              if (activeCount + historicalCount >= Number(coupon.maxUsage)) {
                return res.status(400).json({ message: "CouponUsageLimitReached" });
              }
            }
          }
        } catch (couponPreflightErr) {
          console.error("Coupon pre-flight check error:", couponPreflightErr);
          return res.status(500).json({ message: "Could not verify coupon. Please try again." });
        }
      }

      // FIFO inventory deduction if hubDbName is provided (atomic per-batch to prevent overselling)
      if (input.hubDbName && !isPaidWebhookRecovery) {
        const hub = await getHubModels(input.hubDbName);
        for (const item of input.items) {
          // Always fetch the LATEST quantity from DB right before deducting
          const product = await hub.Product.findById(item.productId).lean() as any;
          if (!product) continue;

          const hasBatches = Array.isArray(product.inventoryBatches) && product.inventoryBatches.length > 0;

          if (!hasBatches) {
            // ── No inventory batches: atomically decrement the top-level quantity field.
            // The $gte guard ensures we can NEVER deduct more than what actually exists,
            // even when two orders arrive simultaneously.
            const atomicResult = await hub.Product.findOneAndUpdate(
              { _id: item.productId, quantity: { $gte: item.quantity } },
              { $inc: { quantity: -item.quantity }, $set: { updatedAt: new Date() } }
            );
            if (!atomicResult) {
              // Re-read to give an accurate "how many are left" message
              const fresh = await hub.Product.findById(item.productId).select("name quantity").lean() as any;
              const left = fresh?.quantity ?? 0;
              return res.status(409).json({
                message: left > 0
                  ? `"${product.name}" has only ${left} unit(s) available. Please update your cart.`
                  : `"${product.name}" just went out of stock. Please refresh and try again.`,
              });
            }
            continue;
          }

          // ── Batch-based path (FIFO) ────────────────────────────────────────────
          const now = new Date();
          const activeBatches = (product.inventoryBatches as any[]).filter((batch: any) => {
            const expiryDate = batch.expiryDate
              ? new Date(batch.expiryDate)
              : computeExpiryDate(new Date(batch.entryDate), batch.shelfLifeDays);
            return batch.remainingTime !== "expired" && expiryDate > now;
          });

          // Pre-flight stock check against current DB state (non-blocking optimisation;
          // the real guard is the atomic $gte on each batch below)
          const totalAvailable = activeBatches.reduce(
            (sum: number, b: any) => sum + b.quantity, 0
          );
          if (totalAvailable < item.quantity) {
            return res.status(409).json({
              message: `"${product.name}" has only ${totalAvailable} unit(s) available. Please update your cart.`,
            });
          }

          // Sort batches by entryDate ascending (oldest first = FIFO)
          const sortedBatches = [...activeBatches].sort(
            (a: any, b: any) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime()
          );

          let remaining = item.quantity;
          for (const batch of sortedBatches) {
            if (remaining <= 0) break;
            // Atomically deduct only if this batch still has at least `deduct` units.
            // If a concurrent order has taken some (but not all) stock from this batch,
            // we re-read the current quantity and retry with the lesser amount (up to 5 times).
            let deduct = Math.min(batch.quantity, remaining);
            let deducted = false;
            for (let attempt = 0; attempt < 5; attempt++) {
              const atomicResult = await hub.Product.findOneAndUpdate(
                {
                  _id: item.productId,
                  inventoryBatches: { $elemMatch: { _id: batch._id, quantity: { $gte: deduct } } },
                },
                { $inc: { "inventoryBatches.$.quantity": -deduct } }
              );
              if (atomicResult) { deducted = true; break; }

              // Re-read this batch's actual current quantity and retry with what's left
              const freshDoc = await hub.Product.findOne(
                { _id: item.productId, "inventoryBatches._id": batch._id },
                { "inventoryBatches.$": 1 }
              ).lean() as any;
              const currentQty = freshDoc?.inventoryBatches?.[0]?.quantity ?? 0;
              if (currentQty <= 0) break; // batch fully exhausted by concurrent orders
              deduct = Math.min(currentQty, remaining); // take whatever is still available
            }

            if (!deducted) {
              // Could not deduct from this batch after retries — move to next batch
              // (remaining will catch the shortfall after the batch loop)
              continue;
            }

            remaining -= deduct;
          }

          // If batches were exhausted before filling the full quantity, reject the order
          if (remaining > 0) {
            return res.status(409).json({
              message: `"${product.name}" just went out of stock. Please refresh and try again.`,
            });
          }

          // Remove zero-quantity batches atomically ($pull is safe for concurrent writes)
          // then recalculate the denormalised top-level quantity field.
          await hub.Product.findByIdAndUpdate(item.productId, {
            $pull: { inventoryBatches: { quantity: { $lte: 0 } } },
            $set: { updatedAt: new Date() },
          });
          const afterDeduct = await hub.Product.findById(item.productId).lean() as any;
          const totalQty = (afterDeduct?.inventoryBatches ?? []).reduce(
            (sum: number, b: any) => sum + b.quantity, 0
          );
          await hub.Product.findByIdAndUpdate(item.productId, { $set: { quantity: totalQty } });
        }
      }

      // Resolve coupon details and hub identity before persisting
      let resolvedCoupon: any = null;
      let resolvedSuperHubId: string | null = null;
      let resolvedSuperHubName: string | null = null;
      let resolvedSubHubId: string | null = null;
      let resolvedSubHubName: string | null = null;

      if (input.hubDbName) {
        try {
          const subHub = await SubHubModel.findOne({ dbName: input.hubDbName }).lean() as any;
          if (subHub) {
            resolvedSubHubId = subHub._id.toString();
            resolvedSubHubName = subHub.name;
            resolvedSuperHubId = subHub.superHubId?.toString() ?? null;
            // Look up SuperHub name
            if (subHub.superHubId) {
              try {
                const superHub = await SuperHubModel.findById(subHub.superHubId).lean() as any;
                if (superHub) resolvedSuperHubName = superHub.name;
              } catch { /* non-fatal */ }
            }
          }
        } catch (hubLookupErr) {
          console.error("Hub lookup error:", hubLookupErr);
        }

        if (input.couponCode) {
          try {
            const hub = await getHubModels(input.hubDbName);
            const code = String(input.couponCode).trim().toUpperCase();
            const coupon = await hub.Coupon.findOne({ code, isActive: true }).lean() as any;
            if (coupon) {
              // (maxUsage enforcement already ran in the pre-flight block above)
              const cartTotal = (input.items as any[]).reduce(
                (sum: number, item: any) => sum + ((item.price ?? 0) * (item.quantity ?? 1)),
                0
              );
              const discountAmount =
                input.discountAmount ??
                (coupon.type === "flat"
                  ? Math.min(coupon.discountValue, cartTotal)
                  : Math.round((cartTotal * coupon.discountValue) / 100));
              resolvedCoupon = {
                couponId: coupon._id,
                code: coupon.code,
                couponTitle: coupon.title ?? "",
                discountType: coupon.type,
                discountValue: coupon.discountValue,
                discountAmount,
              };
            }
          } catch (couponLookupErr) {
            console.error("Coupon details lookup error:", couponLookupErr);
          }
        }
      }

      // Compute financials
      const itemsTotal = (input.items as any[]).reduce(
        (sum: number, item: any) => sum + ((item.price ?? 0) * (item.quantity ?? 1)), 0
      );
      const subtotal = input.subtotal ?? itemsTotal;
      const discount = input.discount ?? input.discountAmount ?? (resolvedCoupon?.discountAmount ?? 0);
      const clientSlotCharge = input.slotCharge ?? input.instantDeliveryCharge ?? 0;

      // Authoritative delivery-charge recomputation: the client derives slotCharge from
      // in-memory hub/pincode config (via React state that can be stale — e.g. a UPI
      // payment resumed long after checkout via the visibilitychange listener replays an
      // old/empty closure). Never trust the client's number outright for a delivery order;
      // recompute it here from the persisted sub-hub pincode config + timeslot doc and use
      // that value, only falling back to the client-submitted figure if lookup is impossible
      // (e.g. pickup/takeaway orders with no hub, or a legacy pincode not in the config yet).
      let slotCharge = clientSlotCharge;
      if (input.hubDbName && (input.deliveryType ?? "delivery") === "delivery") {
        try {
          const pincode = input.deliveryAddressDetail?.pincode;
          const subHubForCharge = await SubHubModel.findOne({ dbName: input.hubDbName }).lean() as any;
           let pincodeConfig = pincode
             ? (subHubForCharge?.pincodes ?? []).find((p: any) => String(p.pincode).trim() === String(pincode).trim())
             : null;
           if (!pincodeConfig && input.hubDbName && pincode) {
             const hubForPincode = await getHubModels(input.hubDbName);
             pincodeConfig = await hubForPincode.Pincode.findOne({
               pincode: String(pincode).trim(),
               isActive: { $ne: false },
             }).lean() as any;
           }
          if (!pincodeConfig) {
            // No authoritative config found (unknown pincode, hub/dbName mismatch, or missing
            // pincode on the order) — we silently keep the client-submitted slotCharge below.
            // Log it loudly so a $0 charge slipping through is visible in server logs
            // immediately rather than being discovered later as missing revenue.
            console.warn(
              `[order:slotCharge] No pincode config match — keeping client-submitted slotCharge=${clientSlotCharge} ` +
              `(pincode=${pincode}, hub=${input.hubDbName}, foundSubHub=${!!subHubForCharge})`
            );
          }
          if (pincodeConfig) {
            const baseCharge = pincodeConfig.charge ?? 0;
            let extraCharge = 0;
            if (input.timeslotId) {
              try {
                const hubForTimeslot = await getHubModels(input.hubDbName);
                const timeslotDoc = await hubForTimeslot.Timeslot.findById(input.timeslotId).lean() as any;
                if (timeslotDoc?.isInstant) extraCharge = timeslotDoc.extraCharge ?? 0;
              } catch { /* non-fatal — fall back to base charge only */ }
            }
            const authoritativeCharge = baseCharge + extraCharge;
            if (authoritativeCharge !== clientSlotCharge) {
              console.warn(
                `[order:slotCharge] Overriding client-submitted slotCharge=${clientSlotCharge} with authoritative ${authoritativeCharge} (pincode=${pincode}, hub=${input.hubDbName})`
              );
            }
            slotCharge = authoritativeCharge;
          }
        } catch (chargeLookupErr) {
          console.error("Delivery charge validation error:", chargeLookupErr);
        }
      }

      // Always derive total from the (possibly corrected) slotCharge above rather than
      // trusting a client-submitted total, so a stale/incorrect delivery charge can never
      // silently carry through into the amount actually charged/recorded.
      const total = subtotal - discount + slotCharge;

      // Build coupon arrays
      const couponIds = resolvedCoupon ? [resolvedCoupon.couponId.toString()] : [];
      const couponCodes = resolvedCoupon ? [resolvedCoupon.code] : [];
      const coupons = resolvedCoupon ? [resolvedCoupon] : [];

      // Derive paymentMode
      const paymentMode = input.paymentMode ?? (input.paymentMethod === "upi" ? "upi" : "cash");

      // Extract UPI transaction ID (Razorpay payment ID) from the payments array.
      // Set on all UPI-paid orders so the admin panel can find it at the top level
      // without digging into the payments array.
      const upiTransactionId =
        (input.payments ?? []).find((p: any) => p.mode === "upi" && p.reference)?.reference ?? null;

      // Never trust client-provided paymentStatus/paidAmount. A Razorpay
      // reference is paid only after the server confirms the payment belongs
      // to this Razorpay order and has a successful status.
      let verifiedRazorpayPayment: {
        id: string;
        orderId: string;
        amount: number;
      } | null = null;
      if (input.razorpayOrderId || upiTransactionId) {
        if (!input.razorpayOrderId || !upiTransactionId) {
          return res.status(400).json({ message: "Incomplete Razorpay payment details" });
        }
        try {
          verifiedRazorpayPayment = await fetchVerifiedRazorpayPayment(
            input.razorpayOrderId,
            upiTransactionId,
          );
        } catch (paymentErr) {
          console.error("[Razorpay] Payment verification lookup failed:", paymentErr);
          return res.status(502).json({ message: "Could not verify Razorpay payment" });
        }
        if (!verifiedRazorpayPayment) {
          return res.status(400).json({ message: "Razorpay payment is not successful" });
        }
      }

      // Today's date for deliveryDate fallback
      const now2 = new Date();
      const deliveryDate = input.deliveryDate ??
        `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, "0")}-${String(now2.getDate()).padStart(2, "0")}`;

      const cleanedItems = (input.items as any[]).map(({ productId, name, price, quantity, unit, imageUrl }) => ({
        productId,
        name,
        price,
        quantity,
        unit: unit ?? null,
        imageUrl: imageUrl ?? null,
      }));

      // Fetch customer email from DB if not provided in payload
      let resolvedEmail: string | null = input.email ?? null;
      if (!resolvedEmail && input.customerId) {
        try {
          const { CustomerDbModel } = await import("./customerDb");
          const cust = await CustomerDbModel.findById(input.customerId).select("email").lean() as any;
          if (cust?.email) resolvedEmail = cust.email;
        } catch { /* non-fatal */ }
      }

      // Build deliveryAddressDetail with _id as a plain string at the end
      // (matching admin POS format — not a Mongoose ObjectId / $oid object).
      const rawAddr = input.deliveryAddressDetail;
      const addrDetail = rawAddr
        ? {
            name: rawAddr.name ?? null,
            phone: rawAddr.phone ?? null,
            building: rawAddr.building ?? null,
            street: rawAddr.street ?? null,
            area: rawAddr.area ?? null,
            pincode: rawAddr.pincode ?? null,
            type: rawAddr.type ?? "house",
            label: rawAddr.label ?? "Home",
            instructions: rawAddr.instructions ?? "",
            _id: rawAddr._id ? String(rawAddr._id) : null,
          }
        : null;

      // Build orderInput in the exact field order used by the admin POS schema.
      // orderId is intentionally omitted here — it is appended LAST via
      // findByIdAndUpdate after the document is saved (matching admin behaviour).
      const paymentState = verifiedRazorpayPayment
        ? buildSuccessfulRazorpayPaymentState({
            total,
            paymentAmount: verifiedRazorpayPayment.amount,
            paymentId: verifiedRazorpayPayment.id,
            existingPayments: input.payments,
          })
        : {
            paymentStatus: input.paymentStatus ?? "unpaid",
            payments: input.payments ?? [],
            paidAmount: input.paidAmount ?? 0,
            dueAmount: input.dueAmount ?? total,
            paymentMode,
            upiVariant: input.upiVariant ?? null,
            upiTransactionId,
          };

      const orderInput: any = {
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        phone: input.phone,
        email: resolvedEmail,
        items: cleanedItems,
        subtotal,
        discount,
        slotCharge,
        total,
        deliveryType: input.deliveryType ?? "delivery",
        address: input.address,
        deliveryArea: input.deliveryArea,
        deliveryAddressDetail: addrDetail,
        pickupLocation: "",
        notes: input.notes ?? "",
        status: "pending",
        source: "online",
        subHubId: resolvedSubHubId ?? null,
        subHubName: resolvedSubHubName ?? null,
        superHubId: resolvedSuperHubId ?? null,
        superHubName: resolvedSuperHubName ?? null,
        couponIds,
        couponCodes,
        coupons,
        ...paymentState,
         orderType: input.orderType ?? null,
        scheduleType: input.scheduleType ?? "slot",
        deliveryDate,
        timeslotId: input.timeslotId ?? null,
        timeslotLabel: input.timeslotLabel ?? null,
        timeslotStart: input.timeslotStart ?? null,
        timeslotEnd: input.timeslotEnd ?? null,
        razorpayOrderId: verifiedRazorpayPayment?.orderId ?? input.razorpayOrderId ?? null,
      };

      const order = await storage.createOrderRequest(orderInput);

      // Generate orderId AFTER the document is saved — countDocuments gives the correct
      // shared sequence across admin + online orders, and $set appends orderId as the
      // last field (matching admin POS document structure).
      const generatedOrderId = await generateOrderId();
      // orderId and inventoryDeducted are set together in one update AFTER save,
      // so both appear after createdAt/updatedAt — matching admin POS field order exactly.
      await getOrderModel().findByIdAndUpdate(order.id, {
        $set: { orderId: generatedOrderId, inventoryDeducted: false },
      });

      const orderItemsTotal = (order.items as any[]).reduce((sum: number, item: any) => {
        return sum + ((item.price ?? 0) * (item.quantity ?? 1));
      }, 0);

      await storage.pushOrderToCustomer(order.phone, {
        orderId: generatedOrderId,
        customerName: order.customerName,
        phone: order.phone,
        deliveryArea: order.deliveryArea,
        address: order.address,
        items: order.items,
        status: order.status,
        notes: order.notes ?? null,
        total: (order as any).total ?? orderItemsTotal,
        placedAt: order.createdAt,
      });

      // Send order confirmation WhatsApp message (fire-and-forget)
      try {
        const itemsList = (order.items as any[])
          .map((item: any) => `• ${item.name} x${item.quantity ?? 1} — ₹${(item.price ?? 0) * (item.quantity ?? 1)}`)
          .join("\n");
        const paymentLabel = (order as any).paymentMethod === "upi" ? "UPI (Paid)" : "Cash on Delivery";
        sendWhatsApp("order_confirmed_fishtokri", order.phone, [
          order.customerName || "Customer",
          generatedOrderId,
          order.address || order.deliveryArea || "Your address",
          itemsList,
          total.toString(),
          paymentLabel,
        ]).catch(() => {});
      } catch (waErr) {
        console.error("[WhatsApp] Order confirmation error:", waErr);
      }

      // Track coupon in activeCoupons after successful order creation
      if (input.couponCode && input.hubDbName && resolvedCoupon) {
        try {
          await addActiveCoupon(
            order.phone,
            String(resolvedCoupon.couponId ?? ""),
            resolvedCoupon.code,
            resolvedCoupon.couponTitle ?? "",
            order.subHubId ?? "",
            order.id
          );
        } catch (couponErr) {
          console.error("Coupon usage update error:", couponErr);
        }
      }

      // Increment the rolling today/next-day count only for those dates. The
      // schema has no per-calendar-date count field for later preorder dates.
      if (input.timeslotStart && input.hubDbName && input.scheduleType !== "instant") {
        try {
          const hub = await getHubModels(input.hubDbName);
          const today = new Date();
          const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
          const countField =
            input.deliveryDate === todayStr ? "todaysOrderCount" :
            input.deliveryDate === tomorrowStr ? "nextDayOrderCount" :
            null;
          if (countField) {
            await hub.Timeslot.findOneAndUpdate(
              { startTime: input.timeslotStart },
              { $inc: { [countField]: 1 } },
              { strict: false }
            );
          }
        } catch (timeslotCountErr) {
          console.error("[Timeslot] Count increment error:", timeslotCountErr);
        }
      }

      // Deduct wallet balance — read from payments[].mode === "wallet" (admin-compatible)
      const walletPayments = (input.payments ?? []).filter((p: any) => p.mode === "wallet");
      const walletUsed = walletPayments.reduce((sum: number, p: any) => sum + Number(p.amount ?? 0), 0);
      if (walletUsed > 0 && input.customerId) {
        try {
          await CustomerDbModel.findByIdAndUpdate(input.customerId, {
            $inc: { walletBalance: -walletUsed },
          });
          console.log(`[Wallet] Deducted ₹${walletUsed} from customer ${input.customerId}`);
        } catch (walletErr) {
          console.error("[Wallet] Deduction error:", walletErr);
        }
      }

      res.status(201).json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.orders.list.path, requireAuth, async (req, res) => {
    const orders = await storage.getOrderRequests();
    res.json(orders);
  });

  app.get("/api/orders/by-phone/:phone", async (req, res) => {
    const { phone } = req.params;
    if (!phone) return res.status(400).json({ message: "Phone required" });
    const orders = await storage.getOrdersByPhone(phone);
    res.json(orders);
  });

  app.patch(api.orders.updateStatus.path, requireAuth, async (req, res) => {
    try {
      const input = api.orders.updateStatus.input.parse(req.body);

      // Fetch old order before updating so we know the previous status
      const oldOrder = await storage.getOrderRequest(req.params.id);
      const oldStatus = oldOrder?.status ?? "pending";

      const order = await storage.updateOrderRequestStatus(req.params.id, input.status);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      await storage.updateCustomerOrderStatus(order.phone, order.id, input.status);

      // ── Coupon lifecycle ────────────────────────────────────────────────
      const couponCode = order.coupon?.code;
      const couponId   = order.coupon?.couponId ?? "";
      if (couponCode && couponId) {
        const ACTIVE_STATUSES = new Set(["pending", "confirmed", "out_for_delivery", "takeaway"]);
        const wasActive    = ACTIVE_STATUSES.has(oldStatus);
        const isNowActive  = ACTIVE_STATUSES.has(input.status);
        const wasCancelled = oldStatus === "cancelled";
        const isDelivered  = input.status === "delivered";
        const isCancelled  = input.status === "cancelled";

        try {
          const couponTitle = order.coupon?.couponTitle ?? "";

          if (wasActive && isCancelled) {
            // Order cancelled → release coupon back
            await removeActiveCoupon(order.phone, couponId, order.id);
          } else if (wasActive && isDelivered) {
            // Order delivered → move coupon to permanent history
            await removeActiveCoupon(order.phone, couponId, order.id);
            await addDeliveredCoupon(order.phone, couponId, couponCode, couponTitle, order.subHubId ?? "", order.id);
          } else if (wasCancelled && isDelivered) {
            // Cancelled → delivered (rare): push directly to permanent history, no active entry to remove
            await addDeliveredCoupon(order.phone, couponId, couponCode, couponTitle, order.subHubId ?? "", order.id);
          } else if (wasCancelled && isNowActive) {
            // Un-cancel → re-lock coupon in active orders
            await addActiveCoupon(order.phone, couponId, couponCode, couponTitle, order.subHubId ?? "", order.id);
          } else if (oldStatus === "delivered" && isNowActive) {
            // Un-deliver → move coupon back to active
            await removeDeliveredCoupon(order.phone, couponId, order.id);
            await addActiveCoupon(order.phone, couponId, couponCode, couponTitle, order.subHubId ?? "", order.id);
          }
        } catch (couponLifecycleErr) {
          console.error("[Coupon lifecycle] Error:", couponLifecycleErr);
        }
      }

      res.json(order);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ── Coupon apply / validate ──────────────────────────────────────────────
  app.post("/api/coupon/apply", async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ valid: false, message: "No hub selected" });

      const { couponCode, cartTotal, userId } = req.body;
      if (!couponCode || cartTotal === undefined) {
        return res.status(400).json({ valid: false, message: "Missing required fields" });
      }

      const code = String(couponCode).trim().toUpperCase();

      // ── Step 1: Check coupon exists and is active ─────────────────────────
      const coupon = await hub.Coupon.findOne({ code, isActive: true }).lean() as any;
      if (!coupon) {
        return res.json({ valid: false, message: "Invalid or inactive coupon code" });
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return res.json({ valid: false, message: "This coupon has expired" });
      }
      if ((coupon.minOrderAmount ?? 0) > cartTotal) {
        return res.json({ valid: false, message: `Minimum order of ₹${coupon.minOrderAmount} required` });
      }

      // ── Step 2: Per-user coupon usage check (activeCoupons + usedCoupons) ──
      if (userId) {
        const phone = String(userId);
        const couponId = String(coupon._id);

        const custDoc = await CustomerDbModel.findOne(
          { phone },
          { activeCoupons: 1, usedCoupons: 1 }
        ).lean() as any;

        // Active usage: find entry in activeCoupons keyed by couponId
        const activeEntry = (custDoc?.activeCoupons ?? []).find(
          (ac: any) => String(ac.couponId) === couponId
        );
        const activeCount = activeEntry
          ? (activeEntry.usedCount != null ? Number(activeEntry.usedCount) : 1)
          : 0;

        // Historical usage: count entries in usedCoupons (one per delivered order)
        const historicalCount = (custDoc?.usedCoupons ?? []).filter(
          (uc: any) => String(uc.couponId) === couponId
        ).length;

        const totalUsed = activeCount + historicalCount;

        // Per-customer limit: isFirstTimeOnly → 1; maxUsage > 0 → that value; else unlimited
        const isFirstTimeOnly = coupon.isFirstTimeOnly || code === "WELCOME100";
        const perCustomerLimit: number | null = isFirstTimeOnly
          ? 1
          : (coupon.maxUsage != null && coupon.maxUsage > 0 ? coupon.maxUsage : null);

        if (perCustomerLimit !== null && totalUsed >= perCustomerLimit) {
          const message = isFirstTimeOnly
            ? (code === "WELCOME100" ? "WELCOME100 can be used only once per account" : "This coupon is for first-time use only")
            : `Coupon usage limit reached (max ${perCustomerLimit} use${perCustomerLimit === 1 ? "" : "s"} per customer)`;
          return res.json({ valid: false, message });
        }
      }

      const discountAmount = coupon.type === "flat"
        ? Math.min(coupon.discountValue, cartTotal)
        : Math.round((cartTotal * coupon.discountValue) / 100);

      return res.json({ valid: true, discountAmount, message: "Coupon applied successfully" });
    } catch (err) {
      console.error("Coupon apply error:", err);
      res.status(500).json({ valid: false, message: "Failed to validate coupon" });
    }
  });

  // ── Coupon user-usage endpoint (for frontend per-user limit checks) ──────
  app.get("/api/coupons/user-usage", async (req, res) => {
    try {
      const phone = (req.session as any).customerPhone as string | undefined;
      if (!phone) return res.json({});

      const hub = await getReqHubModels(req);
      if (!hub) return res.json({});

      const [customer, coupons] = await Promise.all([
        CustomerDbModel.findOne({ phone }, { activeCoupons: 1, usedCoupons: 1 }).lean() as any,
        hub.Coupon.find({ isActive: true }).lean() as any[],
      ]);

      const allUsedCoupons: any[] = customer?.usedCoupons ?? [];
      const activeCoupons: any[] = customer?.activeCoupons ?? [];

      const result: Record<string, { usedCount: number; limit: number | null; isExhausted: boolean; message: string }> = {};
      for (const coupon of coupons) {
        const couponId = String(coupon._id);

        // Active usage: usedCount from activeCoupons entry (non-delivered orders)
        const activeEntry = activeCoupons.find((ac: any) => String(ac.couponId) === couponId);
        const activeCount = activeEntry
          ? (activeEntry.usedCount != null ? Number(activeEntry.usedCount) : 1)
          : 0;

        // Historical usage: count entries in usedCoupons (one per delivered order)
        const historicalCount = allUsedCoupons.filter(
          (uc: any) => String(uc.couponId) === couponId
        ).length;

        const usedCount = activeCount + historicalCount;

        // Per-customer limit: isFirstTimeOnly → 1; maxUsage > 0 → that value; else unlimited
        const isFirstTimeOnly = coupon.isFirstTimeOnly || coupon.code === "WELCOME100";
        const limit: number | null = isFirstTimeOnly
          ? 1
          : (coupon.maxUsage != null && coupon.maxUsage > 0 ? coupon.maxUsage : null);

        const isExhausted = limit !== null && usedCount >= limit;
        const message = isExhausted
          ? isFirstTimeOnly
            ? coupon.code === "WELCOME100"
              ? "WELCOME100 can be used only once per account"
              : "This coupon is for first-time use only"
            : `Coupon usage limit reached (max ${limit} use${limit === 1 ? "" : "s"} per customer)`
          : "";
        result[coupon.code] = { usedCount, limit, isExhausted, message };
      }
      return res.json(result);
    } catch (err) {
      console.error("User usage fetch error:", err);
      res.status(500).json({});
    }
  });

  // ── Coupon routes ────────────────────────────────────────────────────────
  app.get("/api/coupons", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Coupon.find({ isActive: true }).lean();
    res.json(docs.map(toCoupon));
  });

  app.get("/api/coupons/product/:productId", async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.json([]);
      const product = await hub.Product.findById(req.params.productId).lean() as any;
      if (!product) return res.status(404).json({ message: "Product not found" });
      const couponIds = (product.couponIds ?? []).map((id: any) => id.toString());
      if (couponIds.length === 0) return res.json([]);
      const docs = await hub.Coupon.find({ _id: { $in: couponIds }, isActive: true }).lean();
      res.json(docs.map(toCoupon));
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch product coupons" });
    }
  });

  app.post("/api/coupons", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const doc = await hub.Coupon.create({ ...req.body, createdAt: new Date(), updatedAt: new Date() });
      res.status(201).json(toCoupon(doc));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to create coupon" });
    }
  });

  app.patch("/api/coupons/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const doc = await hub.Coupon.findByIdAndUpdate(
        req.params.id,
        { ...req.body, updatedAt: new Date() },
        { new: true }
      ).lean();
      if (!doc) return res.status(404).json({ message: "Coupon not found" });
      res.json(toCoupon(doc));
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update coupon" });
    }
  });

  app.delete("/api/coupons/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      await hub.Coupon.findByIdAndDelete(req.params.id);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ message: "Failed to delete coupon" });
    }
  });

  // ── Coupon location usage limits (admin) ──────────────────────────────────
  // GET all location usage docs for this hub
  app.get("/api/coupon-location-usage", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.json([]);
      const docs = await hub.CouponLocationUsage.find({}).lean();
      res.json(docs);
    } catch (err) {
      res.status(500).json({ message: "Failed to fetch coupon location usage" });
    }
  });

  // PATCH: set or update maxUsageLimit for a coupon in this location
  app.patch("/api/coupon-location-usage/:couponCode", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const code = req.params.couponCode.toUpperCase();
      const { maxUsageLimit } = req.body;
      const doc = await hub.CouponLocationUsage.findOneAndUpdate(
        { couponCode: code },
        { maxUsageLimit: maxUsageLimit ?? null },
        { upsert: true, new: true }
      ).lean();
      res.json(doc);
    } catch (err: any) {
      res.status(400).json({ message: err.message || "Failed to update location usage limit" });
    }
  });

  // Assign coupons to a product
  app.patch("/api/products/:id/coupons", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const { couponIds } = req.body as { couponIds: string[] };
      const doc = await hub.Product.findByIdAndUpdate(
        req.params.id,
        { couponIds, updatedAt: new Date() },
        { new: true }
      ).lean();
      if (!doc) return res.status(404).json({ message: "Product not found" });
      res.json(toProduct(doc));
    } catch (err) {
      res.status(500).json({ message: "Failed to update product coupons" });
    }
  });

  // Carousel routes
  app.get("/api/carousel", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Carousel.find({ isActive: true }).sort({ order: 1 }).lean();
    res.json(docs.map(toCarousel));
  });

  app.post("/api/carousel", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertCarouselSlideSchema.parse(req.body);
      const doc = await hub.Carousel.create(input);
      res.status(201).json(toCarousel(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/carousel/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertCarouselSlideSchema.partial().parse(req.body);
      const doc = await hub.Carousel.findByIdAndUpdate(req.params.id, input, { new: true }).lean();
      if (!doc) return res.status(404).json({ message: "Slide not found" });
      res.json(toCarousel(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/carousel/:id", requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (hub) await hub.Carousel.findByIdAndDelete(req.params.id);
    res.status(204).end();
  });

  // Category routes
  app.get("/api/categories", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Category.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json(docs.map(toCategory));
  });

  app.post("/api/categories", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertCategorySchema.parse(req.body);
      const doc = await hub.Category.findOneAndUpdate(
        { name: input.name },
        { $set: input },
        { new: true, upsert: true }
      ).lean();
      res.status(201).json(toCategory(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/categories/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertCategorySchema.partial().parse(req.body);
      const doc = await hub.Category.findByIdAndUpdate(req.params.id, { $set: input }, { new: true }).lean();
      if (!doc) return res.status(404).json({ message: "Category not found" });
      res.json(toCategory(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/categories/:id", requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (hub) await hub.Category.findByIdAndUpdate(req.params.id, { isActive: false });
    res.status(204).end();
  });

  // Sections routes
  app.get("/api/sections", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Section.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json(docs.map(toSection));
  });

  app.post("/api/sections", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertSectionSchema.parse(req.body);
      const doc = await hub.Section.create({
        ...input,
        type: input.type ?? "products",
        isActive: input.isActive ?? true,
      });
      res.status(201).json(toSection(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/sections/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertSectionSchema.partial().parse(req.body);
      const doc = await hub.Section.findByIdAndUpdate(req.params.id, { $set: input }, { new: true }).lean();
      if (!doc) return res.status(404).json({ message: "Section not found" });
      res.json(toSection(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/sections/:id", requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (hub) await hub.Section.findByIdAndDelete(req.params.id);
    res.status(204).end();
  });

  // Combo routes
  app.get("/api/combos", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.json([]);
    const docs = await hub.Combo.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json(docs.map(toCombo));
  });

  app.get("/api/combos/:id", async (req, res) => {
    const hub = await getReqHubModels(req);
    if (!hub) return res.status(404).json({ message: "Combo not found" });
    const doc = await hub.Combo.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ message: "Combo not found" });
    res.json(toCombo(doc));
  });

  app.post("/api/combos", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertComboSchema.parse(req.body);
      const doc = await hub.Combo.create({
        ...input,
        isActive: (input as any).isActive ?? true,
        sortOrder: (input as any).sortOrder ?? 0,
      });
      res.status(201).json(toCombo(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.patch("/api/combos/:id", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      const input = insertComboSchema.partial().parse(req.body);
      const doc = await hub.Combo.findByIdAndUpdate(req.params.id, { $set: input }, { new: true }).lean();
      if (!doc) return res.status(404).json({ message: "Combo not found" });
      res.json(toCombo(doc));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.delete("/api/combos/:id", requireAuth, async (req, res) => {
    const hub = await getReqHubModels(req);
    if (hub) await hub.Combo.findByIdAndUpdate(req.params.id, { isActive: false });
    res.status(204).end();
  });

  // ── Timeslot routes ─────────────────────────────────────────────────────
  const DEFAULT_TIMESLOTS = [
    { label: "Early Morning Delivery", startTime: "5:30 AM", endTime: "7:00 AM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 1 },
    { label: "Morning Delivery", startTime: "7:00 AM", endTime: "8:30 AM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 2 },
    { label: "Late Morning Delivery", startTime: "9:00 AM", endTime: "10:30 AM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 3 },
    { label: "Midday Delivery", startTime: "11:00 AM", endTime: "12:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 4 },
    { label: "Afternoon Delivery", startTime: "2:00 PM", endTime: "3:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 5 },
    { label: "Late Afternoon Delivery", startTime: "4:00 PM", endTime: "5:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 6 },
    { label: "Evening Delivery", startTime: "6:00 PM", endTime: "7:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 7 },
    { label: "Night Delivery", startTime: "8:00 PM", endTime: "9:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 8 },
    { label: "Late Night Delivery", startTime: "10:00 PM", endTime: "11:30 PM", isInstant: false, extraCharge: 0, isActive: true, sortOrder: 9 },
  ];

  const INSTANT_TIMESLOT = {
    id: "instant",
    label: "Instant Delivery",
    startTime: null,
    endTime: null,
    isInstant: true,
    extraCharge: 49,
    isActive: true,
    sortOrder: 0,
  };

  const toTimeslot = (doc: any) => ({
    id: doc._id.toString(),
    label: doc.label,
    startTime: doc.startTime ?? null,
    endTime: doc.endTime ?? null,
    isInstant: doc.isInstant ?? false,
    extraCharge: doc.extraCharge ?? 0,
    isActive: doc.isActive ?? true,
    sortOrder: doc.sortOrder ?? 0,
    orderLimit: doc.orderLimit ?? 10,
    todaysOrderCount: doc.todaysOrderCount ?? 0,
    nextDayOrderCount: doc.nextDayOrderCount ?? 0,
    limitedByOrders: doc.limitedByOrders ?? false,
    activeDays: doc.activeDays ?? [],
  });

  app.get("/api/timeslots", async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.json([]);
      const docs = await hub.Timeslot.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
      res.json(docs.map(toTimeslot));
    } catch {
      res.json([]);
    }
  });

  // Seed default timeslots into the hub DB (admin only)
  app.post("/api/timeslots/seed", requireAuth, async (req, res) => {
    try {
      const hub = await getReqHubModels(req);
      if (!hub) return res.status(400).json({ message: "No hub selected" });
      await hub.Timeslot.deleteMany({ isInstant: { $ne: true } });
      await hub.Timeslot.insertMany(DEFAULT_TIMESLOTS);
      const docs = await hub.Timeslot.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
      res.json([INSTANT_TIMESLOT, ...docs.map(toTimeslot)]);
    } catch (err) {
      res.status(500).json({ message: "Failed to seed timeslots" });
    }
  });

  // ── Customer auth & profile routes ──────────────────────────────────────

  const requireCustomer = (req: any, res: any, next: any) => {
    if (req.session?.customerPhone) return next();
    res.status(401).json({ message: "Not logged in" });
  };

  app.post("/api/customer/request-otp", async (req, res) => {
    const { phone } = req.body;
    if (!phone || !/^\d{10}$/.test(String(phone).trim())) {
      return res.status(400).json({ message: "Valid 10-digit phone number required" });
    }
    const normalised = String(phone).trim();

    // Generate a secure 4-digit OTP and persist to MongoDB (survives restarts + multi-instance)
    const otp = String(Math.floor(1000 + Math.random() * 9000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await OtpModel.findOneAndUpdate(
      { phone: normalised },
      { otp, expiresAt },
      { upsert: true, new: true }
    );

    // Send OTP via Admark WhatsApp
    const admarkApiKey = process.env.ADMARK_API_KEY;
    const admarkPhoneNumberId = process.env.ADMARK_PHONE_NUMBER_ID;
    if (!admarkApiKey || !admarkPhoneNumberId) {
      console.error("[OTP] ADMARK_API_KEY or ADMARK_PHONE_NUMBER_ID not set — OTP not sent via WhatsApp");
      return res.json({ message: "OTP sent" });
    }

    try {
      const destination = `91${normalised}`;
      const params = new URLSearchParams({
        "api-key": admarkApiKey,
        templateName: "fishtokri_website_otp",
        phoneNumber: destination,
        phoneNumberId: admarkPhoneNumberId,
        csvVariables: otp,
      });

      const response = await fetch(`${ADMARK_API_URL}?${params.toString()}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const responseText = await response.text();
      console.log(`[OTP] Admark response ${response.status}:`, responseText);

      if (!response.ok) {
        console.error(`[OTP] Admark error ${response.status}: ${responseText}`);
        return res.status(502).json({ message: "Failed to send OTP. Please try again." });
      }

      console.log(`[OTP] Sent to ${destination} via Admark`);
    } catch (err) {
      console.error("[OTP] Admark request failed:", err);
      return res.status(502).json({ message: "Failed to send OTP. Please try again." });
    }

    res.json({ message: "OTP sent" });
  });

  app.post("/api/customer/verify-otp", async (req, res) => {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) return res.status(400).json({ message: "phone and otp required" });
      const normalised = String(phone).trim();

      // Look up OTP from MongoDB (shared across all PM2 instances and restarts)
      const entry = await OtpModel.findOne({ phone: normalised }).lean() as any;
      if (!entry || new Date() > new Date(entry.expiresAt) || entry.otp !== String(otp).trim()) {
        return res.status(400).json({ message: "Invalid or expired OTP" });
      }

      // Only delete the OTP AFTER a successful upsert so users can retry if DB fails
      const customer = await storage.upsertCustomer(normalised, { phone: normalised });
      await OtpModel.deleteOne({ phone: normalised });

      req.session.customerPhone = normalised;

      // Explicitly save the session before responding to avoid race condition
      // where the response is sent before the session is written to MongoDB
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      res.json(customer);
    } catch (err: any) {
      console.error("[verify-otp] Error:", err);
      res.status(500).json({ message: "Failed to verify OTP. Please try again." });
    }
  });

  app.get("/api/customer/me", requireCustomer, async (req, res) => {
    const customer = await storage.getCustomerByPhone(req.session.customerPhone!);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  });

  app.patch("/api/customer/me", requireCustomer, async (req, res) => {
    const parsed = updateCustomerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const customer = await storage.updateCustomer(req.session.customerPhone!, parsed.data);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  });

  app.post("/api/customer/me/addresses", requireCustomer, async (req, res) => {
    const parsed = insertCustomerAddressSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const customer = await storage.addCustomerAddress(req.session.customerPhone!, parsed.data);
    if (!customer) return res.status(404).json({ message: "Customer not found" });
    res.json(customer);
  });

  app.patch("/api/customer/me/addresses/:addrId", requireCustomer, async (req, res) => {
    try {
      const parsed = insertCustomerAddressSchema.partial().safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
      const customer = await storage.updateCustomerAddress(req.session.customerPhone!, req.params.addrId, parsed.data);
      if (!customer) return res.status(404).json({ message: "Address not found" });
      res.json(customer);
    } catch (err) {
      console.error("updateCustomerAddress error:", err);
      res.status(500).json({ message: "Failed to update address" });
    }
  });

  app.delete("/api/customer/me/addresses/:addrId", requireCustomer, async (req, res) => {
    try {
      const customer = await storage.deleteCustomerAddress(req.session.customerPhone!, req.params.addrId);
      if (!customer) return res.status(404).json({ message: "Address not found" });
      res.json(customer);
    } catch (err) {
      console.error("deleteCustomerAddress error:", err);
      res.status(500).json({ message: "Failed to delete address" });
    }
  });

  app.get("/api/customer/me/orders", requireCustomer, async (req, res) => {
    const phone = req.session.customerPhone!;
    try {
      const orders = await storage.getOrdersByPhone(phone);

      // Enrich order items that are missing imageUrl by looking up the product
      // in the hub's products collection using subHubName + productId.
      const enriched = await Promise.all(orders.map(async (order) => {
        const items: any[] = Array.isArray(order.items) ? order.items : [];
        const dbName = order.subHubName;

        const missingIds = items
          .filter(i => !i.imageUrl && i.productId)
          .map(i => String(i.productId));

        let imageMap: Record<string, string> = {};
        if (missingIds.length > 0 && dbName) {
          try {
            const { getHubModels } = await import("./hubConnections");
            const { Product } = await getHubModels(dbName);
            const products = await (Product as any).find(
              { _id: { $in: missingIds } },
              { imageUrl: 1 }
            ).lean() as any[];
            for (const p of products) {
              if (p.imageUrl) imageMap[String(p._id)] = p.imageUrl;
            }
          } catch { /* ignore hub lookup failures */ }
        }

        const enrichedItems = items.map(item => ({
          ...item,
          imageUrl: item.imageUrl || imageMap[String(item.productId)] || null,
        }));

        return { ...order, items: enrichedItems };
      }));

      res.json(enriched);
    } catch {
      res.json([]);
    }
  });

  app.post("/api/customer/logout", (req, res) => {
    delete req.session.customerPhone;
    res.json({ message: "Logged out" });
  });

  // ── Admin customers route ────────────────────────────────────────────────
  app.get("/api/admin/customers", requireAuth, async (_req, res) => {
    try {
      const customers = await storage.getAllCustomers();
      res.json(customers);
    } catch {
      res.status(500).json({ message: "Failed to fetch customers" });
    }
  });

  return httpServer;
}

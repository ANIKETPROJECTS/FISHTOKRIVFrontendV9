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
import {
  getCheckoutAvailableQuantity,
  findCheckoutStockIssues,
  type CheckoutStockLine,
} from "./checkoutStock";
import Razorpay from "razorpay";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import {
  buildFailedRazorpayPaymentState,
  buildSuccessfulRazorpayPaymentState,
  isRazorpayBackgroundGraceExpired,
  isFtwStorefrontOrder,
  isRazorpayHeartbeatStale,
  isRazorpayPaymentInProgress,
  isSuccessfulRazorpayStatus,
  shouldDeferRazorpayFailure,
  shouldValidatePrePaymentGuards,
} from "./razorpayPayment";

declare module "express-session" {
  interface SessionData {
    customerPhone?: string;
  }
}

const OTP_TTL_MS = 5 * 60 * 1000;
const INDIA_TIME_ZONE = "Asia/Kolkata";
const RAZORPAY_HEARTBEAT_STALE_MS = 2 * 60 * 1000;
const RAZORPAY_HEARTBEAT_RECHECK_MS = 30 * 1000;
const RAZORPAY_HEARTBEAT_WATCHDOG_INTERVAL_MS = 15 * 1000;
const RAZORPAY_BACKGROUND_GRACE_MS = 15 * 60 * 1000;

function hashRazorpayCancelToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function isRazorpayCancelTokenValid(token: unknown, storedHash: unknown): boolean {
  if (typeof token !== "string" || typeof storedHash !== "string") return false;
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^[a-f0-9]{64}$/i.test(storedHash)) return false;
  const suppliedHash = Buffer.from(hashRazorpayCancelToken(token), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");
  return suppliedHash.length === expectedHash.length && timingSafeEqual(suppliedHash, expectedHash);
}

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

  const getCheckoutHubModels = async (dbName: unknown) => {
    if (typeof dbName !== "string" || !dbName.trim()) return null;
    const configuredHub = await SubHubModel.exists({ dbName });
    if (!configuredHub) return null;
    return getHubModels(dbName);
  };

  const validateCheckoutStock = async (hub: any, rawItems: unknown) => {
    if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 100) {
      throw new Error("Invalid checkout items");
    }

    const normalizedItems = (rawItems as any[]).map((rawItem) => {
      const quantity = Number(rawItem?.quantity);
      const productId = String(rawItem?.productId ?? "").trim();
      if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error("Invalid checkout item");
      }
      return { productId, quantity, name: rawItem?.name };
    });
    const sourceIds = [...new Set(normalizedItems
      .map((item) => item.productId)
      .filter((id) => /^[a-f\d]{24}$/i.test(id)))];
    const [sourceProducts, sourceCombos] = sourceIds.length
      ? await Promise.all([
          hub.Product.find({ _id: { $in: sourceIds } }).lean() as Promise<any[]>,
          hub.Combo.find({ _id: { $in: sourceIds } }).lean() as Promise<any[]>,
        ])
      : [[], []];
    const sourceProductsById = new Map(sourceProducts.map((product: any) => [String(product._id), product]));
    const sourceCombosById = new Map(sourceCombos.map((combo: any) => [String(combo._id), combo]));

    const aggregated = new Map<string, CheckoutStockLine>();
    const missingNames = new Map<string, string>();
    const addLine = (productId: unknown, quantity: number, name?: string) => {
      const id = String(productId ?? "").trim();
      if (!id || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Invalid checkout item");
      }
      const existing = aggregated.get(id);
      aggregated.set(id, {
        productId: id,
        quantity: (existing?.quantity ?? 0) + quantity,
        name: existing?.name ?? name,
      });
      if (name && !missingNames.has(id)) missingNames.set(id, name);
    };

    for (const rawItem of normalizedItems) {
      const { productId, quantity } = rawItem;
      const product = sourceProductsById.get(productId);
      if (product) {
        addLine(productId, quantity, product.name ?? rawItem.name);
        continue;
      }

      const combo = sourceCombosById.get(productId);
      if (!combo || combo.isActive === false || !Array.isArray(combo.includes) || combo.includes.length === 0) {
        addLine(productId, quantity, combo?.name ?? rawItem.name);
        continue;
      }

      for (const include of combo.includes) {
        const componentQuantity = Number(include.quantity ?? 1);
        const requiredQuantity = quantity * componentQuantity;
        if (!Number.isInteger(componentQuantity) || componentQuantity <= 0) {
          throw new Error("Invalid combo inventory configuration");
        }
        addLine(include.productId, requiredQuantity, include.label ?? combo.name);
      }
    }

    const productIds = [...aggregated.keys()].filter((id) => /^[a-f\d]{24}$/i.test(id));
    const missingProductIds = productIds.filter((id) => !sourceProductsById.has(id));
    const additionalProducts = missingProductIds.length
      ? await hub.Product.find({ _id: { $in: missingProductIds } }).lean() as any[]
      : [];
    const productsById = new Map(sourceProductsById);
    for (const product of additionalProducts) {
      productsById.set(String(product._id), product);
    }
    const lines = [...aggregated.values()];
    const unavailableItems = findCheckoutStockIssues(lines, productsById, missingNames);

    return { inStock: unavailableItems.length === 0, unavailableItems };
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

    // Match the same authoritative inventory source used by checkout. The
    // separate POS `batches` field is not decremented by storefront orders.
    const availableQty = getCheckoutAvailableQuantity(doc, now);
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
    weight: doc.weight ?? null, imageUrl: doc.imageUrl ?? null, discountedPrice: doc.discountedPrice,
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

  app.post("/api/checkout/stock-check", async (req, res) => {
    try {
      const dbName = req.headers["x-hub-db"];
      const hub = await getCheckoutHubModels(dbName);
      if (!hub) {
        return res.status(400).json({ message: "Please select a valid delivery hub." });
      }
      const result = await validateCheckoutStock(hub, req.body?.items);
      return res.json(result);
    } catch (err: any) {
      if (err?.message?.startsWith("Invalid ")) {
        return res.status(400).json({ message: err.message });
      }
      console.error("[checkout] Stock check failed:", err);
      return res.status(503).json({ message: "Could not verify item availability. Please try again." });
    }
  });

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
      amountPaise: Number(payment.amount ?? 0),
      amount: Number(payment.amount ?? 0) / 100,
      currency: String(payment.currency ?? ""),
    };
  };

  app.post("/api/razorpay/create-order", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    try {
      const { amount, orderPayload } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }
      if (!orderPayload || typeof orderPayload !== "object" || Array.isArray(orderPayload)) {
        return res.status(400).json({ message: "An order payload is required to start payment." });
      }
      const checkoutTotal = Number(orderPayload.total);
      const walletAmount = (Array.isArray(orderPayload.payments) ? orderPayload.payments : [])
        .filter((payment: any) => payment?.mode === "wallet")
        .reduce((sum: number, payment: any) => sum + Number(payment.amount ?? 0), 0);
      const expectedAmountPaise = Math.round((checkoutTotal - walletAmount) * 100);
      if (
        !Number.isFinite(checkoutTotal) ||
        checkoutTotal <= 0 ||
        !Number.isFinite(walletAmount) ||
        expectedAmountPaise <= 0 ||
        Math.round(amount * 100) !== expectedAmountPaise
      ) {
        return res.status(400).json({ message: "Payment amount does not match the checkout total." });
      }
      if (orderPayload && typeof orderPayload === "object") {
        const hub = await getCheckoutHubModels(orderPayload.hubDbName);
        if (!hub) {
          return res.status(400).json({ message: "Please select a valid delivery hub." });
        }
        let stockResult;
        try {
          stockResult = await validateCheckoutStock(hub, orderPayload.items);
        } catch (stockValidationErr: any) {
          if (stockValidationErr?.message?.startsWith("Invalid ")) {
            return res.status(400).json({ message: stockValidationErr.message });
          }
          throw stockValidationErr;
        }
        if (!stockResult.inStock) {
          const names = stockResult.unavailableItems.map((item: any) => item.name).join(", ");
          return res.status(409).json({
            code: "STOCK_UNAVAILABLE",
            message: names
              ? `${names} ${stockResult.unavailableItems.length === 1 ? "is" : "are"} no longer available in the requested quantity.`
              : "One or more items are no longer available in the requested quantity.",
            unavailableItems: stockResult.unavailableItems,
          });
        }

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
      const cancelToken = randomBytes(32).toString("hex");

      // Payment must not be presented to the shopper unless the server has a
      // durable recovery payload and a provisional Order document for
      // webhook/reconciliation finalization.
      try {
        const PendingCheckout = getPendingCheckoutModel();
        await PendingCheckout.findOneAndUpdate(
          { razorpayOrderId: order.id },
          {
            $set: {
              razorpayOrderId: order.id,
              orderPayload,
              amountPaise: order.amount,
              currency: order.currency,
              finalizationStatus: "pending",
              autoRecoveryEligible: true,
              finalizationAttempts: 0,
              finalizedOrderId: null,
              lastFinalizationError: null,
              cancelTokenHash: hashRazorpayCancelToken(cancelToken),
              lastHeartbeatAt: new Date(),
              backgroundedAt: null,
              visibilitySequence: 0,
              heartbeatWatchdogCheckedAt: null,
              heartbeatWatchdogFailedAt: null,
            },
            $setOnInsert: { createdAt: new Date() },
          },
          { upsert: true, new: true },
        );
      } catch (storeErr) {
        console.error("[Razorpay] Failed to store pending checkout; payment order withheld:", storeErr);
        return res.status(503).json({
          message: "Could not safely prepare this payment. Please try again.",
        });
      }

      try {
        const walletPayments = (Array.isArray(orderPayload.payments) ? orderPayload.payments : [])
          .filter((payment: any) => payment?.mode === "wallet");
        const provisionalOrderPayload = {
          ...orderPayload,
          paymentStatus: "pending",
          paymentMode: "upi",
          upiVariant: null,
          upiTransactionId: null,
          paidAmount: 0,
          dueAmount: Math.max(0, checkoutTotal - walletAmount),
          payments: [
            ...walletPayments,
            { mode: "upi", amount, reference: "" },
          ],
          razorpayOrderId: order.id,
        };
        const port = process.env.PORT || "5000";
        const provisionalResponse = await fetch(`http://127.0.0.1:${port}/api/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-FishTokri-Payment-Finalizer": "1",
            "X-FishTokri-Pending-Payment": "1",
          },
          body: JSON.stringify(provisionalOrderPayload),
        });
        if (!provisionalResponse.ok) {
          const details = await provisionalResponse.json().catch(() => ({})) as any;
          await Promise.allSettled([
            getPendingCheckoutModel().deleteOne({ razorpayOrderId: order.id }),
            getOrderModel().deleteOne({ razorpayOrderId: order.id, paymentStatus: "pending" }),
          ]);
          console.error(
            `[Razorpay] Could not create provisional order for ${order.id}:`,
            details?.message ?? provisionalResponse.status,
          );
          return res
            .status(provisionalResponse.status === 409 ? 409 : 503)
            .json(details?.message ? details : { message: "Could not safely prepare this payment. Please try again." });
        }
      } catch (provisionalOrderErr) {
        await Promise.allSettled([
          getPendingCheckoutModel().deleteOne({ razorpayOrderId: order.id }),
          getOrderModel().deleteOne({ razorpayOrderId: order.id, paymentStatus: "pending" }),
        ]);
        console.error("[Razorpay] Failed to create provisional order:", provisionalOrderErr);
        return res.status(503).json({
          message: "Could not safely prepare this payment. Please try again.",
        });
      }

      return res.json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        cancel_token: cancelToken,
      });
    } catch (err: any) {
      console.error("[Razorpay] create-order error:", err);
      return res.status(500).json({ message: "Failed to create payment order" });
    }
  });

  const finalizeCapturedRazorpayPayment = async (
    razorpayOrderId: string,
    razorpayPaymentId: string,
  ) => {
    const verifiedPayment = await fetchVerifiedRazorpayPayment(razorpayOrderId, razorpayPaymentId);
    if (!verifiedPayment) {
      throw Object.assign(new Error("Razorpay payment has not been captured."), { statusCode: 400 });
    }
    if (verifiedPayment.currency && verifiedPayment.currency !== "INR") {
      throw Object.assign(new Error("Razorpay payment currency does not match the checkout."), { statusCode: 400 });
    }

    const PendingCheckout = getPendingCheckoutModel();
    const OrderModel = getOrderModel();
    const pending = await PendingCheckout.findOne({ razorpayOrderId }).lean() as any;
    if (!pending?.orderPayload) {
      throw Object.assign(new Error("No recoverable checkout payload exists for this payment."), { statusCode: 503 });
    }
    if (pending.amountPaise != null && Number(pending.amountPaise) !== verifiedPayment.amountPaise) {
      throw Object.assign(new Error("Captured payment amount does not match the stored checkout."), { statusCode: 400 });
    }
    if (pending.currency && verifiedPayment.currency && pending.currency !== verifiedPayment.currency) {
      throw Object.assign(new Error("Captured payment currency does not match the stored checkout."), { statusCode: 400 });
    }

    const markFinalized = async (order: any) => {
      await PendingCheckout.updateOne(
        { razorpayOrderId },
        {
          $set: {
            finalizationStatus: "finalized",
            finalizationLockAt: null,
            finalizedOrderId: order?.orderId ? String(order.orderId) : null,
            lastFinalizationError: null,
            lastAttemptAt: new Date(),
          },
        },
      );
      return order;
    };

    const findExistingOrder = () => OrderModel.findOne({
      $or: [
        { razorpayOrderId },
        { "payments.reference": razorpayPaymentId },
        { upiTransactionId: razorpayPaymentId },
      ],
    }).lean() as Promise<any>;

    const buildVerifiedOrderPayload = (sourcePayload: any) => {
      const walletPayments = (sourcePayload.payments ?? [])
        .filter((payment: any) => payment.mode === "wallet");
      return {
        ...sourcePayload,
        razorpayOrderId,
        ...buildSuccessfulRazorpayPaymentState({
          total: Number(sourcePayload.total ?? verifiedPayment.amount),
          paymentAmount: verifiedPayment.amount,
          paymentId: verifiedPayment.id,
          existingPayments: walletPayments,
        }),
      };
    };

    const postOrder = (orderPayload: any, allowInventoryReview: boolean) => {
      const port = process.env.PORT || "5000";
      return fetch(`http://127.0.0.1:${port}/api/orders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-FishTokri-Payment-Finalizer": "1",
          ...(allowInventoryReview ? { "X-FishTokri-Paid-Recovery": "1" } : {}),
        },
        body: JSON.stringify(orderPayload),
      });
    };

    const repairExistingOrder = async (existing: any) => {
      let orderToRepair = existing;
      const latestFinalization = !orderToRepair.orderId
        ? await PendingCheckout.findOne({ razorpayOrderId })
            .select("finalizationStatus finalizationLockAt")
            .lean() as any
        : null;
      const finalizationState = latestFinalization ?? pending;
      const hasActiveFinalizationLease =
        finalizationState.finalizationStatus === "processing" &&
        finalizationState.finalizationLockAt &&
        new Date(finalizationState.finalizationLockAt).getTime() > Date.now() - 2 * 60 * 1000;
      if (!orderToRepair.orderId && hasActiveFinalizationLease) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 250));
          const fresh = await OrderModel.findById(existing._id).lean() as any;
          if (fresh?.orderId) {
            orderToRepair = fresh;
            break;
          }
        }
        if (!orderToRepair.orderId) {
          throw Object.assign(new Error("The order is still being saved; retry shortly."), { statusCode: 503 });
        }
      }
      if (!isFtwStorefrontOrder(orderToRepair)) {
        throw Object.assign(new Error("This payment is linked to a non-storefront order and needs manual review."), { statusCode: 409 });
      }
      if (!orderToRepair.orderId) {
        const generatedOrderId = await generateOrderId();
        const assigned = await OrderModel.findOneAndUpdate(
          {
            _id: orderToRepair._id,
            $or: [{ orderId: null }, { orderId: { $exists: false } }, { orderId: "" }],
          },
          { $set: { orderId: generatedOrderId, updatedAt: new Date() } },
          { new: true },
        ).lean() as any;
        orderToRepair = assigned ?? await OrderModel.findById(orderToRepair._id).lean() as any;
        if (!orderToRepair?.orderId) {
          throw Object.assign(new Error("The storefront order number is still being assigned."), { statusCode: 503 });
        }
      }
      if (["pending", "failed"].includes(String(orderToRepair.paymentStatus))) {
        const orderPayload = buildVerifiedOrderPayload(pending.orderPayload);
        let createResponse = await postOrder(orderPayload, false);
        if (createResponse.status === 409) {
          const conflict = await createResponse.json().catch(() => ({})) as any;
          if (conflict.code === "STOCK_UNAVAILABLE") {
            createResponse = await postOrder(orderPayload, true);
          } else {
            throw Object.assign(new Error("Order finalization was rejected."), { statusCode: 503 });
          }
        }
        if (!createResponse.ok) {
          throw Object.assign(new Error(`Order finalization endpoint returned ${createResponse.status}.`), { statusCode: 503 });
        }
        const finalized = await createResponse.json() as any;
        const savedOrder = await OrderModel.findOne({ razorpayOrderId }).select("orderId").lean() as any;
        const finalizedOrderId = savedOrder?.orderId ?? finalized.orderId;
        if (!finalizedOrderId) {
          throw Object.assign(new Error("The storefront order number has not been saved yet."), { statusCode: 503 });
        }
        await markFinalized({ orderId: finalizedOrderId });
        return finalized;
      }
      const paymentState = buildSuccessfulRazorpayPaymentState({
        total: Number(orderToRepair.total ?? verifiedPayment.amount),
        paymentAmount: verifiedPayment.amount,
        paymentId: verifiedPayment.id,
        existingPayments: orderToRepair.payments,
      });
      const repaired = await OrderModel.findByIdAndUpdate(
        orderToRepair._id,
        {
          $set: { ...paymentState, razorpayOrderId, updatedAt: new Date() },
          $unset: { pendingPaymentExpiresAt: 1 },
        },
        { new: true },
      ).lean();
      return markFinalized({ ...(repaired ?? orderToRepair), id: String(orderToRepair._id) });
    };

    const existing = await findExistingOrder();
    if (existing) return repairExistingOrder(existing);
    // Historical records without an explicit eligibility marker may already
    // have a manual replacement order. Repair existing FTW orders above, but
    // never create a new order automatically for those records.
    if (
      pending.autoRecoveryEligible !== true ||
      !["pending", "retryable", "processing", "finalized"].includes(pending.finalizationStatus)
    ) {
      throw Object.assign(new Error("This older checkout requires manual review."), { statusCode: 409 });
    }
    if (pending.finalizationStatus === "finalized") {
      throw Object.assign(new Error("Finalization is marked complete but its order cannot be found."), { statusCode: 503 });
    }

    const now = new Date();
    const staleLockBefore = new Date(now.getTime() - 2 * 60 * 1000);
    const claimed = await PendingCheckout.findOneAndUpdate(
      {
        razorpayOrderId,
        finalizationStatus: { $in: ["pending", "retryable", "processing"] },
        $or: [
          { finalizationStatus: { $ne: "processing" } },
          { finalizationLockAt: { $lte: staleLockBefore } },
          { finalizationLockAt: null },
        ],
      },
      {
        $set: {
          finalizationStatus: "processing",
          finalizationLockAt: now,
          lastAttemptAt: now,
          lastFinalizationError: null,
        },
        $inc: { finalizationAttempts: 1 },
      },
      { new: true },
    ).lean();

    if (!claimed) {
      for (let attempt = 0; attempt < 12; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const concurrentOrder = await findExistingOrder();
        if (concurrentOrder) return repairExistingOrder(concurrentOrder);
      }
      throw Object.assign(new Error("Payment finalization is already in progress; retry shortly."), { statusCode: 503 });
    }

    try {
      const orderPayload = buildVerifiedOrderPayload(pending.orderPayload);
      let createResponse = await postOrder(orderPayload, false);
      if (createResponse.status === 409) {
        const conflict = await createResponse.json().catch(() => ({})) as any;
        if (conflict.code === "STOCK_UNAVAILABLE") {
          createResponse = await postOrder(orderPayload, true);
        } else {
          throw Object.assign(new Error("Order finalization was rejected."), { statusCode: 503 });
        }
      }
      if (!createResponse.ok) {
        throw Object.assign(new Error(`Order finalization endpoint returned ${createResponse.status}.`), { statusCode: 503 });
      }

      const created = await createResponse.json() as any;
      const savedOrder = await OrderModel.findOne({ razorpayOrderId }).select("orderId").lean() as any;
      const finalizedOrderId = savedOrder?.orderId ?? created.orderId;
      if (!finalizedOrderId) {
        throw Object.assign(new Error("The storefront order number has not been saved yet."), { statusCode: 503 });
      }
      await markFinalized({ orderId: finalizedOrderId });
      return created;
    } catch (error) {
      await PendingCheckout.updateOne(
        { razorpayOrderId, finalizationStatus: "processing" },
        {
          $set: {
            finalizationStatus: "retryable",
            finalizationLockAt: null,
            lastAttemptAt: new Date(),
            lastFinalizationError: "Order creation did not complete.",
          },
        },
      );
      throw error;
    }
  };

  app.post("/api/razorpay/finalize-order", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    const razorpayOrderId = String(req.body?.razorpayOrderId ?? "");
    const razorpayPaymentId = String(req.body?.razorpayPaymentId ?? "");
    if (!razorpayOrderId || !razorpayPaymentId) {
      return res.status(400).json({ message: "Razorpay order and payment IDs are required." });
    }
    try {
      const order = await finalizeCapturedRazorpayPayment(razorpayOrderId, razorpayPaymentId);
      return res.json(order);
    } catch (error: any) {
      console.error(`[Razorpay finalize] Failed for order ${razorpayOrderId}:`, error?.message ?? "unknown error");
      const statusCode = error?.statusCode === 400 || error?.statusCode === 409 ? error.statusCode : 503;
      return res.status(statusCode).json({
        message: error?.message || "Could not finalize payment. It will be retried.",
      });
    }
  });

  const markPendingRazorpayOrderFailed = async (
    razorpayOrderId: string,
    failedPayment?: any,
  ): Promise<{ result: "failed" | "completed" | "processing"; order?: any }> => {
    const OrderModel = getOrderModel();
    const existingOrder = await OrderModel.findOne({ razorpayOrderId }).lean() as any;
    if (["completed", "paid"].includes(String(existingOrder?.paymentStatus))) {
      return { result: "completed", order: existingOrder };
    }
    if (!existingOrder || !["pending", "failed"].includes(String(existingOrder.paymentStatus))) {
      return { result: "processing", order: existingOrder };
    }

    const existingUpiPayment = Array.isArray(existingOrder.payments)
      ? existingOrder.payments.find((payment: any) => payment?.mode === "upi")
      : null;
    const providerAmountPaise = Number(failedPayment?.amount);
    const paymentAmount =
      Number.isFinite(providerAmountPaise) && providerAmountPaise > 0
        ? providerAmountPaise / 100
        : Number(existingUpiPayment?.amount ?? 0);
    const failedState = buildFailedRazorpayPaymentState({
      paymentAmount,
      paymentId: failedPayment?.id ? String(failedPayment.id) : null,
      existingPayments: existingOrder.payments,
    });
    const now = new Date();
    const failedOrder = await OrderModel.findOneAndUpdate(
      {
        razorpayOrderId,
        paymentStatus: { $in: ["pending", "failed"] },
      },
      {
        $set: { ...failedState, updatedAt: now },
        $unset: { pendingPaymentExpiresAt: 1 },
      },
      { new: true },
    ).lean();

    if (failedOrder) {
      await getPendingCheckoutModel().updateOne(
        { razorpayOrderId },
        { $set: { heartbeatWatchdogCheckedAt: now, heartbeatWatchdogFailedAt: now } },
      );
      return { result: "failed", order: failedOrder };
    }

    const currentOrder = await OrderModel.findOne({ razorpayOrderId }).lean() as any;
    if (["completed", "paid"].includes(String(currentOrder?.paymentStatus))) {
      return { result: "completed", order: currentOrder };
    }
    if (currentOrder?.paymentStatus === "failed") {
      await getPendingCheckoutModel().updateOne(
        { razorpayOrderId },
        { $set: { heartbeatWatchdogCheckedAt: now, heartbeatWatchdogFailedAt: now } },
      );
      return { result: "failed", order: currentOrder };
    }
    return { result: "processing", order: currentOrder };
  };

  app.post("/api/razorpay/checkout-heartbeat", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    const razorpayOrderId = String(req.body?.razorpayOrderId ?? "");
    const cancelToken = req.body?.cancelToken;
    const visibility = req.body?.visibility === "hidden" ? "hidden" : "visible";
    const hasVisibilitySequence =
      Number.isSafeInteger(req.body?.visibilitySequence) &&
      Number(req.body.visibilitySequence) >= 0;
    const visibilitySequence = hasVisibilitySequence
      ? Number(req.body.visibilitySequence)
      : null;
    if (!razorpayOrderId || typeof cancelToken !== "string") {
      return res.status(400).json({ message: "Razorpay order and cancellation token are required." });
    }

    try {
      const PendingCheckout = getPendingCheckoutModel();
      const pending = await PendingCheckout.findOne({ razorpayOrderId }).lean() as any;
      if (!pending || !isRazorpayCancelTokenValid(cancelToken, pending.cancelTokenHash)) {
        return res.status(404).json({ message: "Pending checkout was not found." });
      }

      const existingOrder = await getOrderModel().findOne({ razorpayOrderId }).lean() as any;
      if (["completed", "paid"].includes(String(existingOrder?.paymentStatus))) {
        return res.json({ result: "completed" });
      }
      if (existingOrder?.paymentStatus === "failed") {
        const payments = await (razorpay as any).orders.fetchPayments(razorpayOrderId);
        const captured = (payments.items ?? []).find((payment: any) => payment.status === "captured");
        if (captured?.id) {
          await finalizeCapturedRazorpayPayment(razorpayOrderId, String(captured.id));
          return res.json({ result: "completed" });
        }
        return res.json({ result: "failed" });
      }

      if (existingOrder?.pendingPaymentExpiresAt) {
        await getOrderModel().updateOne(
          { razorpayOrderId, paymentStatus: "pending" },
          { $unset: { pendingPaymentExpiresAt: 1 } },
        );
      }

      const now = new Date();
      const heartbeatFilter: any = {
        razorpayOrderId,
        cancelTokenHash: pending.cancelTokenHash,
        finalizationStatus: { $in: ["pending", "retryable", "processing"] },
        heartbeatWatchdogFailedAt: null,
      };
      if (visibilitySequence !== null) {
        heartbeatFilter.$or = [
          { visibilitySequence: { $lte: visibilitySequence } },
          { visibilitySequence: { $exists: false } },
        ];
      }
      const heartbeatSet: Record<string, unknown> = {
        lastHeartbeatAt: now,
        backgroundedAt: visibility === "hidden" ? now : null,
        heartbeatWatchdogCheckedAt: null,
      };
      if (visibilitySequence !== null) {
        heartbeatSet.visibilitySequence = visibilitySequence;
      }
      const heartbeat = await PendingCheckout.findOneAndUpdate(
        heartbeatFilter,
        { $set: heartbeatSet },
        { new: true },
      ).select("_id").lean();
      return res.json({ result: heartbeat ? "active" : "inactive" });
    } catch (error: any) {
      console.error(`[Razorpay heartbeat] Could not update ${razorpayOrderId}:`, error?.message ?? "unknown error");
      return res.status(503).json({ message: "Could not update the payment heartbeat." });
    }
  });

  app.post("/api/razorpay/cancel-order", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    const razorpayOrderId = String(req.body?.razorpayOrderId ?? "");
    const cancelToken = req.body?.cancelToken;
    const reportedPaymentId = typeof req.body?.paymentId === "string"
      ? req.body.paymentId.trim()
      : "";
    const reportedFailure = req.body?.reason === "failed";
    const explicitAbandonment = req.body?.reason === "abandoned";
    if (!razorpayOrderId || typeof cancelToken !== "string") {
      return res.status(400).json({ message: "Razorpay order and cancellation token are required." });
    }

    try {
      const pending = await getPendingCheckoutModel().findOne({ razorpayOrderId }).lean() as any;
      if (!pending || !isRazorpayCancelTokenValid(cancelToken, pending.cancelTokenHash)) {
        return res.status(404).json({ message: "Pending checkout was not found." });
      }

      const existingOrder = await getOrderModel().findOne({ razorpayOrderId }).lean() as any;
      if (["completed", "paid"].includes(String(existingOrder?.paymentStatus))) {
        return res.json({ result: "completed", order: existingOrder });
      }

      const payments = await (razorpay as any).orders.fetchPayments(razorpayOrderId);
      let reportedPayment: any = null;
      if (reportedPaymentId) {
        try {
          reportedPayment = await (razorpay as any).payments.fetch(reportedPaymentId);
        } catch (paymentFetchError) {
          if (!reportedFailure) throw paymentFetchError;
          console.warn(`[Razorpay cancel] Could not fetch reported failed payment ${reportedPaymentId}; checking the order payment list.`);
        }
      }
      if (reportedPayment && String(reportedPayment.order_id) !== razorpayOrderId) {
        return res.status(400).json({ message: "Payment does not belong to this checkout." });
      }
      const captured =
        (payments.items ?? []).find((payment: any) => payment.status === "captured") ??
        (reportedPayment?.status === "captured" ? reportedPayment : null);
      if (captured?.id) {
        const finalizedOrder = await finalizeCapturedRazorpayPayment(
          razorpayOrderId,
          String(captured.id),
        );
        return res.json({ result: "completed", order: finalizedOrder });
      }

      const paymentInProgress = (payments.items ?? []).some((payment: any) =>
        isRazorpayPaymentInProgress(payment.status),
      ) || isRazorpayPaymentInProgress(reportedPayment?.status);
      if (shouldDeferRazorpayFailure(paymentInProgress, explicitAbandonment)) {
        return res.json({ result: "processing", deleted: false });
      }

      const failedPayments = (payments.items ?? [])
        .filter((payment: any) => payment.status === "failed")
        .sort((a: any, b: any) => Number(a.created_at ?? 0) - Number(b.created_at ?? 0));
      const failedPayment =
        reportedPayment?.status === "failed"
          ? reportedPayment
          : failedPayments[failedPayments.length - 1];
      const failure = await markPendingRazorpayOrderFailed(
        razorpayOrderId,
        failedPayment ?? (reportedFailure && reportedPaymentId ? { id: reportedPaymentId } : undefined),
      );
      return res.json({ ...failure, deleted: false });
    } catch (error: any) {
      console.error(`[Razorpay cancel] Could not safely cancel ${razorpayOrderId}:`, error?.message ?? "unknown error");
      return res.status(503).json({
        message: "Could not verify the payment state. The pending order will expire automatically.",
      });
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
    if (event.event !== "payment.captured") {
      return res.status(200).json({ message: "Event ignored" });
    }
    const payment = event.payload?.payment?.entity;
    if (!payment?.id || !payment?.order_id) {
      return res.status(400).json({ message: "Invalid payment payload" });
    }

    try {
      await finalizeCapturedRazorpayPayment(String(payment.order_id), String(payment.id));
      return res.status(200).json({ message: "OK" });
    } catch (error: any) {
      console.error(
        `[Razorpay webhook] Finalization failed for order ${payment.order_id}:`,
        error?.message ?? "unknown error",
      );
      if (error?.statusCode === 400 || error?.statusCode === 409) {
        return res.status(200).json({ message: "Payment requires manual review" });
      }
      return res.status(503).json({ message: "Order finalization will be retried" });
    }
  });

  if (razorpay) {
    let heartbeatWatchdogRunning = false;
    const staleHeartbeatFilter = (staleBefore: Date) => ({
      $or: [
        { lastHeartbeatAt: { $lte: staleBefore } },
        { $and: [{ lastHeartbeatAt: null }, { createdAt: { $lte: staleBefore } }] },
      ],
    });
    const backgroundGraceFilter = (graceExpiredBefore: Date) => ({
      $or: [
        { backgroundedAt: null },
        { backgroundedAt: { $lte: graceExpiredBefore } },
      ],
    });
    const reconcileAbandonedCheckouts = async () => {
      if (heartbeatWatchdogRunning) return;
      heartbeatWatchdogRunning = true;
      try {
        const PendingCheckout = getPendingCheckoutModel();
        const now = new Date();
        const staleBefore = new Date(now.getTime() - RAZORPAY_HEARTBEAT_STALE_MS);
        const recheckBefore = new Date(now.getTime() - RAZORPAY_HEARTBEAT_RECHECK_MS);
        const backgroundGraceBefore = new Date(now.getTime() - RAZORPAY_BACKGROUND_GRACE_MS);
        const candidates = await PendingCheckout.find({
          createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          autoRecoveryEligible: true,
          finalizationStatus: { $in: ["pending", "retryable"] },
          heartbeatWatchdogFailedAt: null,
          $and: [
            staleHeartbeatFilter(staleBefore),
            backgroundGraceFilter(backgroundGraceBefore),
            {
              $or: [
                { heartbeatWatchdogCheckedAt: null },
                { heartbeatWatchdogCheckedAt: { $lte: recheckBefore } },
              ],
            },
          ],
        }).sort({ lastHeartbeatAt: 1, createdAt: 1 }).limit(25).lean() as any[];

        for (const candidate of candidates) {
          try {
            const checkedAt = new Date();
            const staleAtCheck = new Date(checkedAt.getTime() - RAZORPAY_HEARTBEAT_STALE_MS);
            const recheckAtCheck = new Date(checkedAt.getTime() - RAZORPAY_HEARTBEAT_RECHECK_MS);
            const backgroundGraceAtCheck = new Date(checkedAt.getTime() - RAZORPAY_BACKGROUND_GRACE_MS);
            const checkout = await PendingCheckout.findOneAndUpdate(
              {
                _id: candidate._id,
                autoRecoveryEligible: true,
                finalizationStatus: { $in: ["pending", "retryable"] },
                heartbeatWatchdogFailedAt: null,
                $and: [
                  staleHeartbeatFilter(staleAtCheck),
                  backgroundGraceFilter(backgroundGraceAtCheck),
                  {
                    $or: [
                      { heartbeatWatchdogCheckedAt: null },
                      { heartbeatWatchdogCheckedAt: { $lte: recheckAtCheck } },
                    ],
                  },
                ],
              },
              { $set: { heartbeatWatchdogCheckedAt: checkedAt } },
              { new: true },
            ).select("razorpayOrderId lastHeartbeatAt backgroundedAt createdAt").lean() as any;
            if (
              !checkout ||
              !isRazorpayHeartbeatStale({
                lastHeartbeatAt: checkout.lastHeartbeatAt,
                createdAt: checkout.createdAt,
                nowMs: Date.now(),
                staleAfterMs: RAZORPAY_HEARTBEAT_STALE_MS,
              })
            ) {
              continue;
            }

            const payments = await (razorpay as any).orders.fetchPayments(checkout.razorpayOrderId);
            const captured = (payments.items ?? []).find((payment: any) => payment.status === "captured");
            if (captured?.id) {
              await finalizeCapturedRazorpayPayment(
                String(checkout.razorpayOrderId),
                String(captured.id),
              );
              continue;
            }

            // A heartbeat timeout means the checkout owner is gone. If Razorpay
            // has not captured payment, retain the same order as failed. A later
            // capture is still allowed to finalize it through the webhook path.
            const latest = await PendingCheckout.findById(checkout._id)
              .select("lastHeartbeatAt backgroundedAt createdAt heartbeatWatchdogFailedAt")
              .lean() as any;
            if (
              !latest ||
              latest.heartbeatWatchdogFailedAt ||
              !isRazorpayBackgroundGraceExpired({
                backgroundedAt: latest.backgroundedAt,
                nowMs: Date.now(),
                graceMs: RAZORPAY_BACKGROUND_GRACE_MS,
              }) ||
              !isRazorpayHeartbeatStale({
                lastHeartbeatAt: latest.lastHeartbeatAt,
                createdAt: latest.createdAt,
                nowMs: Date.now(),
                staleAfterMs: RAZORPAY_HEARTBEAT_STALE_MS,
              })
            ) {
              continue;
            }

            const failedPayments = (payments.items ?? [])
              .filter((payment: any) => payment.status === "failed")
              .sort((a: any, b: any) => Number(b.created_at ?? 0) - Number(a.created_at ?? 0));
            const failure = await markPendingRazorpayOrderFailed(
              String(checkout.razorpayOrderId),
              failedPayments[0],
            );
            if (failure.result === "completed") continue;

            const failedAt = new Date();
            await PendingCheckout.updateOne(
              { _id: checkout._id, heartbeatWatchdogFailedAt: null },
              { $set: { heartbeatWatchdogCheckedAt: failedAt, heartbeatWatchdogFailedAt: failedAt } },
            );
            if (failure.result === "failed") {
              console.info(
                `[Razorpay heartbeat] Marked abandoned checkout ${checkout.razorpayOrderId} failed.`,
              );
            }
          } catch (error: any) {
            console.error(
              `[Razorpay heartbeat] Watchdog check failed for ${candidate.razorpayOrderId}:`,
              error?.message ?? "unknown error",
            );
          }
        }
      } catch (error) {
        console.error("[Razorpay heartbeat] Pending checkout scan failed:", error);
      } finally {
        heartbeatWatchdogRunning = false;
      }
    };

    const heartbeatWatchdogTimer = setInterval(() => {
      void reconcileAbandonedCheckouts();
    }, RAZORPAY_HEARTBEAT_WATCHDOG_INTERVAL_MS);
    heartbeatWatchdogTimer.unref?.();
    void reconcileAbandonedCheckouts();
  }

  if (razorpay && process.env.NODE_ENV === "production") {
    let reconciliationRunning = false;
    const reconcilePendingCheckouts = async () => {
      if (reconciliationRunning) return;
      reconciliationRunning = true;
      try {
        const PendingCheckout = getPendingCheckoutModel();
        const now = new Date();
        const retryBefore = new Date(now.getTime() - 5 * 60 * 1000);
        const staleLockBefore = new Date(now.getTime() - 2 * 60 * 1000);
        const pendingCheckouts = await PendingCheckout.find({
          createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          autoRecoveryEligible: true,
          finalizationStatus: { $in: ["pending", "retryable", "processing"] },
          $and: [
            {
              $or: [
                { finalizationStatus: { $ne: "processing" } },
                { finalizationLockAt: { $lte: staleLockBefore } },
                { finalizationLockAt: null },
              ],
            },
            {
              $or: [
                { reconciliationCheckedAt: null },
                { reconciliationCheckedAt: { $lte: retryBefore } },
              ],
            },
          ],
        }).sort({ createdAt: 1 }).limit(20).lean() as any[];

        for (const pending of pendingCheckouts) {
          await PendingCheckout.updateOne(
            { _id: pending._id },
            { $set: { reconciliationCheckedAt: new Date() } },
          );
          try {
            const payments = await (razorpay as any).orders.fetchPayments(pending.razorpayOrderId);
            const captured = (payments.items ?? []).find((item: any) => item.status === "captured");
            if (captured?.id) {
              await finalizeCapturedRazorpayPayment(
                String(pending.razorpayOrderId),
                String(captured.id),
              );
            }
          } catch (error: any) {
            console.error(
              `[Razorpay reconcile] Retry failed for order ${pending.razorpayOrderId}:`,
              error?.message ?? "unknown error",
            );
          }
        }
      } catch (error) {
        console.error("[Razorpay reconcile] Pending checkout scan failed:", error);
      } finally {
        reconciliationRunning = false;
      }
    };
    const reconciliationTimer = setInterval(() => {
      void reconcilePendingCheckouts();
    }, 5 * 60 * 1000);
    reconciliationTimer.unref?.();
  }

  // Mobile UPI return: check if a Razorpay order has been paid (verifies server-side)
  app.get("/api/razorpay/order-status/:orderId", async (req, res) => {
    if (!razorpay) return res.status(503).json({ message: "Payment service not configured" });
    try {
      const { orderId } = req.params;
      const payments = await razorpay.orders.fetchPayments(orderId) as any;
      const captured = (payments.items ?? []).find(
        (p: any) => p.status === "captured"
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
      if (generated !== razorpay_signature) {
        return res.status(400).json({ verified: false, message: "Signature mismatch" });
      }
      const payment = await fetchVerifiedRazorpayPayment(razorpay_order_id, razorpay_payment_id);
      if (!payment) {
        return res.status(400).json({ verified: false, message: "Razorpay payment is not captured" });
      }
      return res.json({ verified: true });
    } catch (err) {
      console.error("[Razorpay] verify error:", err);
      return res.status(500).json({ message: "Verification error" });
    }
  });

  // Orders routes
  app.post(api.orders.create.path, async (req, res) => {
    try {
      const input = api.orders.create.input.parse(req.body);
      const localAddress = req.socket.remoteAddress ?? "";
      const isLocalRequest =
        localAddress === "127.0.0.1" ||
        localAddress === "::1" ||
        localAddress === "::ffff:127.0.0.1";
      const isInternalPaymentFinalizer =
        req.headers["x-fishtokri-payment-finalizer"] === "1" && isLocalRequest;
      const isPaidWebhookRecovery =
        req.headers["x-fishtokri-paid-recovery"] === "1" &&
        isInternalPaymentFinalizer;
      const isPendingRazorpayCreation =
        req.headers["x-fishtokri-pending-payment"] === "1" &&
        isInternalPaymentFinalizer;
      const requestUpiReference =
        (input.payments ?? []).find((payment: any) => payment.mode === "upi" && payment.reference)?.reference ?? null;

      // All Razorpay order writes must pass through the serialized finalizer.
      if ((input.razorpayOrderId || requestUpiReference) && !isInternalPaymentFinalizer) {
        return res.status(403).json({ message: "Razorpay orders must use the payment finalization endpoint." });
      }

      if (isPendingRazorpayCreation) {
        if (!input.razorpayOrderId || input.paymentStatus !== "pending" || requestUpiReference) {
          return res.status(400).json({ message: "Incomplete pending Razorpay order details." });
        }
        const pendingCheckout = await getPendingCheckoutModel().findOne({
          razorpayOrderId: input.razorpayOrderId,
          finalizationStatus: "pending",
          autoRecoveryEligible: true,
        }).select("_id").lean();
        if (!pendingCheckout) {
          return res.status(404).json({ message: "The pending checkout recovery record was not found." });
        }
      }

      let verifiedRazorpayPayment: Awaited<ReturnType<typeof fetchVerifiedRazorpayPayment>> | null = null;
      let inventoryReviewRequired = isPaidWebhookRecovery;
      if (input.razorpayOrderId || requestUpiReference) {
        if (isPendingRazorpayCreation) {
          // The internal create-order route is writing the provisional record
          // before the customer can reach Razorpay; there is no payment ID yet.
        } else if (!input.razorpayOrderId || !requestUpiReference) {
          return res.status(400).json({ message: "Incomplete Razorpay payment details" });
        } else {
          try {
            verifiedRazorpayPayment = await fetchVerifiedRazorpayPayment(
              input.razorpayOrderId,
              requestUpiReference,
            );
          } catch (paymentErr) {
            console.error("[Razorpay] Payment verification lookup failed:", paymentErr);
            return res.status(502).json({ message: "Could not verify Razorpay payment" });
          }
          if (!verifiedRazorpayPayment) {
            return res.status(400).json({ message: "Razorpay payment is not captured" });
          }
        }
      }
      const runPrePaymentGuards = shouldValidatePrePaymentGuards(!!verifiedRazorpayPayment);

      // Preorder dates are product eligibility metadata, not a client-trusted
      // calendar choice. Re-read the current products and validate the one
      // shared delivery date before payment capture or order persistence.
      if (input.orderType === "preorder" && runPrePaymentGuards) {
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
      let pendingExistingOrderId: string | null = null;
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
          const verifiedPayment = verifiedRazorpayPayment;
          if (!verifiedPayment) {
            return res.status(400).json({ message: "Razorpay payment is not captured" });
          }

          if (isFtwStorefrontOrder(existing)) {
            if (["pending", "failed"].includes(String(existing.paymentStatus))) {
              pendingExistingOrderId = String(existing._id);
            } else {
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
                  $unset: { pendingPaymentExpiresAt: 1 },
                },
                { new: true },
              ).lean();
              console.log(`[order:dedupe] Repaired FTW payment metadata for ${verifiedPayment.id}`);
              return res.status(200).json({ ...repaired, id: String(existing._id) });
            }
          }

          console.warn(`[order:dedupe] Duplicate order-create request for razorpay reference=${upiReference} — returning existing order ${existing.orderId ?? existing._id}`);
          return res.status(200).json({ ...existing, id: String(existing._id) });
        }
      }

      // Validate the selected slot against the requested calendar date on the
      // server as well as in the checkout UI. This prevents a stale tab or a
      // handcrafted request from ordering on a weekday that the admin disabled.
      if (runPrePaymentGuards && input.timeslotId && input.hubDbName && input.scheduleType !== "instant") {
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
      if (runPrePaymentGuards && input.hubDbName && input.couponCode) {
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

      // The Admin panel owns inventory deduction. Validate current stock here,
      // but never decrement quantity or batches while punching a storefront order.
      if (input.hubDbName && !isPaidWebhookRecovery) {
        const inventoryHub = await getHubModels(input.hubDbName);
        const stockResult = await validateCheckoutStock(inventoryHub, input.items);
        if (!stockResult.inStock) {
          if (verifiedRazorpayPayment) {
            // Payment is already captured: retain the order for Admin to review
            // and perform the inventory deduction rather than discarding a paid order.
            inventoryReviewRequired = true;
            console.warn(
              "[Inventory] Persisting captured Razorpay order for Admin review; stock changed before order save.",
            );
          } else {
            const names = stockResult.unavailableItems.map((item: any) => item.name).join(", ");
            return res.status(409).json({
              code: "STOCK_UNAVAILABLE",
              message: names
                ? `${names} ${stockResult.unavailableItems.length === 1 ? "is" : "are"} no longer available in the requested quantity.`
                : "One or more items are no longer available in the requested quantity.",
            });
          }
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
      if (!verifiedRazorpayPayment && input.hubDbName && (input.deliveryType ?? "delivery") === "delivery") {
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
        inventoryDeducted: false,
        inventoryReviewRequired,
         orderType: input.orderType ?? null,
        scheduleType: input.scheduleType ?? "slot",
        deliveryDate,
        timeslotId: input.timeslotId ?? null,
        timeslotLabel: input.timeslotLabel ?? null,
        timeslotStart: input.timeslotStart ?? null,
        timeslotEnd: input.timeslotEnd ?? null,
        razorpayOrderId: verifiedRazorpayPayment?.orderId ?? input.razorpayOrderId ?? null,
      };

      const OrderModel = getOrderModel();
      let order: any;
      let generatedOrderId: string;
      if (pendingExistingOrderId) {
        const updatedPendingOrder = await OrderModel.findOneAndUpdate(
          { _id: pendingExistingOrderId, paymentStatus: { $in: ["pending", "failed"] } },
          {
            $set: { ...orderInput, updatedAt: new Date() },
            $unset: { pendingPaymentExpiresAt: 1 },
          },
          { new: true },
        ).lean() as any;
        if (!updatedPendingOrder) {
          const existingFinalizedOrder = await storage.getOrderRequest(pendingExistingOrderId);
          if (["completed", "paid"].includes(String(existingFinalizedOrder?.paymentStatus))) {
            return res.status(200).json(existingFinalizedOrder);
          }
          return res.status(409).json({ message: "The pending order is no longer available to finalize." });
        }

        generatedOrderId = String(updatedPendingOrder.orderId ?? "");
        if (!generatedOrderId) {
          generatedOrderId = await generateOrderId();
          await OrderModel.findByIdAndUpdate(pendingExistingOrderId, {
            $set: { orderId: generatedOrderId, inventoryDeducted: false, inventoryReviewRequired },
          });
        }
        order = await storage.getOrderRequest(pendingExistingOrderId);
        if (!order) throw new Error("The finalized order could not be reloaded.");
      } else {
        order = await storage.createOrderRequest(orderInput);
        // Generate orderId AFTER the document is saved — countDocuments gives the correct
        // shared sequence across admin + online orders, and $set appends orderId as the
        // last field (matching admin POS document structure).
        generatedOrderId = await generateOrderId();
        // orderId and inventoryDeducted are set together in one update AFTER save,
        // so both appear after createdAt/updatedAt — matching admin POS field order exactly.
        await OrderModel.findByIdAndUpdate(order.id, {
          $set: {
            orderId: generatedOrderId,
            inventoryDeducted: false,
            inventoryReviewRequired,
          },
        });
      }

      // A provisional Razorpay order is intentionally visible in MongoDB, but it
      // must not be presented as a placed/paid order to the customer or downstream
      // systems until the capture has been verified.
      if (isPendingRazorpayCreation) {
        return res.status(201).json(order);
      }

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
      }, input.customerId);

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
      console.error("[orders.create] Order creation failed:", err);
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
      console.error("[OTP] ADMARK_API_KEY or ADMARK_PHONE_NUMBER_ID not set — cannot send OTP");
      return res.status(503).json({ message: "OTP service is not configured. Please try again later." });
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
      // Match the signed-in account as well as the login phone. A saved
      // delivery address may intentionally have a different recipient phone,
      // but its order must remain visible in the same account history.
      const customer = await CustomerDbModel.findOne({ phone }).select("_id").lean() as any;
      const orders = await storage.getOrdersByPhone(phone, customer?._id?.toString() ?? null);

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

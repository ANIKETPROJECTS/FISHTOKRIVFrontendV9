import { randomUUID } from "node:crypto";
import { getHubModels } from "./hubConnections";
import { getOrderModel, getPendingCheckoutModel } from "./ordersDb";

export const FTW_RESERVATION_TTL_MS = 15 * 60 * 1000;
const RECONCILIATION_INTERVAL_MS = 60 * 1000;

export type FtwInventoryAllocation = {
  productId: string;
  productName: string;
  unit: string | null;
  quantity: number;
  batchField: "batches" | "inventoryBatches" | null;
  batches: Array<{
    batchId: string;
    batchNumber: string;
    quantity: number;
    expiryDate: Date | null;
  }>;
};

type InventoryItem = {
  productId: string;
  quantity: number;
  name?: string;
  isCombo?: boolean;
  comboIncludes?: Array<{ productId: string; quantity?: number }>;
};

type ReservationRecord = {
  _id: unknown;
  razorpayOrderId: string;
  orderPayload?: {
    hubDbName?: string | null;
    items?: InventoryItem[];
  };
  ftwInventoryState?: string;
  ftwInventoryReservationId?: string | null;
  ftwInventoryOperationId?: string | null;
  ftwInventoryReservationExpiresAt?: Date | null;
  ftwInventoryAllocationLedger?: FtwInventoryAllocation[];
};

function getExpiryDate(batch: any): Date | null {
  if (batch.expiryDate) return new Date(batch.expiryDate);
  if (batch.shelfLifeDays != null && (batch.entryDate || batch.receivedDate)) {
    const start = new Date(batch.entryDate ?? batch.receivedDate);
    return new Date(start.getTime() + Number(batch.shelfLifeDays) * 86400000);
  }
  return null;
}

function isActiveBatch(batch: any, now = new Date()): boolean {
  const expiryDate = getExpiryDate(batch);
  return batch.remainingTime !== "expired" && (!expiryDate || expiryDate > now);
}

function getBatchField(product: any): "batches" | "inventoryBatches" | null {
  if (Array.isArray(product.batches) && product.batches.length > 0) return "batches";
  if (Array.isArray(product.inventoryBatches) && product.inventoryBatches.length > 0) {
    return "inventoryBatches";
  }
  return null;
}

function getBatchId(batch: any): string {
  return String(batch._id ?? batch.id ?? "");
}

function getBatchNumber(batch: any): string {
  return String(batch.batchNumber ?? batch.batchNo ?? batch._id ?? "");
}

function sortBatches(a: any, b: any): number {
  const aExpiry = getExpiryDate(a)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const bExpiry = getExpiryDate(b)?.getTime() ?? Number.MAX_SAFE_INTEGER;
  if (aExpiry !== bExpiry) return aExpiry - bExpiry;
  const aCreated = new Date(a.createdAt ?? a.entryDate ?? a.receivedDate ?? 0).getTime();
  const bCreated = new Date(b.createdAt ?? b.entryDate ?? b.receivedDate ?? 0).getTime();
  return aCreated - bCreated;
}

function availableQuantity(product: any): number {
  const field = getBatchField(product);
  if (!field) return Math.max(0, Number(product.quantity ?? 0));
  return (product[field] as any[])
    .filter((batch) => isActiveBatch(batch))
    .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity ?? 0)), 0);
}

function productUnit(product: any): string | null {
  return product.unit == null ? null : String(product.unit);
}

function operationKey(reservationId: string, type: "deduct" | "restore", productId: string) {
  return `ftw:${reservationId}:${type}:${productId}`;
}

async function expandInventoryItems(hub: any, items: InventoryItem[]) {
  const quantities = new Map<string, { quantity: number; name: string }>();

  const add = (productId: string, quantity: number, name: string) => {
    if (!productId || quantity <= 0) return;
    const existing = quantities.get(productId);
    quantities.set(productId, {
      quantity: (existing?.quantity ?? 0) + quantity,
      name: existing?.name || name,
    });
  };

  for (const item of items ?? []) {
    const comboIncludes = Array.isArray(item.comboIncludes) ? item.comboIncludes : [];
    if (item.isCombo || comboIncludes.length > 0) {
      const includes = comboIncludes.length > 0
        ? comboIncludes
        : ((await hub.Combo.findById(item.productId).lean())?.includes ?? []);
      for (const included of includes) {
        add(
          String(included.productId),
          Number(item.quantity ?? 0) * Number(included.quantity ?? 1),
          String(included.label ?? ""),
        );
      }
      continue;
    }
    add(String(item.productId), Number(item.quantity ?? 0), String(item.name ?? ""));
  }

  return [...quantities.entries()].map(([productId, value]) => ({
    productId,
    quantity: value.quantity,
    name: value.name,
  }));
}

async function recalculateQuantity(Product: any, productId: string, batchField: string | null) {
  const fresh = await Product.findById(productId).lean() as any;
  const quantity = batchField
    ? (fresh?.[batchField] ?? [])
        .filter((batch: any) => isActiveBatch(batch))
        .reduce((sum: number, batch: any) => sum + Math.max(0, Number(batch.quantity ?? 0)), 0)
    : Math.max(0, Number(fresh?.quantity ?? 0));
  await Product.updateOne({ _id: productId }, { $set: { quantity, updatedAt: new Date() } });
  return quantity;
}

async function deductProduct(Product: any, product: any, required: number): Promise<FtwInventoryAllocation> {
  const productId = String(product._id);
  const batchField = getBatchField(product);
  const allocation: FtwInventoryAllocation = {
    productId,
    productName: String(product.name ?? ""),
    unit: productUnit(product),
    quantity: required,
    batchField,
    batches: [],
  };

  if (!batchField) {
    const updated = await Product.findOneAndUpdate(
      { _id: product._id, quantity: { $gte: required } },
      { $inc: { quantity: -required }, $set: { updatedAt: new Date() } },
    );
    if (!updated) throw new Error(`"${product.name}" is no longer available in the requested quantity.`);
    return allocation;
  }

  const current = await Product.findById(product._id).lean() as any;
  const eligible = (current?.[batchField] ?? [])
    .filter((batch: any) => isActiveBatch(batch))
    .sort(sortBatches);
  let remaining = required;

  for (const batch of eligible) {
    if (remaining <= 0) break;
    const batchId = getBatchId(batch);
    if (!batchId) throw new Error(`Product "${product.name}" has a batch without an ID.`);
    let take = Math.min(remaining, Math.max(0, Number(batch.quantity ?? 0)));
    for (let attempt = 0; attempt < 5 && take > 0; attempt++) {
      const filter: any = {
        _id: product._id,
        [batchField]: { $elemMatch: { _id: batch._id, quantity: { $gte: take } } },
      };
      const updated = await Product.findOneAndUpdate(
        filter,
        { $inc: { [`${batchField}.$.quantity`]: -take }, $set: { updatedAt: new Date() } },
      );
      if (updated) break;

      const fresh = await Product.findOne(
        { _id: product._id, [`${batchField}._id`]: batch._id },
        { [`${batchField}.$`]: 1 },
      ).lean() as any;
      const actual = Number(fresh?.[batchField]?.[0]?.quantity ?? 0);
      take = Math.min(remaining, actual);
      if (take <= 0) break;
      if (attempt === 4) throw new Error(`"${product.name}" inventory changed during checkout.`);
    }

    if (take > 0) {
      allocation.batches.push({
        batchId,
        batchNumber: getBatchNumber(batch),
        quantity: take,
        expiryDate: getExpiryDate(batch),
      });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    if (allocation.batches.length > 0) {
      await restoreProduct(Product, allocation);
    }
    throw new Error(`"${product.name}" is no longer available in the requested quantity.`);
  }
  try {
    await recalculateQuantity(Product, productId, batchField);
  } catch (error) {
    await restoreProduct(Product, allocation);
    throw error;
  }
  return allocation;
}

async function restoreProduct(Product: any, allocation: FtwInventoryAllocation) {
  if (!allocation.batchField) {
    await Product.updateOne(
      { _id: allocation.productId },
      { $inc: { quantity: allocation.quantity }, $set: { updatedAt: new Date() } },
    );
    return;
  }

  for (const batch of allocation.batches) {
    const filter: any = {
      _id: allocation.productId,
      [`${allocation.batchField}._id`]: batch.batchId,
    };
    const updated = await Product.findOneAndUpdate(
      filter,
      { $inc: { [`${allocation.batchField}.$.quantity`]: batch.quantity }, $set: { updatedAt: new Date() } },
    );
    if (!updated) {
      throw new Error(
        `Original inventory batch ${batch.batchNumber || batch.batchId} for product ${allocation.productId} is missing.`,
      );
    }
  }
  await recalculateQuantity(Product, allocation.productId, allocation.batchField);
}

async function insertMovement(
  InventoryMovement: any,
  allocation: FtwInventoryAllocation,
  reservationId: string,
  type: "order_deduct" | "order_restore",
  orderId: string,
  orderRef: string,
  subReason: string,
  balance: number,
) {
  const operationType = type === "order_deduct" ? "deduct" : "restore";
  await InventoryMovement.findOneAndUpdate(
    { operationKey: operationKey(reservationId, operationType, allocation.productId) },
    {
      $setOnInsert: {
        type,
        operationKey: operationKey(reservationId, operationType, allocation.productId),
        productId: allocation.productId,
        productName: allocation.productName,
        unit: allocation.unit,
        change: type === "order_deduct" ? -allocation.quantity : allocation.quantity,
        balance,
        orderId,
        orderRef,
        batchNumbers: allocation.batches.map((batch) => batch.batchNumber).join(","),
        subReason,
        expiryDate: allocation.batches[0]?.expiryDate ?? null,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
}

async function restoreAllocations(
  hubDbName: string,
  allocations: FtwInventoryAllocation[],
  reservationId: string,
  orderId: string,
  orderRef: string,
  subReason: string,
  writeMovements = true,
) {
  const hub = await getHubModels(hubDbName);
  for (const allocation of allocations) {
    await restoreProduct(hub.Product, allocation);
    if (writeMovements) {
      const balance = availableQuantity(await hub.Product.findById(allocation.productId).lean());
      await insertMovement(
        hub.InventoryMovement,
        allocation,
        reservationId,
        "order_restore",
        orderId,
        orderRef,
        subReason,
        balance,
      );
    }
  }
}

export async function reserveFtwInventory(params: {
  razorpayOrderId: string;
  hubDbName: string;
  items: InventoryItem[];
  checkoutAttemptId?: string | null;
}) {
  const PendingCheckout = getPendingCheckoutModel();
  const reservationId = `rsv_${randomUUID()}`;
  const operationId = `ftw:${params.razorpayOrderId}:deduct`;
  const claimed = await PendingCheckout.findOneAndUpdate(
    {
      razorpayOrderId: params.razorpayOrderId,
      ftwInventoryState: { $in: ["none", "pending", null] },
    },
    {
      $set: {
        checkoutAttemptId: params.checkoutAttemptId ?? null,
        ftwInventoryState: "reserving",
        ftwInventoryReservationId: reservationId,
        ftwInventoryOperationId: operationId,
      },
    },
    { new: true },
  ).lean() as ReservationRecord | null;

  if (!claimed) {
    const existing = await PendingCheckout.findOne({ razorpayOrderId: params.razorpayOrderId }).lean() as ReservationRecord | null;
    if (existing?.ftwInventoryState === "reserved") {
      return {
        reservationId: existing.ftwInventoryReservationId,
        operationId: existing.ftwInventoryOperationId,
        expiresAt: existing.ftwInventoryReservationExpiresAt,
        allocationLedger: existing.ftwInventoryAllocationLedger ?? [],
      };
    }
    throw new Error("This checkout reservation is already being processed.");
  }

  const allocations: FtwInventoryAllocation[] = [];
  try {
    const hub = await getHubModels(params.hubDbName);
    const inventoryItems = await expandInventoryItems(hub, params.items);
    const products = await hub.Product.find({
      _id: { $in: inventoryItems.map((item) => item.productId) },
    }).lean() as any[];
    const byId = new Map(products.map((product) => [String(product._id), product]));

    // Check every product before changing any product.
    for (const item of inventoryItems) {
      const product = byId.get(item.productId);
      if (!product) throw new Error(`Product "${item.name || item.productId}" is no longer available.`);
      const available = availableQuantity(product);
      if (available < item.quantity) {
        throw new Error(`"${product.name}" has only ${available} unit(s) available. Please update your cart.`);
      }
    }

    for (const item of inventoryItems) {
      const product = byId.get(item.productId)!;
      allocations.push(await deductProduct(hub.Product, product, item.quantity));
    }

    for (const allocation of allocations) {
      const balance = availableQuantity(await hub.Product.findById(allocation.productId).lean());
      await insertMovement(
        hub.InventoryMovement,
        allocation,
        reservationId,
        "order_deduct",
        `pending:${params.razorpayOrderId}`,
        "",
        "order_placed",
        balance,
      );
    }

    const expiresAt = new Date(Date.now() + FTW_RESERVATION_TTL_MS);
    await PendingCheckout.updateOne(
      { _id: claimed._id, ftwInventoryState: "reserving" },
      {
        $set: {
          ftwInventoryState: "reserved",
          ftwInventoryReservationExpiresAt: expiresAt,
          ftwInventoryHeartbeatAt: new Date(),
          ftwInventoryAllocationLedger: allocations,
        },
      },
    );
    return { reservationId, operationId, expiresAt, allocationLedger: allocations };
  } catch (error) {
    if (allocations.length > 0) {
      try {
        await restoreAllocations(
          params.hubDbName,
          allocations,
          reservationId,
          `pending:${params.razorpayOrderId}`,
          "",
          "reservation_failed",
          false,
        );
        const hub = await getHubModels(params.hubDbName);
        await hub.InventoryMovement.deleteMany({
          operationKey: { $regex: `^ftw:${reservationId}:deduct:` },
        });
      } catch (restoreError) {
        console.error(`[FTW inventory] Failed to roll back reservation ${reservationId}:`, restoreError);
      }
    }
    await PendingCheckout.updateOne(
      { _id: claimed._id, ftwInventoryState: "reserving" },
      { $set: { ftwInventoryState: "failed", ftwInventoryReservationExpiresAt: null } },
    );
    throw error;
  }
}

export async function getPendingFtwReservation(razorpayOrderId: string) {
  return getPendingCheckoutModel().findOne({ razorpayOrderId }).lean() as Promise<ReservationRecord | null>;
}

export async function heartbeatFtwReservation(razorpayOrderId: string, reservationId: string) {
  const PendingCheckout = getPendingCheckoutModel();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FTW_RESERVATION_TTL_MS);
  const updated = await PendingCheckout.findOneAndUpdate(
    {
      razorpayOrderId,
      ftwInventoryReservationId: reservationId,
      ftwInventoryState: { $in: ["reserved", "committed"] },
    },
    { $set: { ftwInventoryHeartbeatAt: now, ftwInventoryReservationExpiresAt: expiresAt } },
    { new: true },
  ).lean();
  return Boolean(updated);
}

export async function commitFtwReservation(params: {
  razorpayOrderId: string;
  orderId: string;
  orderRef: string;
}) {
  const PendingCheckout = getPendingCheckoutModel();
  const pending = await PendingCheckout.findOne({ razorpayOrderId }).lean() as ReservationRecord | null;
  if (!pending || pending.ftwInventoryState !== "reserved") return pending;

  const hubDbName = String(pending.orderPayload?.hubDbName ?? "");
  const reservationId = String(pending.ftwInventoryReservationId);
  if (hubDbName && reservationId) {
    const hub = await getHubModels(hubDbName);
    await hub.InventoryMovement.updateMany(
      { operationKey: { $regex: `^ftw:${reservationId}:deduct:` } },
      { $set: { orderId: params.orderId, orderRef: params.orderRef } },
    );
  }

  await PendingCheckout.updateOne(
    { _id: pending._id, ftwInventoryState: "reserved" },
    { $set: { ftwInventoryState: "committed", ftwInventoryOrderId: params.orderId } },
  );
  return pending;
}

export async function restorePendingFtwReservation(
  pending: ReservationRecord,
  reason: "payment_failed" | "payment_cancelled" | "payment_expired" | "browser_closed",
) {
  if (pending.ftwInventoryState === "restored") return true;
  if (pending.ftwInventoryState !== "reserved") return false;
  const PendingCheckout = getPendingCheckoutModel();
  const restoreOperationId = `ftw:${pending.ftwInventoryReservationId}:restore`;
  const claimed = await PendingCheckout.findOneAndUpdate(
    { _id: pending._id, ftwInventoryState: "reserved" },
    {
      $set: {
        ftwInventoryState: "restoring",
        ftwInventoryRestoreOperationId: restoreOperationId,
      },
    },
    { new: true },
  ).lean() as ReservationRecord | null;
  if (!claimed) return false;

  try {
    const hubDbName = String(claimed.orderPayload?.hubDbName ?? "");
    if (!hubDbName) throw new Error("FTW reservation has no hub database.");
    await restoreAllocations(
      hubDbName,
      claimed.ftwInventoryAllocationLedger ?? [],
      String(claimed.ftwInventoryReservationId),
      `pending:${claimed.razorpayOrderId}`,
      "",
      reason,
      true,
    );
    await PendingCheckout.updateOne(
      { _id: claimed._id, ftwInventoryState: "restoring" },
      { $set: { ftwInventoryState: "restored", ftwInventoryReservationExpiresAt: null } },
    );
    return true;
  } catch (error) {
    await PendingCheckout.updateOne(
      { _id: claimed._id, ftwInventoryState: "restoring" },
      { $set: { ftwInventoryState: "reconciliation_required" } },
    );
    throw error;
  }
}

export async function restoreFtwOrderInventory(
  orderId: string,
  reason: "order_cancelled" | "payment_failed" | "payment_cancelled" | "payment_expired",
) {
  const OrderModel = getOrderModel();
  const order = await OrderModel.findById(orderId).lean() as any;
  if (!order || order.ftwInventoryState !== "reserved") return false;
  const claimed = await OrderModel.findOneAndUpdate(
    { _id: orderId, ftwInventoryState: "reserved" },
    {
      $set: {
        ftwInventoryState: "restoring",
        ftwInventoryRestoreOperationId: `ftw:${order.ftwInventoryReservationId}:restore`,
      },
    },
    { new: true },
  ).lean() as any;
  if (!claimed) return false;

  try {
    await restoreAllocations(
      String(claimed.hubDbName),
      claimed.ftwInventoryAllocationLedger ?? [],
      String(claimed.ftwInventoryReservationId),
      String(claimed._id),
      `#${String(claimed._id).slice(-6).toUpperCase()}`,
      reason,
      true,
    );
    await OrderModel.updateOne(
      { _id: orderId, ftwInventoryState: "restoring" },
      {
        $set: { ftwInventoryState: "restored", inventoryDeducted: false },
        $unset: { ftwInventoryReservationExpiresAt: "" },
      },
    );
    return true;
  } catch (error) {
    await OrderModel.updateOne(
      { _id: orderId, ftwInventoryState: "restoring" },
      { $set: { ftwInventoryState: "reconciliation_required" } },
    );
    throw error;
  }
}

export function startFtwReservationReconciler(getPaymentState: (razorpayOrderId: string) => Promise<"captured" | "pending" | "failed">) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const PendingCheckout = getPendingCheckoutModel();
      const expired = await PendingCheckout.find({
        ftwInventoryState: "reserved",
        ftwInventoryReservationExpiresAt: { $lte: new Date() },
      }).lean() as ReservationRecord[];
      for (const pending of expired) {
        try {
          const existingOrder = await getOrderModel().findOne({ razorpayOrderId: pending.razorpayOrderId }).lean();
          if (existingOrder) {
            await PendingCheckout.updateOne(
              { _id: pending._id },
              { $set: { ftwInventoryState: "committed", ftwInventoryOrderId: String(existingOrder._id) } },
            );
            continue;
          }
          const paymentState = await getPaymentState(pending.razorpayOrderId);
          if (paymentState === "captured") {
            console.warn(`[FTW inventory] Payment captured but order is not finalized: ${pending.razorpayOrderId}`);
            await PendingCheckout.updateOne(
              { _id: pending._id },
              { $set: { ftwInventoryState: "payment_detected", ftwInventoryReservationExpiresAt: new Date(Date.now() + FTW_RESERVATION_TTL_MS) } },
            );
            continue;
          }
          await restorePendingFtwReservation(
            pending,
            paymentState === "failed" ? "payment_failed" : "browser_closed",
          );
        } catch (error) {
          console.error(`[FTW inventory] Reconciliation failed for ${pending.razorpayOrderId}:`, error);
        }
      }
    } finally {
      running = false;
    }
  };
  void run();
  return setInterval(run, RECONCILIATION_INTERVAL_MS);
}
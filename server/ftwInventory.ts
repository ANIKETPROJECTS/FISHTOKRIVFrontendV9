import mongoose from "mongoose";
import type { HubModels } from "./hubConnections";

type FtwItem = {
  productId: string;
  quantity: number;
  name?: string | null;
  unit?: string | null;
};

type BatchAllocation = {
  batchId: string;
  batchNumber: string;
  quantity: number;
};

export type FtwInventoryAllocation = {
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  balance: number;
  batchAllocations: BatchAllocation[];
  batchNumbers: string;
};

export type FtwInventoryReservation = {
  operationId: string;
  status: "deducted" | "restored" | "failed";
  trigger: "upi_initiated";
  processedAt: Date;
  allocations: FtwInventoryAllocation[];
};

export class FtwInventoryError extends Error {
  readonly statusCode: number;
  readonly available?: number;
  readonly requested?: number;
  readonly productName?: string;

  constructor(
    message: string,
    details: {
      statusCode?: number;
      available?: number;
      requested?: number;
      productName?: string;
    } = {},
  ) {
    super(message);
    this.name = "FtwInventoryError";
    this.statusCode = details.statusCode ?? 409;
    this.available = details.available;
    this.requested = details.requested;
    this.productName = details.productName;
  }
}

type ProductDemand = {
  productId: string;
  quantity: number;
  itemName: string;
};

type ProductPlan = {
  demand: ProductDemand;
  product: any;
  productIdValue: any;
  hasBatches: boolean;
  beforeQuantity: number;
  afterQuantity: number;
  beforeBatches: any[];
  afterBatches: any[];
  batchAllocations: BatchAllocation[];
  batchNumbers: string;
};

function toMongoId(id: string): string | mongoose.Types.ObjectId {
  return /^[a-f\d]{24}$/i.test(id) ? new mongoose.Types.ObjectId(id) : id;
}

function stringId(id: unknown): string {
  return String(id);
}

function isActiveBatch(batch: any, now: Date): boolean {
  if (Number(batch?.quantity ?? 0) <= 0) return false;
  if (!batch?.expiryDate) return true;
  const expiry = new Date(batch.expiryDate);
  return Number.isNaN(expiry.getTime()) || expiry > now;
}

function batchSortValue(batch: any): [number, number] {
  const expiry = batch?.expiryDate ? new Date(batch.expiryDate).getTime() : Number.POSITIVE_INFINITY;
  const created = new Date(
    batch?.createdAt ??
    batch?.receivedDate ??
    batch?.entryDate ??
    0,
  ).getTime();
  return [Number.isNaN(expiry) ? Number.POSITIVE_INFINITY : expiry, Number.isNaN(created) ? 0 : created];
}

function sortBatches(a: any, b: any): number {
  const [aExpiry, aCreated] = batchSortValue(a);
  const [bExpiry, bCreated] = batchSortValue(b);
  return aExpiry - bExpiry || aCreated - bCreated;
}

function activeBatchQuantity(batches: any[], now: Date): number {
  return batches
    .filter((batch) => isActiveBatch(batch, now))
    .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity ?? 0)), 0);
}

function updateFilter(productIdValue: any, product: any, useCas: boolean): Record<string, any> {
  if (!useCas) return { _id: productIdValue };

  const filter: Record<string, any> = {
    _id: productIdValue,
    quantity: product.quantity ?? null,
  };
  if (Array.isArray(product.batches) && product.batches.length > 0) {
    filter.batches = product.batches;
  } else {
    filter.$or = [
      { batches: { $exists: false } },
      { batches: null },
      { batches: { $size: 0 } },
    ];
  }
  return filter;
}

function isTransactionUnsupported(error: any): boolean {
  const message = String(error?.message ?? "");
  return (
    error?.code === 20 ||
    error?.codeName === "IllegalOperation" ||
    message.includes("Transaction numbers are only allowed") ||
    message.includes("replica set member") ||
    message.includes("transactions are not supported")
  );
}

async function runInventoryOperation<T>(
  hub: HubModels,
  operation: (session?: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  const session = await (hub.Product.db as any).startSession() as mongoose.ClientSession;
  try {
    try {
      let result!: T;
      await session.withTransaction(async () => {
        result = await operation(session);
      });
      return result;
    } catch (error) {
      if (!isTransactionUnsupported(error)) throw error;
      // Standalone Mongo deployments do not support transactions. All fallback
      // product writes use compare-and-set filters, and the caller compensates
      // already-applied writes if a later product cannot be reserved.
      return operation();
    }
  } finally {
    await session.endSession();
  }
}

async function findProduct(hub: HubModels, productId: string, fallbackName?: string): Promise<any | null> {
  const collection = hub.Product.collection as any;
  const byId = await collection.findOne({ _id: toMongoId(productId) });
  if (byId) return byId;
  const name = String(fallbackName ?? "").trim();
  if (!name) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return collection.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });
}

async function expandDemands(hub: HubModels, items: FtwItem[]): Promise<ProductDemand[]> {
  const demandMap = new Map<string, ProductDemand>();

  for (const item of items) {
    const quantity = Math.floor(Number(item.quantity ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const product = await findProduct(hub, String(item.productId), item.name);
    if (product) {
      const productId = stringId(product._id);
      const existing = demandMap.get(productId);
      if (existing) existing.quantity += quantity;
      else demandMap.set(productId, {
        productId,
        quantity,
        itemName: String(product.name ?? item.name ?? ""),
      });
      continue;
    }

    const combo = await hub.Combo.findOne({ _id: toMongoId(String(item.productId)) }).lean() as any;
    if (!combo) {
      throw new FtwInventoryError(
        `"${item.name ?? "This item"}" is no longer available.`,
        { statusCode: 409, productName: String(item.name ?? "") },
      );
    }

    for (const included of combo.includes ?? []) {
      const includedQuantity = Math.floor(Number(included.quantity ?? 1));
      if (includedQuantity <= 0) continue;
      const productForCombo = await findProduct(hub, String(included.productId), included.label);
      if (!productForCombo) {
        throw new FtwInventoryError(
          `"${included.label ?? "A combo item"}" is no longer available.`,
          { statusCode: 409, productName: String(included.label ?? "") },
        );
      }
      const productId = stringId(productForCombo._id);
      const required = quantity * includedQuantity;
      const existing = demandMap.get(productId);
      if (existing) existing.quantity += required;
      else demandMap.set(productId, {
        productId,
        quantity: required,
        itemName: String(productForCombo.name ?? included.label ?? ""),
      });
    }
  }

  return [...demandMap.values()];
}

async function buildPlan(
  hub: HubModels,
  demand: ProductDemand,
  session?: mongoose.ClientSession,
): Promise<ProductPlan> {
  const productIdValue = toMongoId(demand.productId);
  const product = await (hub.Product.collection as any).findOne(
    { _id: productIdValue },
    session ? { session } : undefined,
  );
  if (!product) {
    throw new FtwInventoryError(`"${demand.itemName}" is no longer available.`, {
      statusCode: 409,
      productName: demand.itemName,
    });
  }

  const beforeQuantity = Math.max(0, Number(product.quantity ?? 0));
  const beforeBatches = Array.isArray(product.batches) ? product.batches : [];
  const hasBatches = beforeBatches.length > 0;
  if (!hasBatches) {
    if (beforeQuantity < demand.quantity) {
      throw new FtwInventoryError(
        `"${product.name ?? demand.itemName}" has only ${beforeQuantity} unit(s) available. Please update your cart.`,
        {
          available: beforeQuantity,
          requested: demand.quantity,
          productName: String(product.name ?? demand.itemName),
        },
      );
    }
    return {
      demand,
      product,
      productIdValue,
      hasBatches: false,
      beforeQuantity,
      afterQuantity: beforeQuantity - demand.quantity,
      beforeBatches,
      afterBatches: [],
      batchAllocations: [],
      batchNumbers: "",
    };
  }

  const now = new Date();
  const active = beforeBatches.filter((batch: any) => isActiveBatch(batch, now));
  const available = activeBatchQuantity(beforeBatches, now);
  if (available < demand.quantity) {
    throw new FtwInventoryError(
      `"${product.name ?? demand.itemName}" has only ${available} unit(s) available. Please update your cart.`,
      {
        available,
        requested: demand.quantity,
        productName: String(product.name ?? demand.itemName),
      },
    );
  }

  const ordered = [...active].sort(sortBatches);
  let remaining = demand.quantity;
  const allocations: BatchAllocation[] = [];
  const allocationById = new Map<string, number>();
  for (const batch of ordered) {
    if (remaining <= 0) break;
    const taken = Math.min(remaining, Math.max(0, Number(batch.quantity ?? 0)));
    if (taken <= 0) continue;
    const batchId = stringId(batch._id);
    const batchNumber = String(batch.batchNumber ?? "");
    allocations.push({ batchId, batchNumber, quantity: taken });
    allocationById.set(batchId, taken);
    remaining -= taken;
  }

  const afterBatches = beforeBatches.map((batch: any) => {
    const taken = allocationById.get(stringId(batch._id)) ?? 0;
    return taken > 0
      ? { ...batch, quantity: Math.max(0, Number(batch.quantity ?? 0) - taken) }
      : batch;
  });
  const afterQuantity = activeBatchQuantity(afterBatches, now);
  return {
    demand,
    product,
    productIdValue,
    hasBatches: true,
    beforeQuantity,
    afterQuantity,
    beforeBatches,
    afterBatches,
    batchAllocations: allocations,
    batchNumbers: allocations.map((allocation) => allocation.batchNumber).filter(Boolean).join(", "),
  };
}

async function applyPlan(
  hub: HubModels,
  plan: ProductPlan,
  session?: mongoose.ClientSession,
): Promise<void> {
  const filter = updateFilter(plan.productIdValue, plan.product, !session);
  const update = {
    $set: {
      quantity: plan.afterQuantity,
      updatedAt: new Date(),
      ...(plan.hasBatches ? { batches: plan.afterBatches } : {}),
    },
  };
  const result = await (hub.Product.collection as any).updateOne(
    filter,
    update,
    session ? { session } : undefined,
  );
  if (result.matchedCount !== 1) {
    throw new FtwInventoryError(
      `"${plan.product.name ?? plan.demand.itemName}" changed while checking stock. Please try again.`,
      { statusCode: 409, productName: String(plan.product.name ?? plan.demand.itemName) },
    );
  }
}

function movementForPlan(operationId: string, plan: ProductPlan) {
  return {
    type: "order_deduct",
    productId: String(plan.product._id),
    productName: String(plan.product.name ?? plan.demand.itemName),
    unit: String(plan.product.unit ?? ""),
    change: -plan.demand.quantity,
    balance: plan.afterQuantity,
    orderId: operationId,
    orderRef: operationId,
    reservationId: operationId,
    batchNumbers: plan.batchNumbers,
    batchAllocations: plan.batchAllocations,
    subReason: "upi_initiated",
    expiryDate: plan.batchAllocations.length > 0
      ? plan.afterBatches.find((batch: any) => String(batch._id) === plan.batchAllocations[0].batchId)?.expiryDate ?? null
      : null,
    createdAt: new Date(),
  };
}

export function isFtwUpiPayload(payload: any): boolean {
  return Boolean(
    payload &&
    payload.source === "online" &&
    String(payload.paymentMode ?? "").toLowerCase() === "upi" &&
    payload.hubDbName &&
    Array.isArray(payload.items) &&
  payload.items.length > 0,
  );
}

export async function reserveFtwInventory(params: {
  hub: HubModels;
  operationId: string;
  hubDbName: string;
  items: FtwItem[];
}): Promise<FtwInventoryReservation> {
  const { hub, operationId } = params;
  const demands = await expandDemands(hub, params.items);
  if (demands.length === 0) {
    throw new FtwInventoryError("Your cart has no reservable items.", { statusCode: 400 });
  }

  return runInventoryOperation(hub, async (session) => {
    const existing = await hub.InventoryMovement.find({
      type: "order_deduct",
      reservationId: operationId,
    }).session(session ?? null).lean();
    if (existing.length === demands.length) {
      return {
        operationId,
        status: "deducted",
        trigger: "upi_initiated",
        processedAt: new Date(),
        allocations: existing.map((movement: any) => ({
          productId: String(movement.productId),
          productName: String(movement.productName ?? ""),
          unit: String(movement.unit ?? ""),
          quantity: Math.abs(Number(movement.change ?? 0)),
          balance: Number(movement.balance ?? 0),
          batchAllocations: movement.batchAllocations ?? [],
          batchNumbers: String(movement.batchNumbers ?? ""),
        })),
      };
    }
    if (existing.length > 0) {
      throw new FtwInventoryError("This payment reservation is incomplete. Please try again.", { statusCode: 409 });
    }

    const plans: ProductPlan[] = [];
    for (const demand of demands) {
      plans.push(await buildPlan(hub, demand, session));
    }

    const appliedPlans: ProductPlan[] = [];
    try {
      for (const plan of plans) {
        await applyPlan(hub, plan, session);
        appliedPlans.push(plan);
        await hub.InventoryMovement.updateOne(
          {
            type: "order_deduct",
            reservationId: operationId,
            productId: String(plan.product._id),
          },
          { $setOnInsert: movementForPlan(operationId, plan) },
          { upsert: true, ...(session ? { session } : {}) },
        );
      }
    } catch (error) {
      if (!session) {
        for (const plan of appliedPlans.reverse()) {
          await (hub.Product.collection as any).updateOne(
            updateFilter(
              plan.productIdValue,
              { quantity: plan.afterQuantity, batches: plan.afterBatches },
              true,
            ),
            {
              $set: {
                quantity: plan.beforeQuantity,
                batches: plan.beforeBatches,
                updatedAt: new Date(),
              },
            },
          );
        }
      }
      throw error;
    }

    return {
      operationId,
      status: "deducted",
      trigger: "upi_initiated",
      processedAt: new Date(),
      allocations: plans.map((plan) => ({
        productId: String(plan.product._id),
        productName: String(plan.product.name ?? plan.demand.itemName),
        unit: String(plan.product.unit ?? ""),
        quantity: plan.demand.quantity,
        balance: plan.afterQuantity,
        batchAllocations: plan.batchAllocations,
        batchNumbers: plan.batchNumbers,
      })),
    };
  });
}

async function restorePlan(
  hub: HubModels,
  movement: any,
  session?: mongoose.ClientSession,
): Promise<{ balance: number; batchNumbers: string }> {
  const productIdValue = toMongoId(String(movement.productId));
  const product = await (hub.Product.collection as any).findOne(
    { _id: productIdValue },
    session ? { session } : undefined,
  );
  if (!product) {
    throw new FtwInventoryError(`Product "${movement.productName}" could not be restored.`, { statusCode: 500 });
  }

  const restoreQuantity = Math.abs(Number(movement.change ?? 0));
  const beforeBatches = Array.isArray(product.batches) ? product.batches : [];
  const hasBatches = beforeBatches.length > 0 || (movement.batchAllocations ?? []).length > 0;
  if (!hasBatches) {
    const currentQuantity = Math.max(0, Number(product.quantity ?? 0));
    const result = await (hub.Product.collection as any).updateOne(
      updateFilter(productIdValue, product, !session),
      { $set: { quantity: currentQuantity + restoreQuantity, updatedAt: new Date() } },
      session ? { session } : undefined,
    );
    if (result.matchedCount !== 1) throw new FtwInventoryError("Stock changed while restoring the payment reservation.", { statusCode: 409 });
    return { balance: currentQuantity + restoreQuantity, batchNumbers: "" };
  }

  const now = new Date();
  const batches = beforeBatches.map((batch: any) => ({ ...batch }));
  const restoredBatchNumbers: string[] = [];
  let remaining = restoreQuantity;
  for (const allocation of (movement.batchAllocations ?? []) as BatchAllocation[]) {
    if (remaining <= 0) break;
    const batch = batches.find(
      (candidate: any) =>
        stringId(candidate._id) === String(allocation.batchId) &&
        isActiveBatch(candidate, now),
    );
    if (batch) {
      batch.quantity = Math.max(0, Number(batch.quantity ?? 0)) + Number(allocation.quantity ?? 0);
      remaining -= Number(allocation.quantity ?? 0);
      if (batch.batchNumber) restoredBatchNumbers.push(String(batch.batchNumber));
    }
  }

  if (remaining > 0) {
    const active = batches.filter((batch: any) => isActiveBatch(batch, now)).sort(sortBatches);
    const target = active[active.length - 1];
    if (target) {
      target.quantity = Math.max(0, Number(target.quantity ?? 0)) + remaining;
      if (target.batchNumber) restoredBatchNumbers.push(String(target.batchNumber));
    } else {
      const batchNumber = `FTW-RESTORE-${String(movement.reservationId ?? movement.orderId).slice(-8)}`;
      batches.push({
        _id: new mongoose.Types.ObjectId(),
        batchNumber,
        quantity: remaining,
        receivedDate: now,
        createdAt: now,
        expiryDate: null,
      });
      restoredBatchNumbers.push(batchNumber);
    }
  }

  const balance = activeBatchQuantity(batches, now);
  const result = await (hub.Product.collection as any).updateOne(
    updateFilter(productIdValue, product, !session),
    { $set: { batches, quantity: balance, updatedAt: new Date() } },
    session ? { session } : undefined,
  );
  if (result.matchedCount !== 1) throw new FtwInventoryError("Stock changed while restoring the payment reservation.", { statusCode: 409 });
  return { balance, batchNumbers: restoredBatchNumbers.join(", ") };
}

export async function restoreFtwInventory(params: {
  hub: HubModels;
  operationId: string;
  reason: string;
}): Promise<{ restored: boolean; status: "restored" | "already_restored" | "not_found"; allocations: any[] }> {
  const { hub, operationId, reason } = params;
  return runInventoryOperation(hub, async (session) => {
    const movements = await hub.InventoryMovement.find({
      type: "order_deduct",
      reservationId: operationId,
    }).session(session ?? null).lean();
    if (movements.length === 0) {
      return { restored: false, status: "not_found", allocations: [] };
    }

    const restored: any[] = [];
    for (const movement of movements as any[]) {
      const already = await hub.InventoryMovement.findOne({
        type: "order_restore",
        reservationId: operationId,
        productId: String(movement.productId),
      }).session(session ?? null).lean();
      if (already) {
        restored.push(already);
        continue;
      }

      const result = await restorePlan(hub, movement, session);
      const restoreMovement = {
        type: "order_restore",
        productId: String(movement.productId),
        productName: movement.productName ?? "",
        unit: movement.unit ?? "",
        change: Math.abs(Number(movement.change ?? 0)),
        balance: result.balance,
        orderId: movement.orderId,
        orderRef: movement.orderRef ?? "",
        reservationId: operationId,
        batchNumbers: result.batchNumbers,
        batchAllocations: movement.batchAllocations ?? [],
        subReason: reason,
        createdAt: new Date(),
      };
      await hub.InventoryMovement.updateOne(
        {
          type: "order_restore",
          reservationId: operationId,
          productId: String(movement.productId),
        },
        { $setOnInsert: restoreMovement },
        { upsert: true, ...(session ? { session } : {}) },
      );
      restored.push(restoreMovement);
    }

    return {
      restored: restored.length > 0,
      status: "restored",
      allocations: restored,
    };
  });
}

export async function finalizeFtwInventory(params: {
  hub: HubModels;
  operationId: string;
  orderMongoId: string;
  orderPublicId: string;
}): Promise<void> {
  await params.hub.InventoryMovement.updateMany(
    { reservationId: params.operationId },
    {
      $set: {
        orderId: params.orderMongoId,
        orderRef: params.orderPublicId,
      },
    },
  );
}
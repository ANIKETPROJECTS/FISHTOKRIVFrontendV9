import mongoose, { Types } from "mongoose";
import { SubHubModel } from "./adminDb";
import { getHubModels } from "./hubConnections";
import { generateOrderId, getOrderModel, getPendingCheckoutModel } from "./ordersDb";

export const FTW_RESERVATION_TTL_MS = 30 * 60 * 1000;
export const FTW_CHECKOUT_HEARTBEAT_STALE_MS = 6 * 1000;
export const FTW_CHECKOUT_RECONCILE_INTERVAL_MS = 2 * 1000;
export const FTW_CHECKOUT_CLOSE_RECHECK_MS = 1_500;
const FTW_PENDING_PAYMENT_GRACE_MS = 2 * 60 * 1000;
export const FTW_PAYMENT_STATUS_RETRY_MS = 15 * 1000;
const FTW_EMPTY_PAYMENT_STATUS_GRACE_MS = 15 * 1000;

export type FtwBatchAllocation = {
  batchId: string;
  batchNumber: string;
  quantity: number;
};

export type FtwProductAllocation = {
  productId: string;
  productName: string;
  unit: string | null;
  quantity: number;
  legacy: boolean;
  batches: FtwBatchAllocation[];
};

export class FtwInventoryError extends Error {
  status: number;
  code: string;
  productId?: string;

  constructor(message: string, options: { status?: number; code?: string; productId?: string } = {}) {
    super(message);
    this.name = "FtwInventoryError";
    this.status = options.status ?? 409;
    this.code = options.code ?? "FTW_INVENTORY_ERROR";
    this.productId = options.productId;
  }
}

function isExpiredBatch(batch: any, now: Date): boolean {
  if (batch?.expiryDate == null || batch.expiryDate === "") return false;
  const expiry = new Date(batch.expiryDate);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime();
}

function batchExpiryTime(batch: any): number {
  if (batch?.expiryDate == null || batch.expiryDate === "") return Number.POSITIVE_INFINITY;
  const value = new Date(batch.expiryDate).getTime();
  return Number.isNaN(value) ? Number.POSITIVE_INFINITY : value;
}

function batchCreatedTime(batch: any): number {
  const value = new Date(batch?.createdAt ?? 0).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function buildFifoBatchDeduction(
  sourceBatches: any[],
  quantity: number,
  now = new Date(),
): { batches: any[]; allocations: FtwBatchAllocation[]; balance: number; expiryDate: Date | null } {
  const batches = Array.isArray(sourceBatches) ? sourceBatches : [];
  const eligible = batches
    .filter((batch) => !isExpiredBatch(batch, now) && Number(batch.quantity) > 0)
    .sort((a, b) => batchExpiryTime(a) - batchExpiryTime(b) || batchCreatedTime(a) - batchCreatedTime(b));
  const available = eligible.reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
  if (available < quantity) {
    throw new FtwInventoryError(
      `Only ${available} unit(s) of ${quantity > 0 ? "this product" : "the requested product"} are available.`,
      { code: "INSUFFICIENT_STOCK" },
    );
  }

  let remaining = quantity;
  const nextBatches = batches.map((batch) => ({ ...batch }));
  const allocations: FtwBatchAllocation[] = [];
  for (const eligibleBatch of eligible) {
    if (remaining <= 0) break;
    const batchId = String(eligibleBatch._id ?? eligibleBatch.id ?? "");
    const take = Math.min(Number(eligibleBatch.quantity) || 0, remaining);
    const target = nextBatches.find((batch) => String(batch._id ?? batch.id ?? "") === batchId);
    if (!target || take <= 0) continue;
    target.quantity = Number(target.quantity) - take;
    allocations.push({
      batchId,
      batchNumber: String(target.batchNumber ?? ""),
      quantity: take,
    });
    remaining -= take;
  }

  const balance = nextBatches
    .filter((batch) => !isExpiredBatch(batch, now))
    .reduce((sum, batch) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
  const oldestExpiry = allocations
    .map((allocation) => {
      const batch = nextBatches.find((entry) => String(entry._id ?? entry.id ?? "") === allocation.batchId);
      return batch?.expiryDate ? new Date(batch.expiryDate) : null;
    })
    .filter((expiry): expiry is Date => !!expiry && !Number.isNaN(expiry.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  return { batches: nextBatches, allocations, balance, expiryDate: oldestExpiry };
}

export function isFtwOrderId(orderId: unknown): boolean {
  return String(orderId ?? "").replace(/^#/, "").startsWith("FTW");
}

function getRawCollection(model: mongoose.Model<any>, name: string) {
  const db = model.db.db;
  if (!db) throw new Error(`MongoDB database is unavailable for collection ${name}`);
  return db.collection(name);
}

async function resolveOrderSubHub(order: any) {
  const possibleId = String(order.subHubId ?? "");
  let subHub: any = null;
  if (Types.ObjectId.isValid(possibleId)) {
    subHub = await SubHubModel.findById(possibleId).lean();
  }
  if (!subHub && order.subHubName) {
    subHub = await SubHubModel.findOne({ name: order.subHubName }).lean();
  }
  if (!subHub?.dbName) {
    throw new FtwInventoryError(
      `Cannot resolve the sub-hub database for FTW order ${order.orderId ?? order._id}.`,
      { code: "SUB_HUB_NOT_FOUND" },
    );
  }
  return subHub;
}

function normalizeProductId(value: unknown, context: string): Types.ObjectId {
  const text = String(value ?? "");
  if (!Types.ObjectId.isValid(text)) {
    throw new FtwInventoryError(`Invalid product or combo ID in ${context}.`, {
      code: "INVALID_PRODUCT_ID",
      productId: text,
    });
  }
  return new Types.ObjectId(text);
}

function publicOrderReference(internalId: unknown): string {
  return `#${String(internalId).slice(-6).toUpperCase()}`;
}

function logInventoryFailure(order: any, operationId: string, productId: string, reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason);
  console.error(
    `[FTW inventory] orderId=${order?.orderId ?? "unknown"} internalOrderId=${String(order?._id ?? "unknown")} ` +
    `productId=${productId || "unknown"} operationId=${operationId} reason=${text}`,
  );
}

async function ensureHubInventoryIndexes(Product: mongoose.Model<any>) {
  const operationCollection = getRawCollection(Product, "ftw_inventory_operations");
  const movementCollection = getRawCollection(Product, "inventory_movements");
  await operationCollection.createIndex(
    { operationKey: 1 },
    { unique: true, name: "uniq_ftw_inventory_operation" },
  );
  return { operationCollection, movementCollection };
}

export async function createOrGetFtwCheckoutDraft(params: {
  orderPayload: any;
  checkoutAttemptId: string;
  razorpayOrderId: string;
  amount: number;
  currency: string;
  reservationTokenHash: string;
}): Promise<{ order: any; isNew: boolean }> {
  const { Order, PendingCheckout } = {
    Order: getOrderModel(),
    PendingCheckout: getPendingCheckoutModel(),
  };
  const ordersCollection = getRawCollection(Order, "orders");
  await ordersCollection.createIndex(
    { ftwCheckoutAttemptId: 1 },
    {
      unique: true,
      partialFilterExpression: { ftwCheckoutAttemptId: { $type: "string" } },
      name: "uniq_ftw_checkout_attempt",
    },
  );

  const existing = await ordersCollection.findOne({ ftwCheckoutAttemptId: params.checkoutAttemptId });
  if (existing) {
    if (existing.paymentStatus === "paid" || existing.ftwPaymentFinalizedAt) {
      throw new FtwInventoryError(
        "Payment has already been received for this checkout attempt.",
        { code: "CHECKOUT_ALREADY_PAID" },
      );
    }
    if (existing.ftwInventoryState === "restored" || existing.ftwInventoryState === "reconciliation_required") {
      throw new FtwInventoryError(
        "This payment attempt has expired. Please start checkout again.",
        { code: "CHECKOUT_ATTEMPT_EXPIRED" },
      );
    }
    const pendingCollection = getRawCollection(PendingCheckout, "pendingcheckouts");
    const pending = await pendingCollection.findOne({ razorpayOrderId: existing.razorpayOrderId });
    if (pending) {
      return { order: existing, isNew: false };
    }
  }

  const requestedDbName = String(params.orderPayload?.hubDbName ?? "");
  if (!requestedDbName) {
    throw new FtwInventoryError("Select a delivery hub before starting payment.", {
      code: "SUB_HUB_REQUIRED",
    });
  }
  const subHub = await SubHubModel.findOne({ dbName: requestedDbName, status: "Active" }).lean() as any;
  if (!subHub?.dbName) {
    throw new FtwInventoryError("The selected delivery hub is unavailable. Refresh and try again.", {
      code: "SUB_HUB_NOT_FOUND",
    });
  }

  const orderPayload = params.orderPayload;
  const items = (orderPayload.items ?? []).map((item: any) => ({
    productId: String(item.productId),
    name: String(item.name ?? ""),
    price: item.price ?? null,
    quantity: Number(item.quantity),
    unit: item.unit ?? null,
    imageUrl: item.imageUrl ?? null,
    isCombo: item.isCombo === true,
  }));
  const subtotal = Number(orderPayload.subtotal ?? items.reduce(
    (sum: number, item: any) => sum + (Number(item.price) || 0) * item.quantity,
    0,
  ));
  const discount = Number(orderPayload.discount ?? orderPayload.discountAmount ?? 0);
  const slotCharge = Number(orderPayload.slotCharge ?? orderPayload.instantDeliveryCharge ?? 0);
  const total = Number(orderPayload.total ?? subtotal - discount + slotCharge);
  if (!Number.isFinite(total) || total < 0 || !items.length) {
    throw new FtwInventoryError("The checkout amount or item list is invalid.", {
      status: 400,
      code: "INVALID_CHECKOUT",
    });
  }

  const orderMongoId = new Types.ObjectId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + FTW_RESERVATION_TTL_MS);
  const generatedOrderId = await generateOrderId();
  const walletPayments = (orderPayload.payments ?? []).filter((payment: any) => payment.mode === "wallet");
  const draft: Record<string, any> = {
    _id: orderMongoId,
    customerId: orderPayload.customerId ?? null,
    customerName: orderPayload.customerName,
    phone: orderPayload.phone,
    email: orderPayload.email ?? null,
    items,
    subtotal,
    discount,
    slotCharge,
    total,
    deliveryType: orderPayload.deliveryType ?? "delivery",
    address: orderPayload.address,
    deliveryArea: orderPayload.deliveryArea,
    deliveryAddressDetail: orderPayload.deliveryAddressDetail ?? null,
    pickupLocation: "",
    notes: orderPayload.notes ?? "",
    status: "pending",
    source: "online",
    subHubId: String(subHub._id),
    subHubName: subHub.name,
    superHubId: subHub.superHubId ? String(subHub.superHubId) : null,
    superHubName: null,
    couponIds: [],
    couponCodes: [],
    coupons: [],
    paymentStatus: "unpaid",
    payments: [],
    paidAmount: 0,
    dueAmount: total,
    paymentMode: "upi",
    upiVariant: "RZPAY",
    orderType: orderPayload.orderType ?? null,
    scheduleType: orderPayload.scheduleType ?? "slot",
    deliveryDate: orderPayload.deliveryDate ?? null,
    timeslotId: orderPayload.timeslotId ?? null,
    timeslotLabel: orderPayload.timeslotLabel ?? null,
    timeslotStart: orderPayload.timeslotStart ?? null,
    timeslotEnd: orderPayload.timeslotEnd ?? null,
    razorpayOrderId: params.razorpayOrderId,
    inventoryDeducted: false,
    ftwInventoryManagedBy: "frontend",
    ftwInventoryState: "reserving",
    ftwInventoryOperationId: `ftw:${orderMongoId.toString()}:deduct`,
    ftwInventoryExpiresAt: expiresAt,
    ftwCheckoutAttemptId: params.checkoutAttemptId,
    ftwCheckoutHeartbeatAt: now,
    ftwRazorpayAmount: params.amount,
    ftwRazorpayCurrency: params.currency,
    ftwPendingWalletAmount: walletPayments.reduce(
      (sum: number, payment: any) => sum + Number(payment.amount || 0),
      0,
    ),
    createdAt: now,
    updatedAt: now,
    orderId: generatedOrderId,
  };
  if (subHub.superHubId) {
    const superHub = await import("./adminDb").then(({ SuperHubModel }) =>
      SuperHubModel.findById(subHub.superHubId).select("name").lean() as any
    );
    draft.superHubName = superHub?.name ?? null;
  }

  let upsertResult: any;
  try {
    upsertResult = await ordersCollection.updateOne(
      { ftwCheckoutAttemptId: params.checkoutAttemptId },
      { $setOnInsert: draft },
      { upsert: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }
  const order = await ordersCollection.findOne({ ftwCheckoutAttemptId: params.checkoutAttemptId });
  if (!order) throw new Error("FTW checkout draft could not be stored.");
  if (order.ftwInventoryState === "restored" || order.ftwInventoryState === "reconciliation_required") {
    throw new FtwInventoryError(
      "This payment attempt has expired. Please start checkout again.",
      { code: "CHECKOUT_ATTEMPT_EXPIRED" },
    );
  }

  const pendingCollection = getRawCollection(PendingCheckout, "pendingcheckouts");
  await pendingCollection.updateOne(
    { razorpayOrderId: order.razorpayOrderId },
    {
      $setOnInsert: {
        razorpayOrderId: order.razorpayOrderId,
        orderPayload,
        orderMongoId: String(order._id),
        checkoutAttemptId: params.checkoutAttemptId,
        reservationTokenHash: params.reservationTokenHash,
        expiresAt: order.ftwInventoryExpiresAt ?? expiresAt,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  return { order, isNew: upsertResult?.upsertedCount === 1 };
}

export async function reserveFtwInventoryForOrder(orderMongoId: string): Promise<any> {
  if (!Types.ObjectId.isValid(orderMongoId)) {
    throw new FtwInventoryError("Invalid FTW order reference.", { status: 400, code: "INVALID_ORDER_ID" });
  }
  const OrderModel = getOrderModel();
  const orderCollection = getRawCollection(OrderModel, "orders");
  const order = await orderCollection.findOne({ _id: new Types.ObjectId(orderMongoId) });
  if (!order || !isFtwOrderId(order.orderId)) {
    throw new FtwInventoryError("Inventory reservation is only available for FTW orders.", {
      status: 400,
      code: "NOT_FTW_ORDER",
    });
  }
  if (order.ftwInventoryManagedBy !== "frontend") {
    throw new FtwInventoryError("This FTW order is not owned by the storefront inventory flow.", {
      code: "INVENTORY_OWNER_MISMATCH",
    });
  }
  if (order.ftwInventoryState === "reserved" && order.inventoryDeducted === true) return order;
  if (order.ftwInventoryState === "restored" || order.ftwInventoryState === "reconciliation_required") {
    throw new FtwInventoryError("This FTW reservation has already been released or needs reconciliation.", {
      code: "RESERVATION_NOT_ACTIVE",
    });
  }

  const subHub = await resolveOrderSubHub(order);
  const { Product, Combo } = await getHubModels(subHub.dbName);
  const operationId = String(order.ftwInventoryOperationId ?? `ftw:${order._id}:deduct`);
  const { operationCollection, movementCollection } = await ensureHubInventoryIndexes(Product);
  const productsCollection = Product.db.db!.collection(Product.collection.collectionName);
  const combosCollection = Combo.db.db!.collection(Combo.collection.collectionName);
  const session = await Product.db.startSession();
  let allocations: FtwProductAllocation[] = [];
  let balances: Record<string, number> = {};
  let currentProductId = "";
  const now = new Date();

  try {
    await session.withTransaction(async () => {
      const existingOperation = await operationCollection.findOne(
        { operationKey: operationId },
        { session },
      );
      if (existingOperation?.state === "reserved") {
        allocations = existingOperation.allocations ?? [];
        balances = existingOperation.balances ?? {};
        return;
      }
      if (existingOperation) {
        throw new FtwInventoryError("A prior inventory operation for this order is not complete.", {
          code: "INVENTORY_OPERATION_INCOMPLETE",
        });
      }

      const productQuantities = new Map<string, number>();
      const productLabels = new Map<string, { name: string; unit: string | null }>();
      const comboIds: Types.ObjectId[] = [];

      for (const item of order.items ?? []) {
        const itemId = normalizeProductId(item.productId, `order ${order.orderId}`);
        if (item.isCombo === true) comboIds.push(itemId);
      }

      const comboDocs = comboIds.length
        ? await combosCollection.find({ _id: { $in: comboIds } }, { session }).toArray()
        : [];
      const combosById = new Map(comboDocs.map((combo: any) => [String(combo._id), combo]));
      for (const item of order.items ?? []) {
        const itemId = String(item.productId);
        const itemQuantity = Number(item.quantity);
        if (!Number.isFinite(itemQuantity) || itemQuantity <= 0) {
          throw new FtwInventoryError(`Invalid quantity for "${item.name ?? itemId}".`, {
            status: 400,
            code: "INVALID_QUANTITY",
            productId: itemId,
          });
        }
        if (item.isCombo === true) {
          const combo = combosById.get(itemId);
          if (!combo || combo.isActive === false) {
            throw new FtwInventoryError(`Combo "${item.name ?? itemId}" is no longer available.`, {
              productId: itemId,
              code: "COMBO_NOT_FOUND",
            });
          }
          const includes = Array.isArray(combo.includes) ? combo.includes : [];
          if (includes.length === 0) {
            throw new FtwInventoryError(`Combo "${combo.name}" has no inventory components configured.`, {
              productId: itemId,
              code: "EMPTY_COMBO",
            });
          }
          for (const included of includes) {
            const productId = String(included.productId);
            const quantity = itemQuantity * Number(included.quantity ?? 1);
            if (!Number.isFinite(quantity) || quantity <= 0) {
              throw new FtwInventoryError(`Invalid inventory quantity for combo "${combo.name}".`, {
                productId,
                code: "INVALID_COMBO_QUANTITY",
              });
            }
            productQuantities.set(productId, (productQuantities.get(productId) ?? 0) + quantity);
            productLabels.set(productId, { name: String(included.label ?? ""), unit: null });
          }
        } else {
          productQuantities.set(itemId, (productQuantities.get(itemId) ?? 0) + itemQuantity);
          productLabels.set(itemId, { name: String(item.name ?? ""), unit: item.unit ?? null });
        }
      }

      const productIds = [...productQuantities.keys()].map((id) => normalizeProductId(id, `order ${order.orderId}`));
      const products = await productsCollection.find(
        { _id: { $in: productIds } },
        { session },
      ).toArray();
      const productsById = new Map(products.map((product: any) => [String(product._id), product]));
      const plans: Array<{
        product: any;
        productId: string;
        quantity: number;
        legacy: boolean;
        nextBatches?: any[];
        productAllocations: FtwBatchAllocation[];
        balance: number;
        expiryDate: Date | null;
      }> = [];

      // Check every requested product before any inventory or history write.
      for (const [productId, quantity] of productQuantities.entries()) {
        currentProductId = productId;
        const product = productsById.get(productId);
        if (!product) {
          throw new FtwInventoryError(`Product "${productLabels.get(productId)?.name ?? productId}" was not found in this sub-hub.`, {
            productId,
            code: "PRODUCT_NOT_FOUND",
          });
        }
        const batches = Array.isArray(product.batches) ? product.batches : [];
        if (batches.length > 0) {
          const available = batches
            .filter((batch: any) => !isExpiredBatch(batch, now))
            .reduce((sum: number, batch: any) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
          if (available < quantity) {
            throw new FtwInventoryError(
              `"${product.name ?? productLabels.get(productId)?.name ?? productId}" has only ${available} unit(s) available.`,
              { productId, code: "INSUFFICIENT_STOCK" },
            );
          }
          const plan = buildFifoBatchDeduction(batches, quantity, now);
          const name = String(product.name ?? productLabels.get(productId)?.name ?? productId);
          if (plan.allocations.length === 0 && quantity > 0) {
            throw new FtwInventoryError(`No unexpired stock is available for "${name}".`, {
              productId,
              code: "INSUFFICIENT_STOCK",
            });
          }
          plans.push({
            product,
            productId,
            quantity,
            legacy: false,
            nextBatches: plan.batches,
            productAllocations: plan.allocations,
            balance: plan.balance,
            expiryDate: plan.expiryDate,
          });
        } else {
          const available = Number(product.quantity ?? 0);
          if (!Number.isFinite(available) || available < quantity) {
            throw new FtwInventoryError(
              `"${product.name ?? productLabels.get(productId)?.name ?? productId}" has only ${Number.isFinite(available) ? available : 0} unit(s) available.`,
              { productId, code: "INSUFFICIENT_STOCK" },
            );
          }
          plans.push({
            product,
            productId,
            quantity,
            legacy: true,
            productAllocations: [],
            balance: available - quantity,
            expiryDate: null,
          });
        }
      }

      const plannedAllocations: FtwProductAllocation[] = plans.map((plan) => ({
        productId: plan.productId,
        productName: String(plan.product.name ?? productLabels.get(plan.productId)?.name ?? ""),
        unit: plan.product.unit ?? productLabels.get(plan.productId)?.unit ?? null,
        quantity: plan.quantity,
        legacy: plan.legacy,
        batches: plan.productAllocations,
      }));
      const plannedBalances = Object.fromEntries(plans.map((plan) => [plan.productId, plan.balance]));

      await operationCollection.insertOne(
        {
          operationKey: operationId,
          operationType: "order_deduct",
          state: "reserving",
          orderMongoId: String(order._id),
          orderId: order.orderId,
          subHubDbName: subHub.dbName,
          allocations: plannedAllocations,
          balances: plannedBalances,
          createdAt: now,
        },
        { session },
      );

      const movements: any[] = [];
      for (const plan of plans) {
        currentProductId = plan.productId;
        if (plan.legacy) {
          const quantityFilter = plan.product.quantity === undefined
            ? { quantity: { $exists: false } }
            : { quantity: plan.product.quantity };
          const result = await productsCollection.updateOne(
            {
              _id: plan.product._id,
              ...quantityFilter,
              $or: [{ batches: { $exists: false } }, { batches: { $size: 0 } }],
            },
            {
              $inc: { quantity: -plan.quantity },
              $set: { updatedAt: now },
            },
            { session },
          );
          if (result.modifiedCount !== 1) {
            throw new FtwInventoryError(`Stock changed while reserving "${plan.product.name}". Please try again.`, {
              productId: plan.productId,
              code: "INVENTORY_CONFLICT",
            });
          }
        } else {
          const quantityFilter = plan.product.quantity === undefined
            ? { quantity: { $exists: false } }
            : { quantity: plan.product.quantity };
          const result = await productsCollection.updateOne(
            {
              _id: plan.product._id,
              ...quantityFilter,
              batches: plan.product.batches,
            },
            {
              $set: {
                batches: plan.nextBatches,
                quantity: plan.balance,
                updatedAt: now,
              },
            },
            { session },
          );
          if (result.modifiedCount !== 1) {
            throw new FtwInventoryError(`Stock changed while reserving "${plan.product.name}". Please try again.`, {
              productId: plan.productId,
              code: "INVENTORY_CONFLICT",
            });
          }
        }

        const allocation = plannedAllocations.find((entry) => entry.productId === plan.productId)!;
        const consumedBatches = plan.productAllocations;
        movements.push({
          type: "order_deduct",
          productId: plan.productId,
          productName: allocation.productName,
          unit: allocation.unit,
          change: -plan.quantity,
          balance: plan.balance,
          orderId: String(order._id),
          orderRef: publicOrderReference(order._id),
          batchNumbers: consumedBatches.map((entry) => entry.batchNumber).filter(Boolean).join(", "),
          batchAllocations: consumedBatches,
          subReason: "order_placed",
          expiryDate: plan.expiryDate,
          operationId,
          createdAt: now,
        });
      }
      if (movements.length > 0) {
        await movementCollection.insertMany(movements, { session, ordered: true });
      }
      await operationCollection.updateOne(
        { operationKey: operationId },
        { $set: { state: "reserved", committedAt: now } },
        { session },
      );
      allocations = plannedAllocations;
      balances = plannedBalances;
    });
  } catch (error) {
    logInventoryFailure(order, operationId, currentProductId, error);
    if ((error as any)?.code === 11000) {
      const existingOperation = await operationCollection.findOne({ operationKey: operationId });
      if (existingOperation?.state === "reserved") {
        allocations = existingOperation.allocations ?? [];
        balances = existingOperation.balances ?? {};
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  } finally {
    await session.endSession();
  }

  const expiresAt = order.ftwInventoryExpiresAt ?? new Date(now.getTime() + FTW_RESERVATION_TTL_MS);
  await orderCollection.updateOne(
    { _id: order._id, ftwInventoryState: { $in: ["reserving", "reserved"] } },
    {
      $set: {
        inventoryDeducted: true,
        ftwInventoryManagedBy: "frontend",
        ftwInventoryState: "reserved",
        ftwInventoryOperationId: operationId,
        ftwInventoryAllocations: allocations,
        ftwInventoryExpiresAt: expiresAt,
        updatedAt: new Date(),
      },
    },
  );
  const updatedOrder = await orderCollection.findOne({ _id: order._id });
  if (!updatedOrder || updatedOrder.ftwInventoryState !== "reserved" || updatedOrder.inventoryDeducted !== true) {
    throw new Error(`FTW reservation committed for ${order.orderId}, but the order flags could not be updated.`);
  }
  return updatedOrder;
}

function buildRestorePlan(product: any, allocation: FtwProductAllocation, now: Date) {
  const batches = Array.isArray(product.batches) ? product.batches : [];
  if (allocation.legacy) {
    if (batches.length > 0) {
      throw new FtwInventoryError(
        `Legacy stock for "${allocation.productName}" cannot be restored safely after batches were added.`,
        { code: "LEGACY_BATCH_MISMATCH", productId: allocation.productId },
      );
    }
    return {
      batches: undefined as any[] | undefined,
      balance: Number(product.quantity ?? 0) + allocation.quantity,
      batchNumbers: "",
    };
  }

  const nextBatches = batches.map((batch: any) => ({ ...batch }));
  for (const consumed of allocation.batches) {
    const batch = nextBatches.find((entry: any) => String(entry._id ?? entry.id ?? "") === consumed.batchId);
    if (!batch) {
      throw new FtwInventoryError(
        `Original batch "${consumed.batchNumber || consumed.batchId}" for "${allocation.productName}" no longer exists.`,
        { code: "ORIGINAL_BATCH_MISSING", productId: allocation.productId },
      );
    }
    batch.quantity = (Number(batch.quantity) || 0) + consumed.quantity;
  }
  const balance = nextBatches
    .filter((batch: any) => !isExpiredBatch(batch, now))
    .reduce((sum: number, batch: any) => sum + Math.max(0, Number(batch.quantity) || 0), 0);
  return {
    batches: nextBatches,
    balance,
    batchNumbers: allocation.batches.map((entry) => entry.batchNumber).filter(Boolean).join(", "),
  };
}

async function enqueueReconciliation(order: any, restoreOperationId: string, error: unknown) {
  const OrderModel = getOrderModel();
  const reconciliation = getRawCollection(OrderModel, "ftw_inventory_reconciliation");
  await reconciliation.createIndex(
    { operationKey: 1 },
    { unique: true, name: "uniq_ftw_inventory_reconciliation" },
  );
  const message = error instanceof Error ? error.message : String(error);
  await reconciliation.updateOne(
    { operationKey: restoreOperationId },
    {
      $setOnInsert: {
        operationKey: restoreOperationId,
        orderMongoId: String(order._id),
        orderId: order.orderId,
        subHubId: order.subHubId ?? null,
        subHubName: order.subHubName ?? null,
        reservationOperationId: order.ftwInventoryOperationId ?? null,
        reason: message,
        state: "open",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
  await OrderModel.collection.updateOne(
    { _id: order._id, inventoryDeducted: true },
    {
      $set: {
        ftwInventoryState: "reconciliation_required",
        ftwInventoryRestoring: false,
        updatedAt: new Date(),
      },
      $unset: { ftwInventoryRestoringAt: "" },
    },
  );
  logInventoryFailure(order, restoreOperationId, (error as any)?.productId ?? "", message);
}

export async function restoreFtwInventory(
  orderMongoId: string,
  reason:
    | "payment_failed"
    | "payment_cancelled"
    | "payment_expired"
    | "browser_closed"
    | "order_cancelled",
): Promise<{ restored: boolean; alreadyRestored?: boolean; reconciliationRequired?: boolean }> {
  if (!Types.ObjectId.isValid(orderMongoId)) {
    throw new FtwInventoryError("Invalid FTW order reference.", { status: 400, code: "INVALID_ORDER_ID" });
  }
  const OrderModel = getOrderModel();
  const orderCollection = getRawCollection(OrderModel, "orders");
  const order = await orderCollection.findOne({ _id: new Types.ObjectId(orderMongoId) });
  if (!order || !isFtwOrderId(order.orderId) || order.ftwInventoryManagedBy !== "frontend") {
    return { restored: false };
  }
  if (order.inventoryDeducted !== true) {
    if (order.ftwInventoryState === "restored" || order.ftwInventoryState === "reconciliation_required") {
      return { restored: true, alreadyRestored: true };
    }
    return { restored: false };
  }
  if (order.paymentStatus === "paid" && reason !== "order_cancelled") {
    return { restored: false };
  }
  if (order.ftwInventoryState !== "reserved" && order.ftwInventoryState !== "reconciliation_required") {
    return { restored: false };
  }
  const claimNow = new Date();
  const staleLockBefore = new Date(claimNow.getTime() - 10 * 60 * 1000);
  const restoreClaim = await orderCollection.updateOne(
    {
      _id: order._id,
      inventoryDeducted: true,
      ftwInventoryState: { $in: ["reserved", "reconciliation_required"] },
      ...(reason === "order_cancelled" ? {} : { paymentStatus: { $ne: "paid" } }),
      $and: [
        {
          $or: [
            { ftwInventoryRestoring: { $ne: true } },
            { ftwInventoryRestoringAt: { $lte: staleLockBefore } },
          ],
        },
        {
          $or: [
            { ftwPaymentFinalizing: { $ne: true } },
            { ftwPaymentFinalizingAt: { $lte: staleLockBefore } },
          ],
        },
      ],
    },
    {
      $set: {
        ftwInventoryRestoring: true,
        ftwInventoryRestoringAt: claimNow,
        updatedAt: claimNow,
      },
    },
  );
  if (restoreClaim.modifiedCount !== 1) {
    const latest = await orderCollection.findOne({ _id: order._id });
    if (latest?.inventoryDeducted !== true && latest) {
      return { restored: true, alreadyRestored: true };
    }
    return { restored: false };
  }

  const reservationOperationId = String(order.ftwInventoryOperationId ?? "");
  if (!reservationOperationId) {
    const error = new FtwInventoryError("The reservation has no inventory operation ID.", {
      code: "RESERVATION_LEDGER_MISSING",
    });
    const restoreKey = `ftw:${order._id}:restore:missing`;
    await enqueueReconciliation(order, restoreKey, error);
    return { restored: false, reconciliationRequired: true };
  }

  const restoreOperationId = `ftw:${order._id}:restore:${reservationOperationId}`;
  let subHub: any;
  try {
    subHub = await resolveOrderSubHub(order);
  } catch (error) {
    await enqueueReconciliation(order, restoreOperationId, error);
    return { restored: false, reconciliationRequired: true };
  }

  const { Product } = await getHubModels(subHub.dbName);
  const { operationCollection, movementCollection } = await ensureHubInventoryIndexes(Product);
  const productsCollection = Product.db.db!.collection(Product.collection.collectionName);
  const session = await Product.db.startSession();
  const now = new Date();
  let allocations: FtwProductAllocation[] = Array.isArray(order.ftwInventoryAllocations)
    ? order.ftwInventoryAllocations
    : [];
  let currentProductId = "";

  try {
    await session.withTransaction(async () => {
      const previousRestore = await operationCollection.findOne(
        { operationKey: restoreOperationId, state: "restored" },
        { session },
      );
      if (previousRestore) {
        allocations = previousRestore.allocations ?? allocations;
        return;
      }
      const reservation = await operationCollection.findOne(
        { operationKey: reservationOperationId, state: "reserved" },
        { session },
      );
      if (!allocations.length) allocations = reservation?.allocations ?? [];
      if (!allocations.length) {
        throw new FtwInventoryError("The saved batch allocation ledger is missing.", {
          code: "RESERVATION_LEDGER_MISSING",
        });
      }

      const ids = allocations.map((allocation) =>
        normalizeProductId(allocation.productId, `restore ${order.orderId}`)
      );
      const productDocs = await productsCollection.find({ _id: { $in: ids } }, { session }).toArray();
      const productsById = new Map(productDocs.map((product: any) => [String(product._id), product]));

      // Validate every original product and batch before changing any stock.
      const restorePlans: Array<{ product: any; allocation: FtwProductAllocation; plan: ReturnType<typeof buildRestorePlan> }> = [];
      for (const allocation of allocations) {
        currentProductId = allocation.productId;
        const product = productsById.get(allocation.productId);
        if (!product) {
          throw new FtwInventoryError(`Product "${allocation.productName}" no longer exists in ${subHub.dbName}.`, {
            code: "PRODUCT_MISSING_ON_RESTORE",
            productId: allocation.productId,
          });
        }
        const plan = buildRestorePlan(product, allocation, now);
        restorePlans.push({ product, allocation, plan });
      }

      await operationCollection.insertOne(
        {
          operationKey: restoreOperationId,
          operationType: "order_restore",
          state: "restoring",
          orderMongoId: String(order._id),
          orderId: order.orderId,
          subHubDbName: subHub.dbName,
          reservationOperationId,
          reason,
          allocations,
          createdAt: now,
        },
        { session },
      );

      const movements: any[] = [];
      for (const { product, allocation, plan } of restorePlans) {
        currentProductId = allocation.productId;
        const quantityFilter = product.quantity === undefined
          ? { quantity: { $exists: false } }
          : { quantity: product.quantity };
        const filter: any = {
          _id: product._id,
          ...quantityFilter,
          ...(allocation.legacy
            ? { $or: [{ batches: { $exists: false } }, { batches: { $size: 0 } }] }
            : { batches: product.batches }),
        };
        const update = allocation.legacy
          ? { $inc: { quantity: allocation.quantity }, $set: { updatedAt: now } }
          : { $set: { batches: plan.batches, quantity: plan.balance, updatedAt: now } };
        const result = await productsCollection.updateOne(filter, update, { session });
        if (result.modifiedCount !== 1) {
          throw new FtwInventoryError(`Stock changed while restoring "${allocation.productName}". Please retry reconciliation.`, {
            code: "INVENTORY_CONFLICT_ON_RESTORE",
            productId: allocation.productId,
          });
        }
        movements.push({
          type: "order_restore",
          productId: allocation.productId,
          productName: allocation.productName,
          unit: allocation.unit,
          change: allocation.quantity,
          balance: plan.balance,
          orderId: String(order._id),
          orderRef: publicOrderReference(order._id),
          batchNumbers: plan.batchNumbers,
          batchAllocations: allocation.batches,
          subReason: reason,
          expiryDate: null,
          operationId: restoreOperationId,
          createdAt: now,
        });
      }
      if (movements.length > 0) {
        await movementCollection.insertMany(movements, { session, ordered: true });
      }
      await operationCollection.updateOne(
        { operationKey: restoreOperationId },
        { $set: { state: "restored", committedAt: now } },
        { session },
      );
    });
  } catch (error) {
    const previousRestore = await operationCollection.findOne({
      operationKey: restoreOperationId,
      state: "restored",
    });
    if (!previousRestore) {
      await enqueueReconciliation(order, restoreOperationId, error);
      return { restored: false, reconciliationRequired: true };
    }
  } finally {
    await session.endSession();
  }

  const restoredAt = new Date();
  await orderCollection.updateOne(
    { _id: order._id, inventoryDeducted: true, ftwInventoryRestoring: true },
    {
      $set: {
        inventoryDeducted: false,
        ftwInventoryState: "restored",
        ftwInventoryRestoring: false,
        ftwInventoryRestoreOperationId: restoreOperationId,
        ftwInventoryRestoreReason: reason,
        status: "cancelled",
        updatedAt: restoredAt,
      },
      $unset: { ftwInventoryExpiresAt: "", ftwInventoryRestoringAt: "" },
    },
  );
  const finalOrder = await orderCollection.findOne({ _id: order._id });
  if (finalOrder?.inventoryDeducted !== false) {
    throw new Error(`FTW inventory was restored but order flags were not updated for ${order.orderId}.`);
  }
  try {
    await getRawCollection(getPendingCheckoutModel(), "pendingcheckouts").deleteOne({
      razorpayOrderId: order.razorpayOrderId,
    });
  } catch (error) {
    console.error(`[FTW inventory] Could not remove pending checkout for ${order.orderId}:`, error);
  }
  return { restored: true };
}

export async function deleteUnpaidFtwCheckout(orderMongoId: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(orderMongoId)) return false;
  const OrderModel = getOrderModel();
  const orderCollection = getRawCollection(OrderModel, "orders");
  const order = await orderCollection.findOne({ _id: new Types.ObjectId(orderMongoId) });
  if (
    !order ||
    order.ftwInventoryManagedBy !== "frontend" ||
    order.ftwInventoryState !== "restored" ||
    order.inventoryDeducted !== false ||
    order.paymentStatus === "paid" ||
    order.ftwPaymentFinalizedAt ||
    !order.razorpayOrderId ||
    ![
      "payment_failed",
      "payment_cancelled",
      "payment_expired",
      "browser_closed",
      "reservation_failed",
    ].includes(String(order.ftwInventoryRestoreReason ?? ""))
  ) {
    return false;
  }

  const claim = await orderCollection.updateOne(
    {
      _id: order._id,
      ftwInventoryManagedBy: "frontend",
      ftwInventoryState: "restored",
      inventoryDeducted: false,
      paymentStatus: { $ne: "paid" },
      $and: [
        {
          $or: [
            { ftwCheckoutDeleting: { $ne: true } },
            { ftwCheckoutDeletingAt: { $lte: new Date(Date.now() - 60 * 1000) } },
          ],
        },
        { $or: [{ ftwPaymentFinalizedAt: null }, { ftwPaymentFinalizedAt: { $exists: false } }] },
        { $or: [{ ftwPaymentFinalizing: { $ne: true } }, { ftwPaymentFinalizingAt: { $lte: new Date(Date.now() - 10 * 60 * 1000) } }] },
      ],
    },
    {
      $set: {
        ftwCheckoutDeleting: true,
        ftwCheckoutDeletingAt: new Date(),
        updatedAt: new Date(),
      },
    },
  );
  if (claim.modifiedCount !== 1) return false;

  const tombstones = getRawCollection(OrderModel, "ftw_checkout_tombstones");
  await tombstones.createIndex(
    { razorpayOrderId: 1 },
    { unique: true, name: "uniq_ftw_checkout_tombstone_order" },
  );
  await tombstones.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, name: "ttl_ftw_checkout_tombstone" },
  );
  const deletedAt = new Date();
  const tombstone = {
    razorpayOrderId: String(order.razorpayOrderId ?? ""),
    orderMongoId: String(order._id),
    orderId: String(order.orderId ?? ""),
    checkoutAttemptId: String(order.ftwCheckoutAttemptId ?? ""),
    subHubId: order.subHubId ?? null,
    subHubName: order.subHubName ?? null,
    reservationOperationId: order.ftwInventoryOperationId ?? null,
    restoreOperationId: order.ftwInventoryRestoreOperationId ?? null,
    restoreReason: order.ftwInventoryRestoreReason,
    state: "deleting",
    deletedAt,
    expiresAt: new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
  };
  await tombstones.updateOne(
    { razorpayOrderId: tombstone.razorpayOrderId },
    { $setOnInsert: tombstone },
    { upsert: true },
  );

  const deleted = await orderCollection.deleteOne({
    _id: order._id,
    razorpayOrderId: order.razorpayOrderId,
    ftwInventoryManagedBy: "frontend",
    ftwInventoryState: "restored",
    inventoryDeducted: false,
    ftwCheckoutDeleting: true,
    paymentStatus: { $ne: "paid" },
    $or: [{ ftwPaymentFinalizedAt: null }, { ftwPaymentFinalizedAt: { $exists: false } }],
  });
  if (deleted.deletedCount !== 1) {
    await orderCollection.updateOne(
      { _id: order._id, ftwCheckoutDeleting: true },
      {
        $set: { ftwCheckoutDeleting: false, updatedAt: new Date() },
        $unset: { ftwCheckoutDeletingAt: "" },
      },
    );
    await tombstones.deleteOne({
      razorpayOrderId: tombstone.razorpayOrderId,
      state: "deleting",
    });
    return false;
  }

  await tombstones.updateOne(
    { razorpayOrderId: tombstone.razorpayOrderId },
    { $set: { state: "deleted" } },
  );
  await getRawCollection(getPendingCheckoutModel(), "pendingcheckouts").deleteOne({
    razorpayOrderId: order.razorpayOrderId,
  });
  console.info(
    `[FTW checkout] Deleted unpaid order orderId=${order.orderId} ` +
    `internalOrderId=${String(order._id)} reason=${order.ftwInventoryRestoreReason}`,
  );
  return true;
}

export async function reconcileExpiredFtwReservations(
  fetchPayments: (razorpayOrderId: string) => Promise<any>,
) {
  const OrderModel = getOrderModel();
  const now = new Date();
  const heartbeatStaleBefore = new Date(now.getTime() - FTW_CHECKOUT_HEARTBEAT_STALE_MS);
  const expired = await OrderModel.find({
    ftwInventoryManagedBy: "frontend",
    ftwInventoryState: { $in: ["reserving", "reserved"] },
    paymentStatus: { $ne: "paid" },
    $and: [
      {
        $or: [
          { ftwCheckoutHeartbeatAt: { $lte: heartbeatStaleBefore }, ftwInventoryState: "reserved" },
          {
            ftwCheckoutHeartbeatAt: null,
            createdAt: { $lte: heartbeatStaleBefore },
            ftwInventoryState: "reserved",
          },
          {
            ftwCheckoutTerminationRequestedAt: { $type: "date", $lte: now },
            ftwInventoryState: "reserved",
          },
          { ftwInventoryExpiresAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { ftwCheckoutNextPaymentCheckAt: { $exists: false } },
          { ftwCheckoutNextPaymentCheckAt: null },
          { ftwCheckoutNextPaymentCheckAt: { $lte: now } },
        ],
      },
    ],
  }).limit(100).lean() as any[];

  for (const order of expired) {
    try {
      const nextPaymentCheckAt = new Date(now.getTime() + FTW_PAYMENT_STATUS_RETRY_MS);
      const paymentCheckClaim = await OrderModel.collection.updateOne(
        {
          _id: order._id,
          paymentStatus: { $ne: "paid" },
          $or: [
            { ftwCheckoutNextPaymentCheckAt: { $exists: false } },
            { ftwCheckoutNextPaymentCheckAt: null },
            { ftwCheckoutNextPaymentCheckAt: { $lte: now } },
          ],
        },
        { $set: { ftwCheckoutNextPaymentCheckAt: nextPaymentCheckAt } },
      );
      if (paymentCheckClaim.modifiedCount !== 1) continue;

      const payments = await fetchPayments(String(order.razorpayOrderId));
      const items: any[] = payments?.items ?? [];
      const hasSuccessfulPayment = items.some((payment) =>
        payment?.status === "captured" || payment?.status === "authorized"
      );
      if (hasSuccessfulPayment) continue;
      const hasUnresolvedPayment = items.some((payment) =>
        !["failed", "refunded"].includes(String(payment?.status ?? "").toLowerCase())
      );
      const expiresAt = order.ftwInventoryExpiresAt
        ? new Date(order.ftwInventoryExpiresAt)
        : new Date(new Date(order.createdAt ?? now).getTime() + FTW_RESERVATION_TTL_MS);
      const latestOrder = await OrderModel.collection.findOne(
        { _id: order._id },
        {
          projection: {
            paymentStatus: 1,
            ftwPaymentFinalizedAt: 1,
            ftwCheckoutHeartbeatAt: 1,
            ftwCheckoutTerminationRequestedAt: 1,
          },
        },
      );
      if (latestOrder?.paymentStatus === "paid" || latestOrder?.ftwPaymentFinalizedAt) continue;
      const latestHeartbeatAt = latestOrder?.ftwCheckoutHeartbeatAt
        ? new Date(latestOrder.ftwCheckoutHeartbeatAt).getTime()
        : 0;
      const heartbeatIsFresh = latestHeartbeatAt > Date.now() - FTW_CHECKOUT_HEARTBEAT_STALE_MS;
      const heartbeatBaseTime = latestHeartbeatAt || new Date(order.createdAt ?? now).getTime();
      const terminationRequestedAt = latestOrder?.ftwCheckoutTerminationRequestedAt
        ? new Date(latestOrder.ftwCheckoutTerminationRequestedAt).getTime()
        : 0;
      const heartbeatShowsLiveCheckout = heartbeatIsFresh &&
        (!terminationRequestedAt || latestHeartbeatAt > terminationRequestedAt);
      const emptyStatusGraceMs = terminationRequestedAt
        ? FTW_CHECKOUT_CLOSE_RECHECK_MS
        : FTW_EMPTY_PAYMENT_STATUS_GRACE_MS;
      const noPaymentStatusGraceActive =
        items.length === 0 &&
        Date.now() < (terminationRequestedAt
          ? terminationRequestedAt
          : heartbeatBaseTime + FTW_CHECKOUT_HEARTBEAT_STALE_MS) + emptyStatusGraceMs &&
        Date.now() < expiresAt.getTime() + FTW_PENDING_PAYMENT_GRACE_MS;
      if (noPaymentStatusGraceActive) {
        const emptyStatusGraceEndsAt = (terminationRequestedAt
          ? terminationRequestedAt
          : heartbeatBaseTime + FTW_CHECKOUT_HEARTBEAT_STALE_MS) + emptyStatusGraceMs;
        await OrderModel.collection.updateOne(
          { _id: order._id, ftwCheckoutNextPaymentCheckAt: nextPaymentCheckAt },
          { $set: { ftwCheckoutNextPaymentCheckAt: new Date(emptyStatusGraceEndsAt + 100) } },
        );
      }

      if (order.ftwInventoryState === "reserving") {
        const subHub = await resolveOrderSubHub(order);
        const { Product } = await getHubModels(subHub.dbName);
        const operationCollection = getRawCollection(Product, "ftw_inventory_operations");
        const reservation = await operationCollection.findOne({
          operationKey: order.ftwInventoryOperationId,
        });
        if (reservation?.state === "reserved") {
          await OrderModel.collection.updateOne(
            { _id: order._id, ftwInventoryState: "reserving" },
            {
              $set: {
                inventoryDeducted: true,
                ftwInventoryState: "reserved",
                ftwInventoryAllocations: reservation.allocations,
                updatedAt: new Date(),
              },
            },
          );
          order.ftwInventoryState = "reserved";
          order.inventoryDeducted = true;
        } else if (
          reservation ||
          (heartbeatShowsLiveCheckout && Date.now() < expiresAt.getTime()) ||
          noPaymentStatusGraceActive ||
          (hasUnresolvedPayment && now.getTime() < expiresAt.getTime() + FTW_PENDING_PAYMENT_GRACE_MS)
        ) {
          continue;
        } else {
          const failedReservation = await OrderModel.collection.updateOne(
            {
              _id: order._id,
              ftwInventoryState: "reserving",
              paymentStatus: { $ne: "paid" },
              $or: [{ ftwPaymentFinalizedAt: null }, { ftwPaymentFinalizedAt: { $exists: false } }],
            },
            {
              $set: {
                inventoryDeducted: false,
                ftwInventoryState: "restored",
                ftwInventoryRestoreReason: "reservation_failed",
                status: "cancelled",
                updatedAt: new Date(),
              },
              $unset: { ftwInventoryExpiresAt: "" },
            },
          );
          if (failedReservation.modifiedCount === 1) {
            await deleteUnpaidFtwCheckout(String(order._id));
          }
          continue;
        }
      }

      if (heartbeatShowsLiveCheckout && Date.now() < expiresAt.getTime()) continue;
      if (noPaymentStatusGraceActive) continue;
      if (hasUnresolvedPayment && now.getTime() < expiresAt.getTime() + FTW_PENDING_PAYMENT_GRACE_MS) {
        continue;
      }
      const reason = order.ftwCheckoutTerminationReason ??
        (order.ftwBrowserClosedAt ? "browser_closed" : (expiresAt <= now ? "payment_expired" : "browser_closed"));
      const restoreReason = [
        "payment_failed",
        "payment_cancelled",
        "payment_expired",
        "browser_closed",
      ].includes(String(reason))
        ? reason as "payment_failed" | "payment_cancelled" | "payment_expired" | "browser_closed"
        : "browser_closed";
      const restoration = await restoreFtwInventory(String(order._id), restoreReason);
      if (restoration.restored && !restoration.reconciliationRequired) {
        await deleteUnpaidFtwCheckout(String(order._id));
      }
    } catch (error) {
      await OrderModel.collection.updateOne(
        { _id: order._id, paymentStatus: { $ne: "paid" } },
        { $set: { ftwCheckoutNextPaymentCheckAt: new Date(Date.now() + FTW_PAYMENT_STATUS_RETRY_MS) } },
      ).catch(() => {});
      logInventoryFailure(order, String(order.ftwInventoryOperationId ?? "reconcile"), "", error);
    }
  }
}
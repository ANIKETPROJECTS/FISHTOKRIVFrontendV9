import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;

let ordersConnection: mongoose.Connection | null = null;

const orderCouponSchema = new mongoose.Schema(
  {
    couponId: { type: mongoose.Schema.Types.ObjectId, default: null },
    code: { type: String, default: null },
    discountType: { type: String, default: null },
    discountValue: { type: Number, default: null },
    discountAmount: { type: Number, default: null },
  },
  { _id: false }
);

const deliveryAddressDetailSchema = new mongoose.Schema(
  {
    name: { type: String, default: null },
    phone: { type: String, default: null },
    building: { type: String, default: null },
    street: { type: String, default: null },
    area: { type: String, default: null },
    pincode: { type: String, default: null },
    type: { type: String, default: "house" },
    label: { type: String, default: "Home" },
    instructions: { type: String, default: "" },
    _id: { type: String, default: null },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    customerId: { type: String, default: null },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, default: null },
    items: { type: mongoose.Schema.Types.Mixed, required: true },
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    slotCharge: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    deliveryType: { type: String, default: "delivery" },
    address: { type: String, required: true },
    deliveryArea: { type: String, required: true },
    deliveryAddressDetail: { type: deliveryAddressDetailSchema, default: null },
    pickupLocation: { type: String, default: "" },
    notes: { type: String, default: "" },
    status: { type: String, default: "pending" },
    source: { type: String, default: "online" },
    subHubId: { type: String, default: null },
    subHubName: { type: String, default: null },
    superHubId: { type: String, default: null },
    superHubName: { type: String, default: null },
    couponIds: { type: [String], default: [] },
    couponCodes: { type: [String], default: [] },
    coupons: { type: mongoose.Schema.Types.Mixed, default: [] },
    paymentStatus: { type: String, default: "unpaid" },
    payments: { type: mongoose.Schema.Types.Mixed, default: [] },
    paidAmount: { type: Number, default: 0 },
    dueAmount: { type: Number, default: 0 },
    paymentMode: { type: String, default: null },
    upiVariant: { type: String, default: null },
    scheduleType: { type: String, default: null },
    orderType: { type: String, default: null },
    deliveryDate: { type: String, default: null },
    timeslotId: { type: String, default: null },
    timeslotLabel: { type: String, default: null },
    timeslotStart: { type: String, default: null },
    timeslotEnd: { type: String, default: null },
    inventoryDeducted: { type: Boolean, default: false },
    upiTransactionId: { type: String, default: null },
    razorpayOrderId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    orderId: { type: String },
  },
  { versionKey: false }
);

export async function connectOrdersDb() {
  if (!ordersConnection) {
    ordersConnection = mongoose.createConnection(MONGODB_URI, { dbName: "orders" });
    ordersConnection.on("connected", () => console.log("Connected to orders DB"));
    ordersConnection.on("error", (err) => console.error("Orders DB error:", err));
    await ordersConnection.asPromise();
  }
  return ordersConnection;
}

export function getOrderModel() {
  if (!ordersConnection) {
    throw new Error("Orders DB not connected. Call connectOrdersDb() first.");
  }
  return ordersConnection.models["Order"] || ordersConnection.model("Order", orderSchema);
}

// ── Pending Checkout (webhook recovery store) ─────────────────────────────────
// Stores the full order payload immediately when a Razorpay order is created
// (before the modal opens). The webhook uses this to reconstruct the FishTokri
// order if the browser closes before the client-side handler fires.
// TTL: 24 hours (Razorpay retries webhooks for up to 24 hours).

const pendingCheckoutSchema = new mongoose.Schema(
  {
    razorpayOrderId: { type: String, required: true, unique: true, index: true },
    orderPayload: { type: mongoose.Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now, expires: 86400 }, // 24h TTL
  },
  { versionKey: false }
);

export function getPendingCheckoutModel() {
  if (!ordersConnection) {
    throw new Error("Orders DB not connected. Call connectOrdersDb() first.");
  }
  return ordersConnection.models["PendingCheckout"] ||
    ordersConnection.model("PendingCheckout", pendingCheckoutSchema);
}

/**
 * Generates the next orderId by counting all existing orders (admin + online)
 * whose orderId starts with today's IST date prefix, then adding 1.
 * This shares the same sequence pool as the admin POS panel.
 * Format: #FTS{YYYYMMDD}{N} — e.g. #FTS202605275
 *
 * Must be called AFTER the new order is saved (without an orderId) so the
 * count does not include the current order and the result is N+1.
 */
export async function generateOrderId(): Promise<string> {
  const now = new Date();
  // Use IST (UTC+5:30) so orders placed after midnight IST get the correct date.
  const istDate = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const dateStr = istDate.toISOString().slice(0, 10).replace(/-/g, ""); // "YYYYMMDD"
  const OrderModel = getOrderModel();
  const count = await OrderModel.countDocuments({
    orderId: { $regex: `^#FTW${dateStr}` },
  });
  return `#FTW${dateStr}${count + 1}`;
}

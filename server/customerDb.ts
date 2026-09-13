import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error("MONGODB_URI must be set.");
}

export const customerConnection = mongoose.createConnection(MONGODB_URI, {
  dbName: "customers",
});

customerConnection.on("connected", () => {
  console.log("Connected to customers DB");
});

customerConnection.on("error", (err) => {
  console.error("Customer DB connection error:", err);
});

// Permanent history of coupons from delivered orders — one entry per delivered order
const usedCouponEntrySchema = new mongoose.Schema(
  {
    couponId: { type: String, required: true },
    couponCode: { type: String, required: true, uppercase: true, trim: true },
    couponTitle: { type: String, default: "" },
    orderId: { type: String, required: true },
    subHubId: { type: String, default: "" },
    usedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerAddressSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
    building: { type: String, default: "" },
    street: { type: String, default: "" },
    area: { type: String, required: true },
    pincode: { type: String, default: "" },
    type: { type: String, default: "house" },
    label: { type: String, default: "Home" },
    instructions: { type: String, default: "" },
  },
  { _id: true }
);

const embeddedOrderItemSchema = new mongoose.Schema(
  {
    productId: { type: String, default: null },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
    unit: { type: String, default: null },
    imageUrl: { type: String, default: null },
  },
  { _id: false }
);

const embeddedOrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    customerName: { type: String, required: true },
    phone: { type: String, required: true },
    deliveryArea: { type: String, required: true },
    address: { type: String, required: true },
    items: { type: mongoose.Schema.Types.Mixed, required: true },
    status: { type: String, default: "pending" },
    notes: { type: String, default: null },
    total: { type: Number, default: null },
    placedAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// Tracks coupons locked in currently active (non-delivered) orders
const activeCouponEntrySchema = new mongoose.Schema(
  {
    couponId: { type: String, required: true },
    couponCode: { type: String, required: true, uppercase: true, trim: true },
    couponTitle: { type: String, default: "" },
    subHubId: { type: String, default: "" },
    usedCount: { type: Number, default: 1 },
    orderIds: { type: [String], default: [] },
    appliedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: null },
  email: { type: String, default: null },
  dateOfBirth: { type: String, default: null },
  walletBalance: { type: Number, default: 0 },
  addresses: { type: [customerAddressSchema], default: [] },
  orders: { type: [embeddedOrderSchema], default: [] },
  activeCoupons: { type: [activeCouponEntrySchema], default: [] },
  usedCoupons: { type: [usedCouponEntrySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

export const CustomerDbModel =
  customerConnection.models.Customer ||
  customerConnection.model("Customer", customerSchema);

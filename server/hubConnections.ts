import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI!;

const connectionCache = new Map<string, mongoose.Connection>();

const inventoryBatchSchema = new mongoose.Schema({
  quantity: { type: Number, required: true },
  shelfLifeDays: { type: Number, required: true },
  entryDate: { type: Date, default: Date.now },
  expiryDate: { type: Date, default: null },
  remainingTime: { type: String, default: null },
});

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  category: { type: String, required: true },
  subCategory: { type: String, default: null },
  status: { type: String, default: "available" },
  limitedStockNote: { type: String, default: null },
  price: { type: Number, default: null },
  originalPrice: { type: Number, default: null },
  unit: { type: String, default: null },
  imageUrl: { type: String, default: null },
  isArchived: { type: Boolean, default: false },
  updatedAt: { type: Date, default: Date.now },
  sectionId: { type: mongoose.Schema.Types.Mixed, default: null },
  description: { type: String, default: null },
  grossWeight: { type: String, default: null },
  netWeight: { type: String, default: null },
  pieces: { type: String, default: null },
  serves: { type: String, default: null },
  discountPct: { type: Number, default: null },
  quantity: { type: Number, default: null },
  preorderMode: { type: String, default: "normal" },
  preorderAvailability: {
    type: {
      type: String,
      enum: ["all", "weekdays", "date_range"],
      default: "all",
    },
    weekdays: { type: [Number], default: [0, 1, 2, 3, 4, 5, 6] },
    startDate: { type: String, default: "" },
    endDate: { type: String, default: "" },
  },
  couponIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  inventoryBatches: { type: [inventoryBatchSchema], default: [] },
  recipes: [{
    title: { type: String },
    description: { type: String },
    image: { type: String, default: "" },
    totalTime: { type: String, default: "" },
    prepTime: { type: String, default: "" },
    cookTime: { type: String, default: "" },
    servings: { type: Number, default: 2 },
    difficulty: { type: String, default: "Medium" },
    ingredients: [{ type: String }],
    method: [{ type: String }],
  }],
});

const couponSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  title: { type: String, required: true },
  description: { type: String, required: true },
  type: { type: String, enum: ["flat", "percentage"], required: true },
  discountValue: { type: Number, required: true },
  minOrderAmount: { type: Number, default: 0 },
  maxUsage: { type: Number, default: null },
  perUserLimit: { type: Number, default: null }, // max times a single user can use this coupon per location
  isFirstTimeOnly: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  applicableCategories: { type: [String], default: [] },
  expiresAt: { type: Date, default: null },
  color: { type: String, default: "bg-blue-50 border-blue-200 text-blue-700" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

const sectionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, default: "products" },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

const carouselSchema = new mongoose.Schema({
  imageUrl: { type: String, required: true },
  title: { type: String, default: null },
  linkUrl: { type: String, default: null },
  order: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
});

const subCategorySchema = new mongoose.Schema(
  { name: { type: String, required: true }, imageUrl: { type: String, default: null } },
  { _id: false }
);

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  imageUrl: { type: String, default: null },
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  subCategories: { type: [subCategorySchema], default: [] },
});

const comboItemSchema = new mongoose.Schema(
  { productId: { type: String, required: true }, label: { type: String, required: true }, quantity: { type: Number, default: 1 } },
  { _id: false }
);

const nutritionItemSchema = new mongoose.Schema(
  { label: { type: String, required: true }, value: { type: String, required: true }, icon: { type: String, default: "" } },
  { _id: false }
);

const comboSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: null },
  fullDescription: { type: String, default: null },
  serves: { type: String, default: null },
  weight: { type: String, default: null },
  discountedPrice: { type: Number, required: true },
  originalPrice: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  includes: { type: [comboItemSchema], default: [] },
  tags: { type: [String], default: [] },
  nutrition: { type: [nutritionItemSchema], default: [] },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
});

const timeslotSchema = new mongoose.Schema({
  label: { type: String, required: true },
  startTime: { type: String, default: null },
  endTime: { type: String, default: null },
  isInstant: { type: Boolean, default: false },
  extraCharge: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  orderLimit: { type: Number, default: 10 },
  todaysOrderCount: { type: Number, default: 0 },
  nextDayOrderCount: { type: Number, default: 0 },
  limitedByOrders: { type: Boolean, default: false },
  activeDays: [{ day: { type: String }, status: { type: String, enum: ["on", "off"], default: "on" } }],
});

const couponUsageSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  couponCode: { type: String, required: true, uppercase: true, trim: true },
  usageCount: { type: Number, default: 1 },
  lastUsedAt: { type: Date, default: Date.now },
});

// Tracks total coupon usage per location (one doc per coupon in this hub DB)
// Location is implicit — this collection lives inside the hub (location) DB
const couponLocationUsageSchema = new mongoose.Schema({
  couponCode: { type: String, required: true, uppercase: true, trim: true, unique: true },
  usedCount: { type: Number, default: 0 },
  maxUsageLimit: { type: Number, default: null }, // null = no location-level cap
});

export interface HubModels {
  Product: mongoose.Model<any>;
  Section: mongoose.Model<any>;
  Carousel: mongoose.Model<any>;
  Category: mongoose.Model<any>;
  Combo: mongoose.Model<any>;
  Timeslot: mongoose.Model<any>;
  Coupon: mongoose.Model<any>;
  CouponUsage: mongoose.Model<any>;
  CouponLocationUsage: mongoose.Model<any>;
}

export async function getHubModels(dbName: string): Promise<HubModels> {
  if (!connectionCache.has(dbName)) {
    const conn = mongoose.createConnection(MONGODB_URI, { dbName });
    conn.on("connected", () => console.log(`Connected to hub DB: ${dbName}`));
    conn.on("error", (err) => console.error(`Hub DB ${dbName} error:`, err));
    connectionCache.set(dbName, conn);
  }

  const conn = connectionCache.get(dbName)!;

  const getModel = <T>(name: string, schema: mongoose.Schema) =>
    conn.models[name] || conn.model<T>(name, schema);

  return {
    Product: getModel("Product", productSchema),
    Section: getModel("Section", sectionSchema),
    Carousel: getModel("Carousel", carouselSchema),
    Category: getModel("Category", categorySchema),
    Combo: getModel("Combo", comboSchema),
    Timeslot: getModel("Timeslot", timeslotSchema),
    Coupon: getModel("Coupon", couponSchema),
    CouponUsage: getModel("CouponUsage", couponUsageSchema),
    CouponLocationUsage: getModel("CouponLocationUsage", couponLocationUsageSchema),
  };
}

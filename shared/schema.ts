import { z } from "zod";
import type { PreorderMode } from "./productVisibility";
import { PREORDER_AVAILABILITY_TYPES, type PreorderAvailability } from "./preorderAvailability";

export type User = {
  id: string;
  username: string;
  password: string;
};

export type InsertUser = {
  username: string;
  password: string;
};

export type Recipe = {
  title: string;
  description: string;
  image: string;
  totalTime: string;
  prepTime: string;
  cookTime: string;
  servings: number;
  difficulty: string;
  ingredients: string[];
  method: string[];
};

export type Coupon = {
  id: string;
  code: string;
  title: string;
  description: string;
  type: "flat" | "percentage";
  discountValue: number;
  minOrderAmount: number;
  maxUsage: number | null;
  isFirstTimeOnly: boolean;
  isActive: boolean;
  applicableCategories: string[];
  expiresAt: Date | null;
  color: string;
  visibleOnWebsite: boolean;
  applicableCustomers: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type Product = {
  id: string;
  name: string;
  category: string;
  subCategory: string | null;
  status: string;
  limitedStockNote: string | null;
  price: number | null;
  originalPrice: number | null;
  unit: string | null;
  imageUrl: string | null;
  isArchived: boolean;
  updatedAt: Date;
  sectionId: string | string[] | null;
  description: string | null;
  grossWeight: string | null;
  netWeight: string | null;
  pieces: string | null;
  serves: string | null;
  discountPct: number | null;
  quantity: number | null;
  availableQty: number | null;
  /** True when the product has inventory batches and every batch has expired. */
  batchExpired: boolean;
  couponIds: string[];
  recipes: Recipe[];
  preorderMode: PreorderMode;
  preorderAvailability?: PreorderAvailability | null;
};

export type InsertProduct = {
  name: string;
  category: string;
  subCategory?: string | null;
  status?: string;
  limitedStockNote?: string | null;
  price?: number | null;
  originalPrice?: number | null;
  unit?: string | null;
  imageUrl?: string | null;
  sectionId?: string | string[] | null;
  description?: string | null;
  grossWeight?: string | null;
  netWeight?: string | null;
  pieces?: string | null;
  serves?: string | null;
  quantity?: number | null;
  recipes?: Recipe[];
  preorderMode?: PreorderMode;
  preorderAvailability?: PreorderAvailability | null;
};

export type UpdateProductRequest = Partial<InsertProduct> & { isArchived?: boolean };

export type Section = {
  id: string;
  title: string;
  type: "products" | "combos";
  sortOrder: number;
  isActive: boolean;
};

export type InsertSection = {
  title: string;
  type?: "products" | "combos";
  sortOrder?: number;
  isActive?: boolean;
};

export type OrderItem = {
  productId: string;
  quantity: number;
  name: string;
  price: number | null;
  imageUrl?: string | null;
};

export type TimeslotActiveDay = {
  day: string;   // "sunday" | "monday" | ... | "saturday"
  status: "on" | "off";
};

export type Timeslot = {
  id: string;
  label: string;
  startTime: string | null;
  endTime: string | null;
  isInstant: boolean;
  extraCharge: number;
  isActive: boolean;
  sortOrder: number;
  orderLimit: number;
  todaysOrderCount: number;
  nextDayOrderCount: number;
  limitedByOrders: boolean;
  activeDays: TimeslotActiveDay[];
};

export type OrderCoupon = {
  couponId: string | null;
  code: string;
  couponTitle: string;
  discountType: string;
  discountValue: number;
  discountAmount: number;
};

export type OrderRequest = {
  id: string;
  orderId?: string | null;
  customerName: string;
  phone: string;
  deliveryArea: string;
  address: string;
  items: OrderItem[];
  status: string;
  notes: string | null;
  createdAt: Date;
  deliveryType?: string | null;
  timeslotLabel?: string | null;
  instantDeliveryCharge?: number | null;
  slotCharge?: number | null;
  deliveryCharge?: number | null;
  discount?: number | null;
  extraDiscount?: number | null;
  extraDiscountType?: string | null;
  scheduleType?: string | null;
  isExpress?: boolean | null;
  coupon?: OrderCoupon | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  payments?: Array<{ mode: string; amount: number; reference?: string; paidAt?: string }> | null;
  paidAmount?: number | null;
  dueAmount?: number | null;
  upiVariant?: string | null;
  superHubId?: string | null;
  subHubId?: string | null;
  subHubName?: string | null;
};

export type DeliveryAddressDetail = {
  _id?: string | null;
  name?: string | null;
  phone?: string | null;
  building?: string | null;
  street?: string | null;
  area?: string | null;
  pincode?: string | null;
  type?: string | null;
  label?: string | null;
  instructions?: string | null;
};

export type InsertOrderRequest = {
  orderId?: string | null;
  customerId?: string | null;
  customerName: string;
  phone: string;
  email?: string | null;
  deliveryArea: string;
  address: string;
  deliveryAddressDetail?: DeliveryAddressDetail | null;
  items: OrderItem[];
  subtotal?: number | null;
  discount?: number | null;
  slotCharge?: number | null;
  total?: number | null;
  notes?: string | null;
  source?: string | null;
  hubDbName?: string | null;
  deliveryType?: string | null;
  scheduleType?: string | null;
  timeslotId?: string | null;
  timeslotLabel?: string | null;
  timeslotStart?: string | null;
  timeslotEnd?: string | null;
  deliveryDate?: string | null;
  couponCode?: string | null;
  discountAmount?: number | null;
  paymentMode?: string | null;
  upiVariant?: string | null;
  walletAmountUsed?: number | null;
  payments?: Array<{ mode: string; amount: number; reference?: string; paidAt?: string }> | null;
  paidAmount?: number | null;
  dueAmount?: number | null;
  paymentStatus?: string | null;
  superHubId?: string | null;
  subHubId?: string | null;
  subHubName?: string | null;
  razorpayOrderId?: string | null;
};

export type InventoryBatch = {
  id: string;
  quantity: number;
  shelfLifeDays: number;
  entryDate: Date;
  expiryDate: Date | null;
  remainingTime: string | null;
};

export const insertInventoryBatchSchema = z.object({
  quantity: z.number().min(1, "Quantity must be at least 1"),
  shelfLifeDays: z.number().min(0.5, "Shelf life must be at least 0.5 days"),
});

export const insertProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  category: z.string().min(1, "Category is required"),
  subCategory: z.string().nullable().optional(),
  status: z.string().optional(),
  limitedStockNote: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  originalPrice: z.number().nullable().optional(),
  unit: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  sectionId: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  description: z.string().nullable().optional(),
  grossWeight: z.string().nullable().optional(),
  netWeight: z.string().nullable().optional(),
  pieces: z.string().nullable().optional(),
  serves: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  preorderMode: z.enum(["normal", "preorder_only", "normal_and_preorder"]).optional(),
  preorderAvailability: z.object({
    type: z.enum(PREORDER_AVAILABILITY_TYPES),
    weekdays: z.array(z.number().int().min(0).max(6)).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
  }).nullable().optional(),
  recipes: z.array(z.object({
    title: z.string(),
    description: z.string(),
    image: z.string().optional().default(""),
    totalTime: z.string().optional().default(""),
    prepTime: z.string().optional().default(""),
    cookTime: z.string().optional().default(""),
    servings: z.number().optional().default(2),
    difficulty: z.string().optional().default("Medium"),
    ingredients: z.array(z.string()).optional().default([]),
    method: z.array(z.string()).optional().default([]),
  })).optional(),
});

export const insertSectionSchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.enum(["products", "combos"]).optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
});

const deliveryAddressDetailSchema = z.object({
  _id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  building: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  area: z.string().nullable().optional(),
  pincode: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
});

export const insertOrderRequestSchema = z.object({
  customerName: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  email: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  deliveryArea: z.string().min(1, "Delivery area is required"),
  address: z.string().min(1, "Address is required"),
  deliveryAddressDetail: deliveryAddressDetailSchema.nullable().optional(),
  items: z.array(z.object({
    productId: z.string(),
    quantity: z.number().min(1),
    name: z.string(),
    price: z.number().nullable(),
    unit: z.string().nullable().optional(),
    imageUrl: z.string().nullable().optional(),
  })).min(1, "At least one item is required"),
  subtotal: z.number().nullable().optional(),
  discount: z.number().nullable().optional(),
  slotCharge: z.number().nullable().optional(),
  total: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  hubDbName: z.string().nullable().optional(),
  deliveryType: z.string().nullable().optional(),
  scheduleType: z.string().nullable().optional(),
  timeslotId: z.string().nullable().optional(),
  timeslotLabel: z.string().nullable().optional(),
  timeslotStart: z.string().nullable().optional(),
  timeslotEnd: z.string().nullable().optional(),
  deliveryDate: z.string().nullable().optional(),
  orderType: z.enum(["normal", "preorder"]).nullable().optional(),
  instantDeliveryCharge: z.number().nullable().optional(),
  couponCode: z.string().nullable().optional(),
  discountAmount: z.number().nullable().optional(),
  paymentMethod: z.string().nullable().optional(),
  paymentMode: z.string().nullable().optional(),
  upiVariant: z.string().nullable().optional(),
  walletAmountUsed: z.number().nullable().optional(),
  payments: z.array(z.object({
    mode: z.string(),
    amount: z.number(),
    reference: z.string().optional(),
    paidAt: z.string().optional(),
  })).nullable().optional(),
  paidAmount: z.number().nullable().optional(),
  dueAmount: z.number().nullable().optional(),
  paymentStatus: z.string().nullable().optional(),
  razorpayOrderId: z.string().nullable().optional(),
});

export const insertUserSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type SubCategory = {
  name: string;
  imageUrl: string | null;
};

export type Category = {
  id: string;
  name: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  subCategories: SubCategory[];
};

export type InsertCategory = {
  name: string;
  imageUrl?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  subCategories?: SubCategory[];
};

export const insertCategorySchema = z.object({
  name: z.string().min(1, "Name is required"),
  imageUrl: z.string().nullable().optional(),
  sortOrder: z.number().optional(),
  isActive: z.boolean().optional(),
  subCategories: z.array(z.object({
    name: z.string().min(1),
    imageUrl: z.string().nullable().optional(),
  })).optional(),
});

export type CustomerAddress = {
  id: string;
  name: string;
  phone: string;
  building: string;
  street: string;
  area: string;
  pincode: string;
  type: "house" | "office" | "other";
  label: string;
  instructions: string;
};

export type EmbeddedOrder = {
  orderId: string;
  customerName: string;
  phone: string;
  deliveryArea: string;
  address: string;
  items: OrderItem[];
  status: string;
  notes: string | null;
  total: number | null;
  placedAt: Date;
  updatedAt: Date;
};

export type Customer = {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  dateOfBirth: string | null;
  addresses: CustomerAddress[];
  orders: EmbeddedOrder[];
  walletBalance: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InsertCustomer = {
  phone: string;
  name?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
};

export type UpdateCustomer = {
  name?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
};

export const insertCustomerAddressSchema = z.object({
  name: z.string().min(1, "Name is required"),
  phone: z.string().min(1, "Phone is required"),
  building: z.string().min(1, "Building is required"),
  street: z.string().optional().default(""),
  area: z.string().min(1, "Area is required"),
  pincode: z.string().regex(/^\d{6}$/, "A valid 6-digit pincode is required"),
  type: z.enum(["house", "office", "other"]).optional().default("house"),
  label: z.string().optional().default("Home"),
  instructions: z.string().optional().default(""),
});

export const updateCustomerSchema = z.object({
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  dateOfBirth: z.string().nullable().optional(),
});

export type ComboItem = {
  productId: string;
  label: string;
  quantity: number;
};

export type NutritionItem = {
  label: string;
  value: string;
  icon: string;
};

export type Combo = {
  id: string;
  name: string;
  description: string | null;
  fullDescription: string | null;
  serves: string | null;
  weight: string | null;
  discountedPrice: number;
  originalPrice: number;
  discount: number;
  includes: ComboItem[];
  tags: string[];
  nutrition: NutritionItem[];
  isActive: boolean;
  sortOrder: number;
};

export type InsertCombo = {
  name: string;
  description?: string | null;
  fullDescription?: string | null;
  serves?: string | null;
  weight?: string | null;
  discountedPrice: number;
  originalPrice: number;
  discount?: number;
  includes?: ComboItem[];
  tags?: string[];
  nutrition?: NutritionItem[];
  isActive?: boolean;
  sortOrder?: number;
};

export const insertComboSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  fullDescription: z.string().nullable().optional(),
  serves: z.string().nullable().optional(),
  weight: z.string().nullable().optional(),
  discountedPrice: z.number().min(0),
  originalPrice: z.number().min(0),
  discount: z.number().optional(),
  includes: z.array(z.object({ productId: z.string(), label: z.string() })).optional(),
  tags: z.array(z.string()).optional(),
  nutrition: z.array(z.object({ label: z.string(), value: z.string(), icon: z.string() })).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export type CarouselSlide = {
  id: string;
  imageUrl: string;
  title: string | null;
  linkUrl: string | null;
  order: number;
  isActive: boolean;
};

export type InsertCarouselSlide = {
  imageUrl: string;
  title?: string | null;
  linkUrl?: string | null;
  order?: number;
  isActive?: boolean;
};

export const insertCarouselSlideSchema = z.object({
  imageUrl: z.string().min(1, "Image URL is required"),
  title: z.string().nullable().optional(),
  linkUrl: z.string().nullable().optional(),
  order: z.number().optional(),
  isActive: z.boolean().optional(),
});

export type CreateProductRequest = InsertProduct;
export type CreateOrderRequest = InsertOrderRequest;
export type UpdateOrderStatusRequest = { status: string };

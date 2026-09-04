import { UserModel } from "./adminDb";
import { getOrderModel } from "./ordersDb";
import { CustomerDbModel } from "./customerDb";
import type {
  User,
  InsertUser,
  OrderRequest,
  InsertOrderRequest,
  Customer,
  InsertCustomer,
  UpdateCustomer,
  CustomerAddress,
  EmbeddedOrder,
} from "@shared/schema";

function toUser(doc: any): User {
  return {
    id: doc._id.toString(),
    username: doc.username,
    password: doc.password,
  };
}

function toCustomer(doc: any): Customer {
  if (!doc) throw new Error("toCustomer called with null/undefined document");
  return {
    id: doc._id?.toString() ?? "",
    phone: doc.phone,
    name: doc.name ?? null,
    email: doc.email ?? null,
    dateOfBirth: doc.dateOfBirth ?? null,
    addresses: (doc.addresses ?? []).map((a: any, idx: number) => ({
      // NOTE: every address should have a real Mongo _id (assigned by addCustomerAddress,
      // or backfilled by the one-time migration for legacy/bulk-imported data — see
      // scripts/backfill-address-ids.mjs). The composite-key fallback below only exists
      // as a last resort for data that somehow still lacks an _id; it is inherently
      // ambiguous (can mismatch when two addresses share the same building/area/pincode)
      // and must never be relied on as the primary path.
      id: a._id?.toString() || [a.building, a.area, a.pincode, a.phone, idx].filter((v) => v !== undefined && v !== null && v !== "").join("|"),
      name: a.name ?? "",
      phone: a.phone ?? "",
      building: a.building ?? "",
      street: a.street ?? "",
      area: a.area ?? "",
      pincode: a.pincode ?? "",
      type: a.type ?? "house",
      label: a.label ?? "Home",
      instructions: a.instructions ?? "",
    })),
    orders: (doc.orders ?? []).map((o: any) => ({
      orderId: o.orderId,
      customerName: o.customerName,
      phone: o.phone,
      deliveryArea: o.deliveryArea,
      address: o.address,
      items: o.items,
      status: o.status ?? "pending",
      notes: o.notes ?? null,
      total: o.total ?? null,
      placedAt: o.placedAt,
      updatedAt: o.updatedAt,
    })),
    walletBalance: doc.walletBalance ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toOrder(doc: any): OrderRequest {
  return {
    id: doc._id.toString(),
    orderId: doc.orderId ?? null,
    customerName: doc.customerName,
    phone: doc.phone,
    deliveryArea: doc.deliveryArea,
    address: doc.address,
    items: doc.items,
    status: doc.status,
    notes: doc.notes ?? null,
    createdAt: doc.createdAt,
    deliveryType: doc.deliveryType ?? null,
    timeslotLabel: doc.timeslotLabel ?? null,
    instantDeliveryCharge: doc.instantDeliveryCharge ?? null,
    slotCharge: doc.slotCharge ?? 0,
    // Keep null when no explicit override exists so the storefront can fall
    // back to the authoritative slotCharge. A real 0 remains an intentional
    // free-delivery override.
    deliveryCharge: doc.deliveryCharge ?? null,
    discount: doc.discount ?? 0,
    extraDiscount: doc.extraDiscount ?? 0,
    extraDiscountType: doc.extraDiscountType ?? null,
    scheduleType: doc.scheduleType ?? null,
    isExpress: doc.isExpress ?? false,
    total: doc.total ?? null,
    coupon: (doc.coupons?.[0] ?? doc.coupon)
      ? (() => {
          const c = doc.coupons?.[0] ?? doc.coupon;
          return {
            couponId: c.couponId?.toString() ?? null,
            code: c.code,
            couponTitle: c.couponTitle ?? c.title ?? "",
            discountType: c.discountType,
            discountValue: c.discountValue,
            discountAmount: c.discountAmount ?? doc.discount ?? 0,
          };
        })()
      : null,
    paymentMethod: doc.paymentMethod ?? null,
    paymentStatus: doc.paymentStatus ?? "unpaid",
    payments: doc.payments ?? [],
    paidAmount: doc.paidAmount ?? 0,
    dueAmount: doc.dueAmount ?? (doc.total ?? 0),
    upiVariant: doc.upiVariant ?? null,
    deliveryDate: doc.deliveryDate ?? null,
    superHubId: doc.superHubId?.toString() ?? null,
    subHubId: doc.subHubId?.toString() ?? null,
    subHubName: doc.subHubName ?? null,
  };
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getOrderRequests(): Promise<OrderRequest[]>;
  getOrdersByPhone(phone: string): Promise<OrderRequest[]>;
  getOrderRequest(id: string): Promise<OrderRequest | undefined>;
  createOrderRequest(order: InsertOrderRequest): Promise<OrderRequest>;
  updateOrderRequestStatus(id: string, status: string): Promise<OrderRequest | undefined>;

  getCustomerByPhone(phone: string): Promise<Customer | undefined>;
  createCustomer(data: InsertCustomer): Promise<Customer>;
  upsertCustomer(phone: string, data: Partial<InsertCustomer>): Promise<Customer>;
  updateCustomer(phone: string, updates: UpdateCustomer): Promise<Customer | undefined>;
  addCustomerAddress(phone: string, address: Omit<CustomerAddress, "id">): Promise<Customer | undefined>;
  updateCustomerAddress(phone: string, addrId: string, updates: Partial<Omit<CustomerAddress, "id">>): Promise<Customer | undefined>;
  deleteCustomerAddress(phone: string, addrId: string): Promise<Customer | undefined>;
  getAllCustomers(): Promise<Customer[]>;
  pushOrderToCustomer(phone: string, order: Omit<EmbeddedOrder, "updatedAt">): Promise<void>;
  updateCustomerOrderStatus(phone: string, orderId: string, status: string): Promise<void>;
}

export class MongoStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const doc = await UserModel.findById(id).lean();
    return doc ? toUser(doc) : undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const doc = await UserModel.findOne({ username }).lean();
    return doc ? toUser(doc) : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const doc = await UserModel.create(user);
    return toUser(doc);
  }

  async getOrderRequests(): Promise<OrderRequest[]> {
    const docs = await getOrderModel().find().sort({ createdAt: -1 }).lean();
    return docs.map(toOrder);
  }

  async getOrdersByPhone(phone: string): Promise<OrderRequest[]> {
    const docs = await getOrderModel().find({ phone }).sort({ createdAt: -1 }).lean();
    return docs.map(toOrder);
  }

  async getOrderRequest(id: string): Promise<OrderRequest | undefined> {
    try {
      const doc = await getOrderModel().findById(id).lean();
      return doc ? toOrder(doc) : undefined;
    } catch {
      return undefined;
    }
  }

  async createOrderRequest(order: InsertOrderRequest): Promise<OrderRequest> {
    const doc = await getOrderModel().create({
      ...order,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return toOrder(doc);
  }

  async updateOrderRequestStatus(id: string, status: string): Promise<OrderRequest | undefined> {
    try {
      const doc = await getOrderModel().findByIdAndUpdate(id, { status }, { new: true }).lean();
      return doc ? toOrder(doc) : undefined;
    } catch {
      return undefined;
    }
  }

  async getCustomerByPhone(phone: string): Promise<Customer | undefined> {
    const doc = await CustomerDbModel.findOne({ phone }).lean();
    return doc ? toCustomer(doc) : undefined;
  }

  async createCustomer(data: InsertCustomer): Promise<Customer> {
    const doc = await CustomerDbModel.create({ ...data, addresses: [], orders: [], createdAt: new Date(), updatedAt: new Date() });
    return toCustomer(doc);
  }

  async upsertCustomer(phone: string, data: Partial<InsertCustomer>): Promise<Customer> {
    const { phone: _ignored, ...rest } = data as any;
    const doc = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $set: { ...rest, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date(), addresses: [], orders: [] } },
      { returnDocument: "after", upsert: true }
    ).lean();
    return toCustomer(doc);
  }

  async updateCustomer(phone: string, updates: UpdateCustomer): Promise<Customer | undefined> {
    const doc = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $set: { ...updates, updatedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();
    return doc ? toCustomer(doc) : undefined;
  }

  async addCustomerAddress(phone: string, address: Omit<CustomerAddress, "id">): Promise<Customer | undefined> {
    const mongoose = await import("mongoose");
    const doc = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $push: { addresses: { _id: new mongoose.Types.ObjectId(), ...address } }, $set: { updatedAt: new Date() } },
      { returnDocument: "after" }
    ).lean();
    return doc ? toCustomer(doc) : undefined;
  }

  async updateCustomerAddress(phone: string, addrId: string, updates: Partial<Omit<CustomerAddress, "id">>): Promise<Customer | undefined> {
    const mongoose = await import("mongoose");
    const isObjectId = mongoose.Types.ObjectId.isValid(addrId) && /^[a-f\d]{24}$/i.test(addrId);

    if (isObjectId) {
      const setFields: Record<string, any> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(updates)) {
        setFields[`addresses.$.${k}`] = v;
      }
      const doc = await CustomerDbModel.findOneAndUpdate(
        { phone, "addresses._id": new mongoose.Types.ObjectId(addrId) },
        { $set: setFields },
        { new: true }
      ).lean();
      return doc ? toCustomer(doc) : undefined;
    }

    // Composite key fallback for legacy addresses that somehow still lack a real _id
    // (should be rare after the one-time backfill migration). Self-heals by assigning
    // a real _id at the same time, so this ambiguous path is only ever hit once per address.
    const parts = addrId.split("|");
    const [building, area, pincode] = parts;
    const customer = await CustomerDbModel.findOne({ phone }).lean() as any;
    if (!customer) return undefined;
    const matches = (customer.addresses as any[])
      .map((a: any, i: number) => ({ a, i }))
      .filter(({ a }: any) =>
        String(a.building).trim() === String(building).trim() &&
        String(a.area).trim() === String(area).trim() &&
        (!pincode || String(a.pincode).trim() === String(pincode).trim())
      );
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      console.warn(
        `[updateCustomerAddress] Ambiguous composite match for phone=${phone}: ${matches.length} addresses share building/area/pincode. Updating the first match; consider backfilling _id for this customer.`
      );
    }
    const addrIndex = matches[0].i;
    const setByIndex: Record<string, any> = { updatedAt: new Date() };
    if (!matches[0].a._id) {
      setByIndex[`addresses.${addrIndex}._id`] = new mongoose.Types.ObjectId();
    }
    for (const [k, v] of Object.entries(updates)) {
      setByIndex[`addresses.${addrIndex}.${k}`] = v;
    }
    const doc = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $set: setByIndex },
      { new: true }
    ).lean();
    return doc ? toCustomer(doc) : undefined;
  }

  async deleteCustomerAddress(phone: string, addrId: string): Promise<Customer | undefined> {
    const mongoose = await import("mongoose");
    const isObjectId = mongoose.Types.ObjectId.isValid(addrId) && /^[a-f\d]{24}$/i.test(addrId);

    if (isObjectId) {
      const doc = await CustomerDbModel.findOneAndUpdate(
        { phone },
        { $pull: { addresses: { _id: new mongoose.Types.ObjectId(addrId) } }, $set: { updatedAt: new Date() } },
        { new: true }
      ).lean();
      return doc ? toCustomer(doc) : undefined;
    }

    // Composite key fallback for legacy addresses that somehow still lack a real _id
    // (should be rare after the one-time backfill migration). Resolves to a single
    // array index in-memory (same disambiguation as updateCustomerAddress) instead of
    // a broad $pull match, so it can never silently delete the wrong or multiple addresses.
    const [building, area, pincode] = addrId.split("|");
    const customer = await CustomerDbModel.findOne({ phone }).lean() as any;
    if (!customer) return undefined;
    const matches = (customer.addresses as any[])
      .map((a: any, i: number) => ({ a, i }))
      .filter(({ a }: any) =>
        String(a.building).trim() === String(building).trim() &&
        String(a.area).trim() === String(area).trim() &&
        (!pincode || String(a.pincode).trim() === String(pincode).trim())
      );
    if (matches.length === 0) return undefined;
    if (matches.length > 1) {
      console.warn(
        `[deleteCustomerAddress] Ambiguous composite match for phone=${phone}: ${matches.length} addresses share building/area/pincode. Deleting only the first match.`
      );
    }
    const addrIndex = matches[0].i;
    const doc = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $unset: { [`addresses.${addrIndex}`]: 1 }, $set: { updatedAt: new Date() } },
      { new: true }
    ).lean();
    if (!doc) return undefined;
    // $unset on an array index leaves a `null` hole; pull it out in a second step.
    const cleaned = await CustomerDbModel.findOneAndUpdate(
      { phone },
      { $pull: { addresses: null as any } },
      { new: true }
    ).lean();
    return cleaned ? toCustomer(cleaned) : toCustomer(doc);
  }

  async getAllCustomers(): Promise<Customer[]> {
    const docs = await CustomerDbModel.find().sort({ createdAt: -1 }).lean();
    return docs.map(toCustomer);
  }

  async pushOrderToCustomer(phone: string, order: Omit<EmbeddedOrder, "updatedAt">): Promise<void> {
    try {
      const embeddedOrder = { ...order, updatedAt: new Date() };
      await CustomerDbModel.findOneAndUpdate(
        { phone },
        {
          $push: { orders: embeddedOrder },
          $set: { updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date(), addresses: [] },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error("Failed to push order to customer document:", err);
    }
  }

  async updateCustomerOrderStatus(phone: string, orderId: string, status: string): Promise<void> {
    try {
      await CustomerDbModel.findOneAndUpdate(
        { phone, "orders.orderId": orderId },
        {
          $set: {
            "orders.$.status": status,
            "orders.$.updatedAt": new Date(),
            updatedAt: new Date(),
          },
        }
      );
    } catch (err) {
      console.error("Failed to update customer order status:", err);
    }
  }
}

export const storage = new MongoStorage();

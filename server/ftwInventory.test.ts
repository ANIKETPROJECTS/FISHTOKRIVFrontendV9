import assert from "node:assert/strict";
import test from "node:test";
import { isFtwUpiPayload, reserveFtwInventory, restoreFtwInventory, FtwInventoryError } from "./ftwInventory.ts";

class FakeQuery<T> {
  constructor(private readonly value: T) {}
  session() { return this; }
  lean() { return Promise.resolve(this.value); }
}

function matches(document: any, filter: any): boolean {
  if (filter._id !== undefined && String(document._id) !== String(filter._id)) return false;
  if (filter.type !== undefined && document.type !== filter.type) return false;
  if (filter.reservationId !== undefined && document.reservationId !== filter.reservationId) return false;
  if (filter.productId !== undefined && String(document.productId) !== String(filter.productId)) return false;
  if (filter.quantity !== undefined && document.quantity !== filter.quantity) return false;
  if (filter.batches !== undefined && JSON.stringify(document.batches ?? []) !== JSON.stringify(filter.batches)) return false;
  if (filter.name?.$regex) {
    const expression = new RegExp(filter.name.$regex, filter.name.$options);
    if (!expression.test(String(document.name ?? ""))) return false;
  }
  if (filter.$or && !filter.$or.some((candidate: any) => matches(document, candidate))) return false;
  return true;
}

function makeHub(options: { product?: any; combo?: any } = {}) {
  const products = [structuredClone(options.product ?? {
    _id: "p1",
    name: "Prawns",
    unit: "kg",
    quantity: 5,
    batches: [
      { _id: "b1", batchNumber: "OLD", quantity: 2, expiryDate: null },
      { _id: "b2", batchNumber: "NEW", quantity: 3, expiryDate: null },
    ],
  })];
  const movements: any[] = [];
  const collection = {
    findOne: async (filter: any) => {
      const product = products.find((candidate) => matches(candidate, filter));
      if (product) return structuredClone(product);
      const expectedName = filter.name?.$regex;
      if (expectedName) {
        const expression = new RegExp(expectedName, filter.name.$options);
        return structuredClone(products.find((candidate) => expression.test(candidate.name)));
      }
      return null;
    },
    updateOne: async (filter: any, update: any) => {
      const index = products.findIndex((candidate) => matches(candidate, filter));
      if (index < 0) return { matchedCount: 0 };
      products[index] = {
        ...products[index],
        ...(update.$set ?? {}),
      };
      return { matchedCount: 1 };
    },
  };
  const movementModel = {
    find: (filter: any) => new FakeQuery(movements.filter((movement) => matches(movement, filter)).map((movement) => structuredClone(movement))),
    findOne: (filter: any) => new FakeQuery(structuredClone(movements.find((movement) => matches(movement, filter)) ?? null)),
    updateOne: async (filter: any, update: any) => {
      const existing = movements.find((movement) => matches(movement, filter));
      if (!existing && update.$setOnInsert) movements.push(structuredClone(update.$setOnInsert));
      return { matchedCount: existing ? 1 : 0, upsertedCount: existing ? 0 : 1 };
    },
    updateMany: async (filter: any, update: any) => {
      for (const movement of movements.filter((candidate) => matches(candidate, filter))) {
        Object.assign(movement, update.$set ?? {});
      }
      return { matchedCount: 1 };
    },
  };
  const hub: any = {
    Product: {
      collection,
      db: {
        startSession: async () => ({
          withTransaction: async () => {
            throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
          },
          endSession: async () => {},
        }),
      },
    },
    Combo: {
      findOne: (filter: any) => {
        const value = filter._id === options.combo?._id ? structuredClone(options.combo) : null;
        return new FakeQuery(value);
      },
    },
    InventoryMovement: movementModel,
    __products: products,
    __movements: movements,
  };
  return hub;
}

test("reserves FIFO batches and is idempotent for the same payment operation", async () => {
  const hub = makeHub();
  const first = await reserveFtwInventory({
    hub,
    operationId: "rzp_fifo",
    hubDbName: "thane",
    items: [{ productId: "p1", quantity: 3, name: "Prawns" }],
  });

  assert.equal(first.status, "deducted");
  assert.deepEqual(first.allocations[0].batchAllocations, [
    { batchId: "b1", batchNumber: "OLD", quantity: 2 },
    { batchId: "b2", batchNumber: "NEW", quantity: 1 },
  ]);
  assert.equal(hub.__products[0].quantity, 2);
  assert.equal(hub.__movements.filter((movement: any) => movement.type === "order_deduct").length, 1);

  await reserveFtwInventory({
    hub,
    operationId: "rzp_fifo",
    hubDbName: "thane",
    items: [{ productId: "p1", quantity: 3, name: "Prawns" }],
  });
  assert.equal(hub.__products[0].quantity, 2);
  assert.equal(hub.__movements.filter((movement: any) => movement.type === "order_deduct").length, 1);
});

test("expands combos and restores exactly once", async () => {
  const hub = makeHub({
    product: {
      _id: "p1",
      name: "Prawns",
      quantity: 4,
      batches: [{ _id: "b1", batchNumber: "ONLY", quantity: 4, expiryDate: null }],
    },
    combo: {
      _id: "combo1",
      includes: [{ productId: "p1", quantity: 2, label: "Prawns" }],
    },
  });

  await reserveFtwInventory({
    hub,
    operationId: "rzp_combo",
    hubDbName: "thane",
    items: [{ productId: "combo1", quantity: 1, name: "Family Combo" }],
  });
  assert.equal(hub.__products[0].quantity, 2);

  const restored = await restoreFtwInventory({
    hub,
    operationId: "rzp_combo",
    reason: "payment_cancelled",
  });
  assert.equal(restored.status, "restored");
  assert.equal(hub.__products[0].quantity, 4);

  const repeated = await restoreFtwInventory({
    hub,
    operationId: "rzp_combo",
    reason: "payment_cancelled",
  });
  assert.equal(repeated.status, "restored");
  assert.equal(hub.__products[0].quantity, 4);
  assert.equal(hub.__movements.filter((movement: any) => movement.type === "order_restore").length, 1);
});

test("concurrent reservations cannot oversell the same batch", async () => {
  const hub = makeHub({
    product: {
      _id: "p1",
      name: "Prawns",
      quantity: 2,
      batches: [{ _id: "b1", batchNumber: "ONLY", quantity: 2, expiryDate: null }],
    },
  });

  const results = await Promise.allSettled([
    reserveFtwInventory({ hub, operationId: "rzp_a", hubDbName: "thane", items: [{ productId: "p1", quantity: 2 }] }),
    reserveFtwInventory({ hub, operationId: "rzp_b", hubDbName: "thane", items: [{ productId: "p1", quantity: 2 }] }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected" && result.reason instanceof FtwInventoryError).length, 1);
  assert.equal(hub.__products[0].quantity, 0);
});

test("FTW detection is isolated from non-UPI and non-online orders", () => {
  assert.equal(isFtwUpiPayload({ source: "online", paymentMode: "upi", hubDbName: "thane", items: [{ productId: "p1", quantity: 1 }] }), true);
  assert.equal(isFtwUpiPayload({ source: "online", paymentMode: "cash", hubDbName: "thane", items: [{ productId: "p1", quantity: 1 }] }), false);
  assert.equal(isFtwUpiPayload({ source: "pos", paymentMode: "upi", hubDbName: "thane", items: [{ productId: "p1", quantity: 1 }] }), false);
});
import test from "node:test";
import assert from "node:assert/strict";
import { isCustomerOrderVisible } from "../shared/customerOrderVisibility";
import { buildCustomerOrdersQuery } from "./customerOrderQuery";

test("customer order visibility hides only orders explicitly marked deleted", () => {
  const orders = [
    { id: "deleted", isDeleted: true },
    { id: "active", isDeleted: false },
    { id: "legacy" },
  ];

  assert.deepEqual(
    orders.filter(isCustomerOrderVisible).map(order => order.id),
    ["active", "legacy"],
  );
});

test("customer order query retains account scoping and excludes soft-deleted records", () => {
  assert.deepEqual(buildCustomerOrdersQuery("5550100", "customer-123"), {
    $or: [{ phone: "5550100" }, { customerId: "customer-123" }],
    isDeleted: { $ne: true },
  });
});

test("customer order query falls back to the login phone and includes legacy records", () => {
  assert.deepEqual(buildCustomerOrdersQuery("5550100"), {
    phone: "5550100",
    isDeleted: { $ne: true },
  });
});

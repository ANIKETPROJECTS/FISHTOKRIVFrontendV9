import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSuccessfulRazorpayPaymentState,
  isFtwStorefrontOrder,
  isSuccessfulRazorpayStatus,
} from "./razorpayPayment";

test("successful Razorpay payments are fully paid for every delivery date/slot", () => {
  const cases = [
    ["today", "current slot"],
    ["tomorrow", "next-day slot"],
    ["later", "current slot"],
    ["later", "next-day slot"],
    ["today", "instant slot"],
  ];

  for (const [deliveryDate, slot] of cases) {
    const state = buildSuccessfulRazorpayPaymentState({
      total: 1249,
      paymentAmount: 1249,
      paymentId: `pay_${deliveryDate}_${slot.replace(/\W/g, "_")}`,
    });

    assert.equal(state.paymentStatus, "paid", `${deliveryDate}/${slot}`);
    assert.equal(state.paidAmount, 1249);
    assert.equal(state.dueAmount, 0);
    assert.equal(state.upiVariant, "RZPAY");
    assert.equal(state.payments.length, 1);
  }
});

test("wallet plus Razorpay payment remains fully paid", () => {
  const state = buildSuccessfulRazorpayPaymentState({
    total: 1249,
    paymentAmount: 1000,
    paymentId: "pay_remainder",
    existingPayments: [
      { mode: "wallet", amount: 249, reference: "" },
    ],
  });

  assert.equal(state.paymentStatus, "paid");
  assert.equal(state.paidAmount, 1249);
  assert.equal(state.dueAmount, 0);
  assert.deepEqual(
    state.payments.map(({ mode, amount, reference }) => ({ mode, amount, reference })),
    [
      { mode: "wallet", amount: 249, reference: "" },
      { mode: "upi", amount: 1000, reference: "pay_remainder" },
    ],
  );
});

test("failed, cancelled, and pending Razorpay statuses are not successful", () => {
  for (const status of ["failed", "cancelled", "created", "authorized_pending"]) {
    assert.equal(isSuccessfulRazorpayStatus(status), false, status);
  }
  assert.equal(isSuccessfulRazorpayStatus("captured"), true);
  assert.equal(isSuccessfulRazorpayStatus("authorized"), true);
});

test("callback retry replaces the existing UPI entry instead of duplicating it", () => {
  const first = buildSuccessfulRazorpayPaymentState({
    total: 500,
    paymentAmount: 500,
    paymentId: "pay_same",
  });
  const retried = buildSuccessfulRazorpayPaymentState({
    total: 500,
    paymentAmount: 500,
    paymentId: "pay_same",
    existingPayments: first.payments,
  });

  assert.equal(retried.payments.filter((p) => p.reference === "pay_same").length, 1);
  assert.equal(retried.paidAmount, 500);
  assert.equal(retried.dueAmount, 0);
});

test("FTW IDs and pre-ID online Razorpay orders are storefront orders", () => {
  assert.equal(isFtwStorefrontOrder({ orderId: "#FTW202608051", source: "online" }), true);
  assert.equal(
    isFtwStorefrontOrder({ source: "online", razorpayOrderId: "order_123" }),
    true,
  );
  assert.equal(isFtwStorefrontOrder({ orderId: "#FTS202608051", source: "admin" }), false);
});
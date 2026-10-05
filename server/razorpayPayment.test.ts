import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFailedRazorpayPaymentState,
  buildSuccessfulRazorpayPaymentState,
  isRazorpayBackgroundGraceExpired,
  isFtwStorefrontOrder,
  isRazorpayHeartbeatStale,
  isRazorpayOrderPaymentComplete,
  isRazorpayPaymentInProgress,
  isSuccessfulRazorpayStatus,
  shouldDeferRazorpayFailure,
  shouldValidatePrePaymentGuards,
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

    assert.equal(state.paymentStatus, "completed", `${deliveryDate}/${slot}`);
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

  assert.equal(state.paymentStatus, "completed");
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

test("only captured Razorpay payments are successful", () => {
  for (const status of ["failed", "cancelled", "created", "authorized_pending", "authorized", "refunded"]) {
    assert.equal(isSuccessfulRazorpayStatus(status), false, status);
  }
  assert.equal(isSuccessfulRazorpayStatus("captured"), true);
});

test("an order is finalized only after its saved payment status is complete", () => {
  assert.equal(isRazorpayOrderPaymentComplete("completed"), true);
  assert.equal(isRazorpayOrderPaymentComplete("paid"), true);
  for (const status of ["pending", "failed", "unpaid", "partial", null, undefined]) {
    assert.equal(isRazorpayOrderPaymentComplete(status), false, String(status));
  }
});

test("failed Razorpay payments remain recorded without changing paid totals", () => {
  const state = buildFailedRazorpayPaymentState({
    paymentAmount: 1000,
    paymentId: "pay_failed",
    existingPayments: [
      { mode: "wallet", amount: 249, reference: "" },
      { mode: "upi", amount: 1000, reference: "" },
    ],
  });

  assert.equal(state.paymentStatus, "failed");
  assert.equal(state.upiTransactionId, "pay_failed");
  assert.deepEqual(state.payments, [
    { mode: "wallet", amount: 249, reference: "" },
    { mode: "upi", amount: 1000, reference: "pay_failed", status: "failed" },
  ]);
  assert.equal("paidAmount" in state, false);
  assert.equal("dueAmount" in state, false);
});

test("cancelled and failed attempts are not treated as in-progress payments", () => {
  for (const status of ["created", "failed", "cancelled", "captured", "refunded"]) {
    assert.equal(isRazorpayPaymentInProgress(status), false, status);
  }
  for (const status of ["authorized", "authorized_pending", "pending", "processing"]) {
    assert.equal(isRazorpayPaymentInProgress(status), true, status);
  }
});

test("explicit checkout abandonment fails immediately even if Razorpay reports an in-progress attempt", () => {
  assert.equal(shouldDeferRazorpayFailure(true, false), true);
  assert.equal(shouldDeferRazorpayFailure(true, true), false);
  assert.equal(shouldDeferRazorpayFailure(false, false), false);
});

test("backgrounded checkouts get a grace period before heartbeat recovery marks them failed", () => {
  const backgroundedAt = new Date(100_000);
  assert.equal(isRazorpayBackgroundGraceExpired({
    backgroundedAt,
    nowMs: 100_000 + 14 * 60_000,
    graceMs: 15 * 60_000,
  }), false);
  assert.equal(isRazorpayBackgroundGraceExpired({
    backgroundedAt,
    nowMs: 100_000 + 15 * 60_000,
    graceMs: 15 * 60_000,
  }), true);
  assert.equal(isRazorpayBackgroundGraceExpired({
    backgroundedAt: null,
    nowMs: 100_000,
    graceMs: 15 * 60_000,
  }), true);
});

test("checkout heartbeat expiry uses the last heartbeat, falling back to checkout creation", () => {
  assert.equal(isRazorpayHeartbeatStale({
    lastHeartbeatAt: new Date(95_000),
    createdAt: new Date(0),
    nowMs: 100_000,
    staleAfterMs: 10_000,
  }), false);
  assert.equal(isRazorpayHeartbeatStale({
    lastHeartbeatAt: new Date(80_000),
    createdAt: new Date(0),
    nowMs: 100_000,
    staleAfterMs: 10_000,
  }), true);
  assert.equal(isRazorpayHeartbeatStale({
    lastHeartbeatAt: null,
    createdAt: new Date(80_000),
    nowMs: 100_000,
    staleAfterMs: 10_000,
  }), true);
});

test("pre-payment guards stop re-running after verified capture", () => {
  assert.equal(shouldValidatePrePaymentGuards(false), true);
  assert.equal(shouldValidatePrePaymentGuards(true), false);
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
export type RazorpayPaymentEntry = {
  mode: string;
  amount: number;
  reference?: string;
  paidAt?: Date | string;
};

type SuccessfulPaymentStateInput = {
  total: number;
  paymentAmount: number;
  paymentId: string;
  existingPayments?: RazorpayPaymentEntry[] | null;
  paidAt?: Date;
};

/**
 * Builds the canonical payment fields for a verified Razorpay payment.
 *
 * Wallet payments are retained because Razorpay only charges the remainder.
 * Any existing UPI entry is replaced, making callback/webhook retries
 * idempotent instead of appending duplicate payment records.
 */
export function buildSuccessfulRazorpayPaymentState({
  total,
  paymentAmount,
  paymentId,
  existingPayments = [],
  paidAt = new Date(),
}: SuccessfulPaymentStateInput) {
  const walletPayments = (existingPayments ?? []).filter(
    (payment) => payment.mode === "wallet",
  );
  const paidAmount =
    walletPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0) +
    paymentAmount;
  const normalizedTotal = Math.max(0, Number(total || 0));

  return {
    source: "online",
    paymentMode: "upi",
    upiVariant: "RZPAY",
    paymentStatus: "paid",
    payments: [
      ...walletPayments,
      {
        mode: "upi",
        amount: paymentAmount,
        reference: paymentId,
        paidAt,
      },
    ],
    paidAmount: normalizedTotal,
    dueAmount: 0,
    upiTransactionId: paymentId,
  };
}

export function isSuccessfulRazorpayStatus(status: unknown): boolean {
  return status === "captured" || status === "authorized";
}

/**
 * FTW IDs are assigned after the order document is inserted. Before that
 * point, an online order with a Razorpay order ID is the same storefront
 * order and must be eligible for webhook repair.
 */
export function isFtwStorefrontOrder(order: {
  orderId?: unknown;
  source?: unknown;
  razorpayOrderId?: unknown;
}): boolean {
  return (
    /^#?FTW/i.test(String(order.orderId ?? "")) ||
    (!order.orderId &&
      order.source === "online" &&
      Boolean(order.razorpayOrderId))
  );
}
---
name: Razorpay webhook safety net
description: How the payment.captured webhook recovers orders lost when the browser closes after payment but before the client handler fires.
---

## The problem
Client-side Razorpay handler (`options.handler`) calls `/api/orders` to create the FishTokri order. If the browser closes after Razorpay captures the payment but before that call completes, money is taken but no order is created.

## The fix (implemented)

The storefront must treat a verified successful Razorpay result as the only authority for FTW payment state. Delivery date, schedule type, and timeslot do not affect this decision.

### Pending checkout store
- When `/api/razorpay/create-order` is called, the server saves the full pre-payment order payload (everything except `razorpayPaymentId`) to a `PendingCheckout` MongoDB collection on the `orders` DB.
- TTL: 24 hours (matches Razorpay's webhook retry window).
- Keyed by `razorpayOrderId` (the Razorpay `order_id`).

### Webhook endpoint
`POST /api/webhooks/razorpay`
- Verifies `X-Razorpay-Signature` header via HMAC-SHA256 using `RAZORPAY_WEBHOOK_SECRET` and `req.rawBody` (captured by `express.json`'s verify callback in `server/index.ts`).
- Handles `payment.captured` event only; all others return 200 immediately.
- Idempotency: checks `OrderModel` for existing `razorpayOrderId` or `payments.reference` before proceeding; an existing FTW document is repaired rather than returned with stale unpaid metadata.
- Fetches `PendingCheckout` by `razorpayOrderId`, merges actual payment details, then calls `http://localhost:${PORT}/api/orders` internally — reuses all inventory deduction, coupon, and WhatsApp logic.
- Always returns 200 to prevent Razorpay retries on non-transient errors.

### Order schema
`razorpayOrderId` field added to `orderSchema` in `server/ordersDb.ts` and to `insertOrderRequestSchema` / `InsertOrderRequest` in `shared/schema.ts`.

### Payment invariant
- The server confirms the Razorpay payment ID belongs to the submitted Razorpay order and has a successful status before creating or repairing an order.
- Verified FTW + Razorpay state uses `paymentStatus: "paid"`, `dueAmount: 0`, `upiVariant: "RZPAY"`, the canonical `upiTransactionId`, and one idempotent UPI payment entry.
- Callback retries replace the existing UPI entry rather than appending duplicates.

### Client changes (`CartDrawer.tsx`)
- Calls `buildOrderPayload(selected)` (no paymentId) before the Razorpay modal, sends result as `orderPayload` alongside `amount` to `/api/razorpay/create-order`.
- Both `createOrder` call sites (modal handler + UPI-resume visibilitychange) now spread `razorpayOrderId: order_id` (or `razorpayOrderId: orderId`) into the payload for deduplication.

## Setup required
1. Razorpay Dashboard → Settings → Webhooks → add URL: `https://<domain>/api/webhooks/razorpay`
2. Select event: `payment.captured`
3. Copy webhook secret → set as `RAZORPAY_WEBHOOK_SECRET` env var.

**Why:**
Without this, any browser/network interruption after payment success silently loses the order. Razorpay retries webhooks for 24 hours, so a server restart during that window will still recover the order.

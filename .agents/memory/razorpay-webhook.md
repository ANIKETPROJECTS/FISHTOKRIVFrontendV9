---
name: Razorpay payment finalization
description: Safe browser, webhook, and reconciliation recovery for captured Razorpay checkouts.
---

## Payment invariant

Only a server-verified Razorpay payment with `status: "captured"` counts as paid. Confirm the payment belongs to the submitted Razorpay order and that its captured amount/currency match the persisted checkout before creating or repairing an order. `authorized` is not captured.

## Recovery and idempotency

- Persist the complete checkout payload and expected Razorpay amount before returning the payment order to the browser. Fail closed if that recovery record cannot be saved.
- Browser callbacks, signed `payment.captured` webhooks, and production reconciliation must use the same finalizer.
- Serialize finalization with a database lease. Look up by Razorpay order/payment reference first and repair an existing FTW order instead of creating another.
- The pending-checkout record has a 24-hour TTL, aligned with Razorpay's webhook retry window. The production reconciliation loop retries eligible captured payments after missed callbacks/webhooks.
- Client retries may repeat finalization safely; the Razorpay order ID is unique on storefront orders.

## Inventory and payment recovery

Normal order creation deducts hub inventory atomically and journals each deduction so it can be rolled back if persistence fails. A captured payment must not be discarded because stock became unavailable after checkout: persist the paid storefront order without a stock deduction and flag it for Admin inventory review.

**Why:** Payment capture is irreversible from the storefront's perspective, while inventory can change between checkout and webhook delivery. Silently rejecting the paid order loses fulfillment visibility; deducting unavailable stock is also incorrect.

**How to apply:** Keep payment finalization independent of mutable slot, preorder, coupon-use, and delivery-charge checks. Preserve normal inventory checks for unpaid orders; use the explicit review state only for verified paid recovery.

## Historical checkout safety

Only pending checkouts explicitly marked eligible by the new checkout flow may be auto-reconciled. Legacy records without that marker require manual review, even when Razorpay confirms capture. Existing FTW orders may be repaired, but an absent order must not be auto-created for a legacy record.

**Why:** A historical captured checkout was followed by a manual FTS order for the same basket and amount. Automatic backfill could cause duplicate fulfillment.

**How to apply:** Before any production backfill of a legacy payment, inspect Admin orders for a manual replacement and get operator confirmation. Do not mutate production order data during code verification.

## Webhook setup

`POST /api/webhooks/razorpay` verifies `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET` and the raw request body, and processes only `payment.captured`. Return retryable 5xx responses for transient finalization failures; acknowledge unrelated events and manual-review cases.

In Razorpay Dashboard → Settings → Webhooks, configure the published URL ending in `/api/webhooks/razorpay`, select `payment.captured`, and store the webhook secret in Replit Secrets.
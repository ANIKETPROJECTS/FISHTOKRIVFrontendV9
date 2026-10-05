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

## Inventory ownership and payment recovery

The Admin panel owns inventory deduction for every storefront order. Storefront order creation must validate stock where safe, never decrement hub stock, and always save `inventoryDeducted: false`. If stock changes after Razorpay capture, persist the paid order and set `inventoryReviewRequired` so Admin can resolve it.

**Why:** Deducting in both the storefront and Admin can reduce stock twice. A captured payment is irreversible from the storefront's perspective, so a late stock shortage must remain visible as an order for Admin review.

**How to apply:** Keep stock checks before payment and for unpaid order creation. Never reject an already captured payment solely because stock changed afterward; persist it for Admin review without changing inventory.

## Historical checkout safety

Only pending checkouts explicitly marked eligible by the new checkout flow may be auto-reconciled. Legacy records without that marker require manual review, even when Razorpay confirms capture. Existing FTW orders may be repaired, but an absent order must not be auto-created for a legacy record.

**Why:** A historical captured checkout was followed by a manual FTS order for the same basket and amount. Automatic backfill could cause duplicate fulfillment.

**How to apply:** Before any production backfill of a legacy payment, inspect Admin orders for a manual replacement and get operator confirmation. Do not mutate production order data during code verification.

## Webhook setup

`POST /api/webhooks/razorpay` verifies `X-Razorpay-Signature` with `RAZORPAY_WEBHOOK_SECRET` and the raw request body, and processes only `payment.captured`. Return retryable 5xx responses for transient finalization failures; acknowledge unrelated events and manual-review cases.

In Razorpay Dashboard → Settings → Webhooks, configure the published URL ending in `/api/webhooks/razorpay`, select `payment.captured`, and store the webhook secret in Replit Secrets.

## Checkout close versus app switching

Keep failed checkouts visible in Admin: mark the existing FTW order failed; do not delete it. Only a server-confirmed capture can change that order to completed, including after it was marked failed.

Browser `beforeunload`/`pagehide` signals are best-effort, not guaranteed when the browser process is force-stopped. Treat `visibilitychange` to hidden as a temporary background/app switch, not abandonment; resume heartbeats when visible. Retain a server watchdog fallback for missing close signals.

**Why:** A shopper may leave the browser to approve a UPI intent, and that must not look like a cancelled checkout. Conversely, a genuine close should update Admin promptly without risking a captured payment.

**How to apply:** Check Razorpay for capture before marking failure. Use document-close signals for immediate abandonment, never hidden visibility alone; preserve the same order for late-capture recovery.
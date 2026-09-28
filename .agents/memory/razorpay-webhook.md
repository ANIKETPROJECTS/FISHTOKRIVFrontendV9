---
name: Razorpay webhook safety net
description: Treat Razorpay's verified server-side state as authoritative when browser payment callbacks are missed.
---

Browser callbacks, visibility events, and unload beacons are best-effort. A customer can pay successfully even when the page never finishes its callback.

**Why:**
Without server-side recovery, a captured payment can be lost when the browser closes, the network drops, or a callback is retried.

**How to apply:**
- Persist the checkout draft before opening payment so a server webhook can recover it.
- Verify webhook signatures and provider-side payment status; never trust a browser's claimed payment result.
- Make callbacks and webhook retries idempotent.
- Check provider state before restoring an unpaid reservation. Unload beacons may report browser closure, but the server-side expiry reconciler remains authoritative.
- Keep pending-checkout retention aligned with the payment provider's retry window and configure webhook secrets through workspace secrets.

For FTW checkout cleanup, use a token-validated heartbeat as a liveness signal, not proof that payment failed. Preserve provider-pending attempts through the reservation TTL and grace period; delete only after unpaid status is established and stock restoration succeeds. Keep a short-lived tombstone so late captures are sent to reconciliation.

**Why:** UPI app handoffs can pause browser JavaScript, and provider payment records can lag a tab close. A fast cleanup must not turn either condition into a lost successful payment.

**How to apply:** Keep heartbeat polling practical (about once per second), allow a brief empty-provider-response grace after a missed heartbeat, back off provider polling, and make finalization able to detect deletion tombstones.

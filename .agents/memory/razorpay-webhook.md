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

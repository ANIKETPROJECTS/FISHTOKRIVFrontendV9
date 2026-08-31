---
name: Same-day slot cutoff
description: The storefront's same-day delivery cutoff must be enforced at payment initiation and order creation.
---

Same-day slots close 30 minutes before their configured start time. The client hides them, but the server must repeat the check in `Asia/Kolkata` because a cart can remain open with stale state and payment callbacks can arrive later.

**Why:** A stale selected slot can otherwise be submitted after the UI has removed it, allowing an order such as 10:00–12:00 to be booked at 10:57.

**How to apply:** Validate the slot before creating the Razorpay payment order and again when creating the final order. Use the India business timezone rather than the server's UTC timezone.
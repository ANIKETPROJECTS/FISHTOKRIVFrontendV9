---
name: FTW inventory reservation boundary
description: Durable rule for keeping FTW UPI inventory reservation separate from legacy storefront order creation.
---

FTW UPI checkout owns its inventory lifecycle from payment initiation through restore or finalization. It must reserve the POS/admin `products.batches` stock before opening Razorpay, write idempotent movement history, and mark the final order as already deducted. The generic order-create inventory path remains for non-FTW flows and must not be used as a fallback for FTW.

**Why:** The live incident showed that stock validation can be correct while an order is still incorrectly stored as delivered. Separating reservation state makes failed payment restoration and admin-worker coordination explicit instead of relying on a late order-side deduction.

**How to apply:** Changes to FTW payment initiation, webhook recovery, modal cancellation, or admin inventory processing must preserve the reservation operation ID and must be safe to retry without a second deduction or restoration.
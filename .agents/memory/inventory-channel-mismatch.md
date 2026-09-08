---
name: Cross-channel inventory mismatch
description: FTS and FTW must share one atomic stock field; external batches and storefront inventoryBatches are not interchangeable.
---

Production evidence for the Baby Surmai incident shows FTS and FTW both used the shared Thane product document and POS-managed `batches`: FTS reduced stock from 2 to 1, then FTW correctly rejected a request for 2. The actual failure was that FTW persisted/left the order as `delivered` after the inventory deduction failed, with no inventory movement and `inventoryDeducted: false`. The current workspace also contains a separate `batches` versus `inventoryBatches` code-path risk, so the running deployment must be matched to source before changing it.

**Why:** An order lifecycle can report success even when stock reservation fails; the customer/order state then disagrees with inventory even though the stock guard worked.

**How to apply:** Make stock reservation a prerequisite for an active order. If deduction fails, do not create/activate the order; if asynchronous processing is retained, keep the order pending and transition it only after successful deduction, with explicit cancellation/refund handling on failure.
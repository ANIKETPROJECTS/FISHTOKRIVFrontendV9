---
name: Cross-channel inventory mismatch
description: FTS and FTW must share one atomic stock field; external batches and storefront inventoryBatches are not interchangeable.
---

FTW currently reads availability from both the POS-managed `batches` array and its own `inventoryBatches` array, but its checkout deduction updates only `inventoryBatches` or the top-level `quantity`. FTS deductions in `batches` are therefore invisible to FTW's atomic guard, and FTW deductions do not appear in the POS inventory history.

**Why:** Separate applications can accept the same last unit when they decrement different fields, especially when orders are punched concurrently.

**How to apply:** Before changing checkout or stock display, identify the canonical shared counter and make both channels use an atomic conditional decrement against it; do not sum independent batch arrays unless they represent distinct stock.
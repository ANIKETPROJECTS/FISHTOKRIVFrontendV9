---
name: Customer order soft-delete visibility
description: Visibility boundary between customer My Orders and admin order management.
---

Customer My Orders must exclude records with `isDeleted === true`; records with `isDeleted: false` or no field remain eligible. Keep admin order lists, phone lookups, Deleted view, and restore/permanent-delete actions unchanged.

**Why:** The user explicitly limited soft-delete filtering to the customer-facing My Orders flow and asked to preserve admin order management.

**How to apply:** Keep the filter in the customer-specific API/storage path. Do not add it to shared admin order queries.

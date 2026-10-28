---
name: Pincode source of truth
description: Which MongoDB collection controls storefront pincode serviceability and delivery charges.
---

Storefront pincodes, delivery charges, and time delays come from the selected hub's
MongoDB `pincodes` collection (for Thane, the Thane database). Do not use embedded
`SubHub.pincodes` records as a fallback or merge source.

**Why:** The admin service-area editor writes to the hub-local collection; embedded
sub-hub data can be stale and hide recently added or edited service areas.

**How to apply:** Read active rows from the selected hub's `pincodes` collection for
the storefront API and authoritative checkout charge calculation.

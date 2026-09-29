---
name: Keep checkout helpers isolated
description: Avoid importing database-connected inventory modules into pure checkout calculations and their tests.
---

Keep checkout availability calculations in a pure module rather than importing them from inventory synchronization code. Importing the sync module's dependency graph can open Mongoose connections and keep standalone Node test processes alive after assertions finish.

**Why:** A focused stock test passed but did not exit when its helper imported database-connected application modules.

**How to apply:** For standalone tests of stock, date, or quantity helpers, keep the helper dependency graph free of database connections, schedulers, and application startup code.
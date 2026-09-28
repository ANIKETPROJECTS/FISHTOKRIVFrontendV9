---
name: FTW cross-database inventory coordination
description: How to prevent payment finalization and stock restoration from racing across the Orders and sub-hub databases.
---

Orders and sub-hub products live in separate MongoDB databases, so one Mongo transaction cannot atomically commit both order lifecycle state and inventory. Use an atomic compare-and-set claim on the Orders record before changing sub-hub stock, then keep product updates, movement history, and the hub operation ledger in one hub transaction. Recover stale claims by checking the payment provider; never restore a confirmed payment. Missing original batches must go to a visible reconciliation queue.

**Why:** A hub transaction alone cannot serialize against a payment webhook or cancellation handler updating the Orders database; either side can otherwise observe stale state and reverse a successful payment.

**How to apply:** Whenever one action spans Orders and a sub-hub database, claim its lifecycle transition in Orders first, perform idempotent inventory work transactionally in the hub, and provide recovery for interrupted claims.
---
name: Production logging and polling
description: Production API access logs must stay concise; live catalog refresh must be opt-in rather than global.
---

Production must not serialize API response bodies into access logs. Query polling should be explicitly enabled only for data that needs freshness, with inactive browser tabs paused.

**Why:** The catalog response is large and global one-second polling also repeatedly requests unauthenticated customer state, creating noisy PM2 logs and unnecessary load.

**How to apply:** Keep production request logging disabled or error-only, and set refresh intervals per live-data query instead of on the shared query client.
---
name: Production hosting
description: Where the live FishTokri storefront is hosted and what that means for shipping code changes.
---

The live `fishtokri.com` storefront is hosted on the user's VPS, not by a Replit deployment.

**Why:** Replit has no deployment or access to the VPS database for this production site, so workspace changes alone cannot change the live storefront or repair its live order records.

**How to apply:** Do not suggest Replit publishing as a way to update `fishtokri.com`. Deploy through the user's existing VPS process, and verify payment recovery against the VPS-connected database.

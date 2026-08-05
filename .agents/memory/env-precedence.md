---
name: Environment precedence
description: Imported ecosystem defaults must remain intact while runtime Replit Secrets override them.
---

Keep values in `ecosystem.config.cjs` for compatibility, but merge runtime environment variables after ecosystem defaults so Replit Secrets win when both define a key.

**Why:** The user needs the imported ecosystem configuration preserved while switching the active development connection to the newly configured secret.

**How to apply:** Do not delete ecosystem entries to change runtime behavior; adjust the launcher merge precedence instead.
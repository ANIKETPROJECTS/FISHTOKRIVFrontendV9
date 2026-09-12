---
name: Production logging policy
description: The runtime logging boundary for the storefront server and PM2 deployment.
---

Production server code must not emit routine request/access, startup, success, polling, scheduler, or database-connection logs. Keep only meaningful error output needed to diagnose failed operations.

**Why:**
PM2 persists stdout/stderr, so normal traffic and scheduler output can create continuous production log volume without improving application behavior.

**How to apply:**
Do not add console.log, console.info, console.debug, or console.warn to runtime server paths. Preserve error handling and meaningful failure reporting; do not reintroduce response-body access logging.
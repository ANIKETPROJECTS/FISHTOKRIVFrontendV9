---
name: Development test payment guard
description: Safety boundary for the local dummy UPI checkout shortcut.
---

The dummy UPI payment action is allowed only for a signed-in customer in a non-production server environment. The browser hides the control from production builds, but the server-side environment and session checks are the authoritative protection.

**Why:** A client-only development flag is not a security boundary; a crafted request could otherwise create an order marked paid without Razorpay verification.

**How to apply:** Keep the request field and UI control development-only, preserve normal checkout validation, and never accept the shortcut when `NODE_ENV` is `production`.
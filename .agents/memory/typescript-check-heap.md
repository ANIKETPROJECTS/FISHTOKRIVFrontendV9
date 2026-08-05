---
name: TypeScript check heap limit
description: The repository-wide TypeScript check can exhaust the available Node heap before emitting diagnostics.
---

The project-wide `tsc` check may run out of memory even when the production build succeeds; treat that as an environment/resource limitation unless a diagnostic is emitted.

**Why:** The current TypeScript graph is large enough to exhaust both the default Node heap and a 4 GB heap in this workspace.

**How to apply:** Prefer `npm run build` for an end-to-end compile verification, and report the heap failure separately rather than treating it as a code error.
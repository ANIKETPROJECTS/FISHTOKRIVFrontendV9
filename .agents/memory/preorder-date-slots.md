---
name: Preorder date-specific slots
description: Preorder checkout uses a calendar date and filters timeslots by each slot's active weekday configuration.
---

Preorder carts default to tomorrow, allow future date selection, and only show active timeslots for the selected weekday. Normal carts retain the Today/Next Day flow.

**Why:** Delivery availability can differ by weekday, so a preorder date must drive the visible slot list instead of relying on one global schedule.

**How to apply:** Preserve preorder intent on cart items added from preorder sections, send the selected `deliveryDate`, and validate the slot's active weekday server-side before creating the order. Keep the cart exclusive: adding one mode removes items from the other mode before adding the new item.
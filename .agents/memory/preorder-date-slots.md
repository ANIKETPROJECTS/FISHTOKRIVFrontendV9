---
name: Preorder date-specific slots
description: Preorder checkout uses a calendar date and filters timeslots by each slot's active weekday configuration.
---

Preorder carts default to the first future date allowed by every cart product and by available timeslots; unavailable dates are disabled. Product schedules support all dates, weekdays, and inclusive date ranges with optional weekday restrictions inside the range. Normal carts retain the Today/Next Day flow.

**Why:** Delivery availability can differ by product as well as weekday, and one order has one delivery date, so the customer must use the intersection of product schedules rather than a free-form date or union. Admin can further restrict a date range to selected weekdays.

**How to apply:** Preserve preorder intent on cart items added from preorder sections, poll product schedules and timeslots while the cart is open so admin changes appear without a page refresh, show each product's friendly availability label, disable dates that fail any product or have no slot, send `orderType: "preorder"` with the selected `deliveryDate`, and validate current product schedules and slot active days server-side. Keep the cart exclusive: adding one mode removes items from the other mode before adding the new item.
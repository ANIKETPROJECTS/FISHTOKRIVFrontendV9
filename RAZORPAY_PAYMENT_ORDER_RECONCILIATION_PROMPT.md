# Prompt: Reconcile Razorpay payments with FishTokri storefront orders

Implement this feature in the existing **FishTokri Admin-panel Replit project**. Do not build a separate app. The goal is to catch storefront orders that were paid through Razorpay but did not appear in the normal Admin Orders list, and safely recover eligible orders.

The Admin project already has a **Razorpay Payments** page and Razorpay credentials. The attached reference screens show:

- An Orders list with customer, items, total, payment method, and order status.
- A Razorpay Payments list with payment ID, bank transaction ID, method, customer, date, amount, payment status, and a View action.

Keep the feature within the existing Admin experience and follow its UI and security conventions.

## Start by understanding the existing systems

Before coding, inspect this project and establish:

1. How the Razorpay Payments page retrieves and paginates transactions, and whether it already verifies payments through Razorpay’s server API.
2. How the Admin app reads and writes normal storefront orders, including the order ID format, order schema, and inventory handling.
3. Whether this app can safely access the storefront’s `orders` database and its `pendingcheckouts` collection, or call an existing authenticated/server-side storefront finalization service.
4. Which identifiers the storefront saves on an order and checkout. Relevant examples may include the Razorpay order ID, Razorpay payment ID, payment reference, and checkout recovery record.
5. How Admin roles, audit logging, background jobs, and environment secrets are handled here.

Do not assume the Admin app has access to the storefront database or recovery service. If it does not, report the missing connection or interface instead of inventing a second order-creation implementation.

## Required behavior

### Detect matches

Reconcile Razorpay transactions with storefront orders using authoritative identifiers, in this order:

1. Exact Razorpay payment ID match against the order’s saved payment reference or transaction ID.
2. Exact Razorpay order ID match against the order’s saved Razorpay order ID.
3. If no order exists, exact Razorpay order ID match against a persisted storefront checkout recovery record.

Only treat a payment as successful when Razorpay confirms its status is **captured**. Confirm the payment belongs to the expected Razorpay order, and verify currency and amount against the saved checkout. Account for wallet payments when comparing the Razorpay amount to the full order total.

Do **not** automatically link or create orders based only on matching amount, customer name, phone, email, or approximate time. These may help an Admin investigate, but are not proof that a payment belongs to an order. Many Razorpay payments may be unrelated to storefront orders.

### Repair only high-confidence, eligible checkouts

An automatic repair is allowed only when all of these conditions are true:

- Razorpay independently confirms the payment is captured.
- The payment is linked to a specific storefront Razorpay order using an exact identifier.
- A durable checkout recovery record contains the original order details and expected payment amount.
- The checkout is explicitly eligible for automatic recovery.
- The captured amount and currency match that record.
- No matching normal order already exists.
- The payment has not been refunded or partially refunded.

If the order already exists, repair its missing or incomplete payment/order-number fields instead of creating another order. A retry must never create a second normal order for the same Razorpay order ID or payment.

Prefer calling the storefront’s existing finalization service so order validation, FTW order numbering, and inventory behavior remain consistent. Do not write directly from browser code to the orders database, and do not create a partial order by copying only Razorpay transaction fields.

If the recovery record is missing, expired, marked ineligible, or inconsistent—or if more than one order/payment is a possible match—show the transaction as **Needs review**. Do not guess at cart items, address, delivery slot, or customer details. A human may resolve it through an audited Admin action if the required data is available.

Do not automatically backfill a known historical payment when a manual replacement order may already exist. Show it for review and require an Admin to confirm before any order is created.

### Keep inventory and refunds safe

Use the storefront’s established inventory deduction logic when creating an order. If inventory is unavailable after a confirmed capture, do not deduct negative stock or discard the paid order. Follow the storefront’s paid-order inventory-review process, if available; otherwise leave the transaction in **Needs review** with a clear reason.

Do not automatically create or fulfill an order for a fully or partially refunded payment. Mark it for review. If multiple captured payments appear to belong to one checkout, do not create multiple orders; flag the extra payment for review.

## Reconciliation process

- Run reconciliation server-side, not in the browser.
- Prefer a verified Razorpay webhook for prompt updates, plus a scheduled reconciliation fallback and the existing **Refresh** action.
- Make the scheduled scan incremental, paginated, rate-limit-aware, and safe to repeat. Track its last successful position/time and use a small overlap so brief outages do not skip payments.
- Reconcile frequently enough to find failed orders while their checkout recovery record still exists. The storefront may expire these records after about 24 hours; do not silently extend retention of full customer/order payloads. Payments whose recovery data has expired should go to manual review.
- Use a database lock or equivalent serialization for each checkout so concurrent webhook, scheduled, and manual retries cannot create duplicates.
- Record an audit trail for detection and repairs: payment ID, Razorpay order ID, outcome, reason, time, and Admin actor for manual actions. Avoid logging secrets or unnecessary customer/payment data.
- Keep Razorpay credentials exclusively on the server in the project’s secrets/environment system. Never send or render credentials in frontend code, browser responses, or logs.
- Require the existing appropriate Admin role for any action that creates or repairs an order.

## Admin UI

Extend the existing Razorpay Payments page rather than replacing it. Keep payment transactions read-only; the repair action should create or repair a FishTokri order, not alter the Razorpay transaction.

Show an understandable reconciliation state for each relevant transaction, such as:

- **Matched** — linked to a normal storefront order, with its FTW order number.
- **Repairable** — an exact, verified, eligible checkout exists and no normal order is present.
- **Needs review** — missing recovery data, conflicting matches, amount/currency mismatch, refund, duplicate payment, or another reason requiring an Admin.
- **Unrelated** — no authoritative storefront association was found; do not treat it as an error or create an order.

For each row, show the payment ID, Razorpay order ID when available, captured/refunded status, amount and currency, date, masked customer details, matched FTW order number if any, and a concise reason for its state. Clearly distinguish the current page/filter’s loaded transactions from the full account-wide reconciliation status.

High-confidence eligible payments may be repaired automatically by the server. Also provide a **Repair order** action for an Admin to retry an eligible failed repair. Before any manual repair, show which checkout/order data will be used and require confirmation. Show success with the created/repaired FTW order number; show failures with a safe, useful reason and retry guidance.

## Verification and acceptance criteria

Add tests using mocked Razorpay responses and isolated test data. Do not make live charges or mutate production records during development.

Verify at least:

- A captured payment with an eligible, exact-match recovery record creates one normal Admin-visible FTW order.
- Re-running the same repair, or running webhook and reconciliation concurrently, still leaves exactly one order.
- An existing matching order is repaired rather than duplicated.
- An authorized-but-not-captured payment does not create a paid order.
- An unrelated captured payment, including one with the same amount or customer as an order, is not auto-linked.
- Amount/currency mismatches, refunded payments, ambiguous matches, and missing/expired/ineligible recovery records do not auto-create orders.
- Inventory unavailability follows the storefront’s paid-order review behavior or results in a clear manual-review state.
- Credentials are never exposed to the browser or written to logs.

Before finishing, report the data source and exact matching rules implemented, how the scheduled/webhook flow is triggered, test results, and any access or configuration required from the storefront project. If the Admin app cannot safely create a normal storefront order with the existing data and services, stop at detection/manual review and explain what integration is needed rather than guessing or writing an incompatible order.
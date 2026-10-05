# FishTokri UPI order lifecycle

## Before Razorpay opens

When a customer starts a UPI checkout, the server creates the Razorpay order and stores its recovery payload. Before returning the Razorpay order details to the browser, it also creates the FishTokri Order document with:

- A FishTokri order number and the Razorpay order ID.
- `paymentStatus: "pending"`.
- The expected UPI amount and checkout details.
- `inventoryDeducted: false`; inventory remains under the Admin panel's control.

The provisional order is visible in Admin Orders as **Awaiting UPI payment**. Its status controls are disabled until payment is completed. It does not yet trigger order-confirmation messages, coupon or delivery-slot updates, or wallet deductions.

## After a successful payment

Only a server-verified Razorpay payment with status `captured` is treated as successful. The existing Order document is updated in place to `paymentStatus: "completed"`. The server records the Razorpay payment ID as `upiTransactionId`, keeps the Razorpay order ID, replaces the provisional UPI payment entry with the verified transaction and timestamp, and updates paid/due amounts.

Customer-order synchronization, coupon usage, delivery-slot counts, wallet deduction, and the order-confirmation message run as part of the successful finalization. Finalization remains idempotent, so a browser callback, UPI-return poll, webhook, or reconciliation retry cannot create duplicate orders or repeat those side effects.

## Cancellation, failure, and force-closing the browser

When Razorpay reports a payment failure or the customer closes the payment window, the browser asks the server to check Razorpay's payment records. If no payment is captured or still in progress, the server deletes only the matching provisional Order document. A failed payment closes the current payment window so a retry starts with a fresh provisional order. The recovery record remains temporarily so a delayed captured-payment webhook can still restore the order.

If the browser or tab is force-closed, it cannot send that cancellation request. MongoDB therefore expires an unpaid provisional order after one hour. The separate payment-recovery record is retained for its existing 24-hour recovery window. If a payment is captured during that window, the webhook or reconciliation process can create or finalize the order again.

COD and wallet-only checkouts are unchanged.

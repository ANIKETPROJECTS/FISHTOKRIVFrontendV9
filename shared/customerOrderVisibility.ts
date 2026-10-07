export function isCustomerOrderVisible(order: { isDeleted?: boolean }): boolean {
  return order.isDeleted !== true;
}

export function buildCustomerOrdersQuery(phone: string, customerId?: string | null) {
  const ownershipScope = customerId
    ? { $or: [{ phone }, { customerId }] }
    : { phone };

  return {
    ...ownershipScope,
    isDeleted: { $ne: true },
  };
}

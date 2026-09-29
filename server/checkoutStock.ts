export interface CheckoutStockLine {
  productId: string;
  quantity: number;
  name?: string;
}

export interface CheckoutStockIssue {
  productId: string;
  name: string;
  requested: number;
  available: number;
}

function computeExpiryDate(entryDate: Date, shelfLifeDays: number): Date {
  return new Date(new Date(entryDate).getTime() + shelfLifeDays * 24 * 60 * 60 * 1000);
}

export function getCheckoutAvailableQuantity(
  product: any,
  now = new Date(),
): number {
  if (!product || product.isArchived || product.status === "unavailable") return 0;

  const batches: any[] = Array.isArray(product.inventoryBatches)
    ? product.inventoryBatches
    : [];

  // Order creation deducts from inventoryBatches when present, otherwise from
  // the top-level quantity. Do not count the separate POS `batches` field here.
  if (batches.length === 0) {
    const quantity = Number(product.quantity ?? 0);
    return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
  }

  return batches.reduce((total, batch) => {
    if (batch.remainingTime === "expired") return total;
    const expiryDate = batch.expiryDate
      ? new Date(batch.expiryDate)
      : computeExpiryDate(new Date(batch.entryDate), Number(batch.shelfLifeDays ?? 0));
    if (!(expiryDate > now)) return total;

    const quantity = Number(batch.quantity ?? 0);
    return total + (Number.isFinite(quantity) ? Math.max(0, quantity) : 0);
  }, 0);
}

export function findCheckoutStockIssues(
  lines: CheckoutStockLine[],
  productsById: Map<string, any>,
  missingNames = new Map<string, string>(),
  now = new Date(),
): CheckoutStockIssue[] {
  return lines.flatMap((line) => {
    const product = productsById.get(String(line.productId));
    const available = getCheckoutAvailableQuantity(product, now);
    if (available >= line.quantity) return [];
    return [{
      productId: String(line.productId),
      name: product?.name ?? missingNames.get(String(line.productId)) ?? "Item",
      requested: line.quantity,
      available,
    }];
  });
}
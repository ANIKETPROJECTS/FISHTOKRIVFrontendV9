export const PREORDER_MODES = ["normal", "preorder_only", "normal_and_preorder"] as const;

export type PreorderMode = (typeof PREORDER_MODES)[number];

/**
 * Product mode is supplied by the admin system. Older products have no mode,
 * so they remain normal products for backwards compatibility.
 */
export function normalizePreorderMode(value: unknown): PreorderMode {
  if (value === "preorder_only" || value === "preorder-only") return "preorder_only";
  if (value === "normal_and_preorder" || value === "normal-and-preorder") return "normal_and_preorder";
  return "normal";
}

export function isNormalStorefrontProduct(product: { preorderMode?: unknown }): boolean {
  const mode = normalizePreorderMode(product.preorderMode);
  return mode === "normal" || mode === "normal_and_preorder";
}

export function isPreorderStorefrontProduct(product: { preorderMode?: unknown }): boolean {
  const mode = normalizePreorderMode(product.preorderMode);
  return mode === "preorder_only" || mode === "normal_and_preorder";
}
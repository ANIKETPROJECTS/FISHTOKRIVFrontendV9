export type MetaCommerceItem = {
  id: string | number;
  quantity: number;
  price: number;
};

type MetaPixelWindow = Window & {
  fbq?: (command: "track", eventName: string, parameters?: Record<string, unknown>) => void;
};

export function trackMetaEvent(eventName: string, parameters: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;
  const fbq = (window as MetaPixelWindow).fbq;
  if (typeof fbq === "function") fbq("track", eventName, parameters);
}

export function trackMetaCommerceEvent(
  eventName: "AddToCart" | "InitiateCheckout" | "Purchase",
  value: number,
  items: MetaCommerceItem[],
  transactionId?: string,
) {
  trackMetaEvent(eventName, {
    value: Number.isFinite(value) ? Math.max(0, value) : 0,
    currency: "INR",
    content_type: "product",
    content_ids: items.map((item) => String(item.id)),
    contents: items.map((item) => ({
      id: String(item.id),
      quantity: item.quantity,
      item_price: item.price,
    })),
    ...(transactionId ? { transaction_id: transactionId } : {}),
  });
}

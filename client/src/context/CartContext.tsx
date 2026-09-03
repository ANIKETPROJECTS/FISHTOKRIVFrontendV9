import { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from "react";
import type { Product, Coupon } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import { useCustomer } from "@/context/CustomerContext";
import { useProducts } from "@/hooks/use-products";
import { useHub } from "@/context/HubContext";

export interface ComboInclude {
  productId: string;
  quantity: number;
  availableQty: number | null;
}

export interface CartItem extends Omit<Product, 'id'> {
  id: number;
  quantity: number;
  instruction?: string;
  /** True when this item was added from the dedicated preorder storefront area. */
  isPreorderCheckout?: boolean;
  isCombo?: boolean;
  originalId?: string;
  comboImages?: string[];
  comboCategories?: string[];
  comboIncludes?: ComboInclude[];
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product | CartItem, quantity?: number, openCart?: boolean) => void;
  removeFromCart: (productId: number) => void;
  updateQuantity: (productId: number, quantity: number) => void;
  updateInstruction: (productId: number, instruction: string) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  appliedCoupon: Coupon | null;
  setAppliedCoupon: (c: Coupon | null) => void;
  discountAmount: number;
  computeMaxQty: (item: CartItem) => number;
}

const CartContext = createContext<CartContextType | null>(null);

// ── Inventory helpers ────────────────────────────────────────────────────────

/**
 * Returns how many MORE units of `item` can be added to the cart,
 * based on available stock and cross-product constraints from combos.
 *
 * For individual products:
 *   max = availableQty - units already consumed by combos (and by itself already in cart)
 *
 * For combos:
 *   max = min over each included product X of:
 *     floor( (stock_X - units_X_consumed_by_all_OTHER_cart_items) / combo_uses_X_per_unit )
 *   minus however many of THIS combo are already in the cart.
 */
function calcMaxQty(item: CartItem, allItems: CartItem[]): number {
  if (item.isCombo) {
    // ── Combo with full per-product data ──────────────────────────────────
    if (item.comboIncludes && item.comboIncludes.length > 0) {
      let minAllowed = Infinity;

      for (const inc of item.comboIncludes) {
        if (inc.availableQty === null) continue;
        const stock = inc.availableQty;

        // Units of this ingredient consumed by OTHER cart items (not self)
        const consumedByOthers = allItems.reduce((total, ci) => {
          if (ci.id === item.id) return total; // skip self
          // Individual product matching this ingredient
          if (!ci.isCombo && String(ci.id) === inc.productId) return total + ci.quantity;
          // Another combo that also uses this ingredient
          if (ci.isCombo && ci.comboIncludes) {
            const found = ci.comboIncludes.find((x) => x.productId === inc.productId);
            if (found) return total + ci.quantity * found.quantity;
          }
          return total;
        }, 0);

        const perUnit = inc.quantity || 1; // default 1 if field missing in DB
        const remaining = stock - consumedByOthers;
        const maxForThisIngredient = Math.floor(remaining / perUnit);
        minAllowed = Math.min(minAllowed, Math.max(0, maxForThisIngredient));
      }

      // minAllowed = total combo units allowed in cart (including already-there quantity)
      return minAllowed === Infinity ? 999 : minAllowed;
    }

    // ── Combo without per-product data (fallback: use pre-computed availableQty min) ──
    const stock = item.availableQty;
    if (stock === null) return 999;
    return Math.max(0, stock);

  } else {
    // ── Individual product ────────────────────────────────────────────────
    const stock = item.availableQty;
    if (stock === null) return 999;

    // Units consumed by combos in cart that include this product
    const comboConsumed = allItems.reduce((total, ci) => {
      if (ci.id === item.id) return total; // skip self
      if (ci.isCombo && ci.comboIncludes) {
        const found = ci.comboIncludes.find((x) => x.productId === String(item.id));
        if (found) return total + ci.quantity * found.quantity;
      }
      return total;
    }, 0);

    return Math.max(0, stock - comboConsumed);
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const { toast } = useToast();
  const { customer, openLoginModal } = useCustomer();
  const { isPincodeVerified, openPicker } = useHub();
  const { data: liveProducts } = useProducts();
  // Track IDs already notified so we only toast once per expiry event
  const notifiedExpiredIds = useRef<Set<string>>(new Set());

  const addToCart = (product: Product | CartItem, quantity = 1, openCart = false) => {
    if (!customer) {
      openLoginModal();
      return;
    }
    if (!isPincodeVerified) {
      toast({
        title: "Pincode required",
        description: "Please enter a valid pincode before adding items to your cart.",
        variant: "destructive",
        duration: 3000,
      });
      openPicker();
      return;
    }

    let blocked = false;
    let blockMsg = "";
    let modeSwitchMessage = "";

    setItems((current) => {
      const isCombo = (product as CartItem).isCombo === true;
      const isPreorderProduct =
        (product as CartItem).isPreorderCheckout === true ||
        product.preorderMode === "preorder_only";

      // A cart can only contain one checkout mode. Preorder orders use a
      // calendar date, while normal orders use the regular delivery flow, so
      // never mix the two kinds of products in one cart.
      const oppositeModeItems = current.filter(
        (item) => Boolean(item.isPreorderCheckout) !== isPreorderProduct,
      );
      const modeItems = oppositeModeItems.length > 0
        ? current.filter((item) => Boolean(item.isPreorderCheckout) === isPreorderProduct)
        : current;

      if (oppositeModeItems.length > 0) {
        modeSwitchMessage = isPreorderProduct
          ? "Normal products were removed because preorder items use a separate delivery date."
          : "Preorder products were removed because normal items use the regular delivery flow.";
      }

      const existing = modeItems.find((i) => i.id === product.id);

      if (isCombo) {
        const ci = product as CartItem;
        if (ci.comboIncludes && ci.comboIncludes.length > 0) {
          const currentComboQty = existing ? existing.quantity : 0;
          const maxTotal = calcMaxQty(ci, modeItems);
          if (currentComboQty + quantity > maxTotal) {
            blocked = true;
            const canAdd = Math.max(0, maxTotal - currentComboQty);
            blockMsg =
              canAdd === 0
                ? `Not enough stock to add more of this combo.`
                : `Only ${canAdd} more of this combo can be added.`;
            return current;
          }
        }
      } else {
        const availableQty = (product as any).availableQty ?? null;
        if (availableQty !== null) {
          const asCartItem = { ...product, quantity: existing ? existing.quantity : 0 } as CartItem;
          const maxTotal = calcMaxQty(asCartItem, modeItems);
          const currentQty = existing ? existing.quantity : 0;
          if (currentQty + quantity > maxTotal) {
            blocked = true;
            const canAdd = Math.max(0, maxTotal - currentQty);
            blockMsg =
              canAdd === 0
                ? `${product.name} is fully consumed by items already in your cart.`
                : `Only ${canAdd} more unit${canAdd === 1 ? "" : "s"} available for ${product.name}.`;
            return current;
          }
        }
      }

      if (existing) {
        return modeItems.map((i) =>
          i.id === product.id
            ? {
                ...i,
                quantity: i.quantity + quantity,
                // If the same product is added from the preorder section later,
                // keep the cart in preorder checkout mode for that item.
                isPreorderCheckout:
                  i.isPreorderCheckout ||
                  (product as CartItem).isPreorderCheckout ||
                  product.preorderMode === "preorder_only",
              }
            : i
        );
      }
      return [
        ...modeItems,
        {
          ...product,
          quantity,
          isPreorderCheckout:
            isPreorderProduct,
        },
      ];
    });

    if (blocked) {
      toast({
        title: "Stock limit reached",
        description: blockMsg,
        variant: "destructive",
        duration: 2500,
      });
      return;
    }
    if (modeSwitchMessage) {
      setAppliedCoupon(null);
      toast({
        title: "Cart updated",
        description: modeSwitchMessage,
        duration: 3500,
      });
    }
    toast({
      title: "Fresh catch added to your Tokri!",
      duration: 2000,
    });
    if (openCart) setIsCartOpen(true);
  };

  const removeFromCart = (productId: number) => {
    setItems((current) => current.filter((i) => i.id !== productId));
  };

  const updateQuantity = (productId: number, quantity: number) => {
    if (quantity < 1) {
      removeFromCart(productId);
      return;
    }
    setItems((current) => {
      const item = current.find((i) => i.id === productId);
      if (!item) return current;

      const maxTotal = calcMaxQty(item, current);
      if (quantity > maxTotal) {
        toast({
          title: "Stock limit reached",
          description: `Only ${maxTotal} unit${maxTotal === 1 ? "" : "s"} allowed based on available stock.`,
          variant: "destructive",
          duration: 2500,
        });
        return current;
      }
      return current.map((i) => (i.id === productId ? { ...i, quantity } : i));
    });
  };

  const updateInstruction = (productId: number, instruction: string) => {
    setItems((current) =>
      current.map((i) => (i.id === productId ? { ...i, instruction } : i))
    );
  };

  const clearCart = () => {
    setItems([]);
  };

  // Exposed to components for disabling +/- buttons and capping qty pickers
  const computeMaxQty = useCallback(
    (item: CartItem): number => calcMaxQty(item, items),
    [items]
  );

  const totalItems = items.reduce((acc, item) => acc + item.quantity, 0);
  const totalPrice = items.reduce(
    (acc, item) => acc + (item.price || 0) * item.quantity,
    0
  );

  const discountAmount = appliedCoupon
    ? appliedCoupon.type === "flat"
      ? Math.min(appliedCoupon.discountValue, totalPrice)
      : Math.round((totalPrice * appliedCoupon.discountValue) / 100)
    : 0;

  useEffect(() => {
    if (appliedCoupon && appliedCoupon.minOrderAmount > totalPrice) {
      setAppliedCoupon(null);
    }
  }, [totalPrice, appliedCoupon]);

  useEffect(() => {
    if (items.length === 0) {
      setAppliedCoupon(null);
    }
  }, [items.length]);

  // ── Auto-remove expired batch products from cart ──────────────────────────
  useEffect(() => {
    if (!liveProducts || items.length === 0) return;

    // Build a map of productId → batchExpired flag
    const expiredIds = new Set(
      liveProducts
        .filter((p) => p.batchExpired)
        .map((p) => p.id)
    );

    // Find cart items that are now expired and haven't been notified yet
    const toRemove = items.filter(
      (item) => !item.isCombo && expiredIds.has(String(item.id))
    );
    const newlyExpired = toRemove.filter(
      (item) => !notifiedExpiredIds.current.has(String(item.id))
    );

    if (newlyExpired.length === 0) return;

    // Mark as notified
    newlyExpired.forEach((item) => notifiedExpiredIds.current.add(String(item.id)));

    // Remove from cart
    setItems((current) =>
      current.filter((item) => !expiredIds.has(String(item.id)))
    );

    // Toast listing removed product names
    const names = newlyExpired.map((i) => i.name).join(", ");
    toast({
      title: "Items removed from your cart",
      description: `${names} ${newlyExpired.length === 1 ? "is" : "are"} now out of stock and ${newlyExpired.length === 1 ? "has" : "have"} been removed.`,
      variant: "destructive",
      duration: 6000,
    });
  }, [liveProducts, items, toast]);

  // When an item is later re-added to cart, clear its notified state so future
  // expiry events are surfaced again
  useEffect(() => {
    items.forEach((item) => {
      notifiedExpiredIds.current.delete(String(item.id));
    });
  }, [items]);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        removeFromCart,
        updateQuantity,
        updateInstruction,
        clearCart,
        totalItems,
        totalPrice,
        isCartOpen,
        setIsCartOpen,
        appliedCoupon,
        setAppliedCoupon,
        discountAmount,
        computeMaxQty,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
}

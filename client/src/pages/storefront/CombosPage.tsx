import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-products";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Plus, Minus } from "lucide-react";
import { useCart } from "@/context/CartContext";
import type { Section, Combo } from "@shared/schema";

import noImageImg from "@assets/Gemini_Generated_Image_z60vyrz60vyrz60v_1782896627484.png";
import { SeoHead } from "@/components/SeoHead";

function getFallbackImage(_category: string): string {
  return noImageImg;
}

function ComboImages({ images, imageUrl }: { images: string[]; imageUrl?: string | null }) {
  if (imageUrl?.trim()) {
    return (
      <div className="relative w-full h-full overflow-hidden">
        <img src={imageUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </div>
    );
  }
  const n = images.length;
  const slotPct = 100 / n;
  const widthPct = n === 1 ? 100 : slotPct + slotPct * 0.45;
  return (
    <div className="relative w-full h-full overflow-hidden">
      {images.map((img, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0"
          style={{ left: `${i * slotPct}%`, width: `${widthPct}%`, zIndex: i }}
        >
          <img src={img} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          {i < n - 1 && (
            <div className="absolute top-0 right-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-black/10" />
          )}
        </div>
      ))}
    </div>
  );
}

function ComboCard({ combo, productMap }: { combo: Combo; productMap: Record<string, any> }) {
  const { addToCart, removeFromCart, updateQuantity, items: cartItems, computeMaxQty } = useCart();

  const comboImages = combo.includes
    .map(inc => {
      const product = productMap[inc.productId];
      return product?.imageUrl || (product ? getFallbackImage(product.category) : null);
    })
    .filter(Boolean) as string[];

  const computedPct = combo.originalPrice > 0
    ? Math.round(((combo.originalPrice - combo.discountedPrice) / combo.originalPrice) * 100)
    : 0;
  const showPct = combo.discount && combo.discount > 0 ? combo.discount : computedPct;

  const comboCartId = -Math.abs(parseInt(combo.id.slice(-6), 16) || 9999);
  const comboCartItem = cartItems.find(i => i.id === comboCartId);
  const comboQty = comboCartItem?.quantity ?? 0;
  const comboMaxQty = comboCartItem ? computeMaxQty(comboCartItem) : 999;

  const buildComboPayload = () => {
    const comboCategories = combo.includes.slice(0, 3).map(inc => productMap[inc.productId]?.category ?? "Fish");
    const qtysWithLimits = combo.includes
      .map(inc => productMap[inc.productId]?.availableQty)
      .filter((q): q is number => q != null);
    const comboAvailableQty = qtysWithLimits.length > 0 ? Math.min(...qtysWithLimits) : null;
    return {
      id: comboCartId, originalId: combo.id, name: combo.name, price: combo.discountedPrice,
      category: "Combo", status: "available", unit: combo.weight, imageUrl: combo.imageUrl ?? null,
      isArchived: false, updatedAt: new Date(), limitedStockNote: null, sectionId: null,
      isCombo: true, comboImages, comboCategories, availableQty: comboAvailableQty,
      comboIncludes: combo.includes.map(inc => ({
        productId: inc.productId, quantity: inc.quantity ?? 1,
        availableQty: productMap[inc.productId]?.availableQty ?? null,
      })),
    } as any;
  };

  return (
    <div className="group relative bg-card flex flex-col transition-all duration-300 cursor-pointer rounded-2xl overflow-hidden border border-border/20 shadow-sm">
      <Link href={`/combo/${combo.id}`}>
        <div className="relative aspect-[10/7] w-full bg-muted/30 overflow-hidden">
          <ComboImages images={comboImages} imageUrl={combo.imageUrl} />
          <div className="absolute top-0 left-0 z-10">
            <div className="relative bg-accent text-white pl-3 pr-5 py-2 shadow-md rounded-tl-2xl">
              <div className="text-[11px] font-bold leading-tight uppercase tracking-wide">Combo</div>
              <div className="text-[11px] font-bold leading-tight uppercase tracking-wide">Saver</div>
              <div
                className="absolute top-0 right-0 h-full w-3"
                style={{ background: "hsl(var(--accent))", clipPath: "polygon(0 0, 100% 50%, 0 100%)", transform: "translateX(100%)" }}
              />
            </div>
          </div>
        </div>
      </Link>
      <div className="flex-1 flex flex-col p-4">
        <Link href={`/combo/${combo.id}`}>
          <h3 className="font-medium text-base text-foreground leading-snug mb-1 line-clamp-2 hover:text-primary transition-colors">
            {combo.name}
          </h3>
        </Link>
        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{combo.description}</p>
        <div className="flex items-center justify-between mt-auto">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold text-foreground">₹{combo.discountedPrice}</span>
            {combo.originalPrice > combo.discountedPrice && (
              <span className="text-sm text-muted-foreground line-through">₹{combo.originalPrice}</span>
            )}
            {showPct > 0 && (
              <span className="text-sm font-semibold text-green-600">{showPct}% off</span>
            )}
          </div>
          {comboQty === 0 ? (
            <Button
              onClick={(e) => { e.stopPropagation(); addToCart(buildComboPayload()); }}
              className="rounded-full w-9 h-9 p-0 text-white shadow-md flex items-center justify-center shrink-0 bg-primary hover:bg-[#F05B4E] transition-colors"
              size="icon"
            >
              <Plus className="w-5 h-5 text-white" />
            </Button>
          ) : (
            <div
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0 rounded-full bg-primary shadow-md overflow-hidden shrink-0"
            >
              <button
                onClick={(e) => { e.stopPropagation(); if (comboQty <= 1) { removeFromCart(comboCartId); } else { updateQuantity(comboCartId, comboQty - 1); } }}
                className="w-7 h-7 flex items-center justify-center text-white hover:bg-white/20 transition-colors"
              >
                <Minus className="w-3 h-3" />
              </button>
              <span className="text-white font-semibold text-xs min-w-[16px] text-center select-none">{comboQty}</span>
              <button
                onClick={(e) => { e.stopPropagation(); addToCart(buildComboPayload()); }}
                disabled={comboQty >= comboMaxQty}
                className="w-7 h-7 flex items-center justify-center text-white hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CombosPage() {
  const [, navigate] = useLocation();
  const { data: products, isLoading: productsLoading } = useProducts();
  const { data: sections = [], isLoading: sectionsLoading } = useQuery<Section[]>({ queryKey: ["/api/sections"] });
  const { data: combos = [], isLoading: combosLoading } = useQuery<Combo[]>({ queryKey: ["/api/combos"] });

  const isLoading = productsLoading || sectionsLoading || combosLoading;

  const productMap = Object.fromEntries((products ?? []).map(p => [p.id, p]));

  const comboSections = sections.filter(s => s.type === "combos" && s.isActive);

  const availableCombos = combos.filter(combo =>
    combo.includes.every(inc => {
      const p = productMap[inc.productId];
      return !p || (!p.batchExpired && p.status !== "unavailable");
    })
  );

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans">
      <SeoHead
        title="Combo Deals — Fresh Fish & Meat Bundles Online in Mumbai"
        description="Order fresh seafood & meat combo deals online in Mumbai. Great value bundles of fish, prawns, chicken & mutton, hygienically packed and delivered same-day. Order now on FishTokri."
        canonical="/combos"
      />
      <Header />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-3 mb-8">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="rounded-full flex-shrink-0"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
              Combo Deals
            </h1>
            {!isLoading && (
              <p className="text-sm text-muted-foreground">
                {availableCombos.length} combo{availableCombos.length !== 1 ? "s" : ""} available
              </p>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
            ))}
          </div>
        ) : comboSections.length === 0 ? (
          availableCombos.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">No combo deals available right now.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {availableCombos.map(combo => (
                <ComboCard key={combo.id} combo={combo} productMap={productMap} />
              ))}
            </div>
          )
        ) : (
          comboSections.map(section => (
            <section key={section.id} className="mb-10">
              <h2 className="text-xl sm:text-2xl font-medium text-foreground uppercase tracking-wide mb-4">
                {section.title}
              </h2>
              {availableCombos.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">No combos available yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {availableCombos.map(combo => (
                    <ComboCard key={combo.id} combo={combo} productMap={productMap} />
                  ))}
                </div>
              )}
            </section>
          ))
        )}
      </main>

      <CartDrawer />
      <Footer />
    </div>
  );
}

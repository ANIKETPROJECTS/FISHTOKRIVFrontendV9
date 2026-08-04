import { useParams, useLocation } from "wouter";
import { SeoHead } from "@/components/SeoHead";
import { useCart } from "@/context/CartContext";
import { useCustomer } from "@/context/CustomerContext";
import { useCoupons } from "@/hooks/use-coupons";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { ProductCard } from "@/components/storefront/ProductCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ShoppingBag, Check, ChefHat,
  ExternalLink, Star, Sparkles, ShoppingBasket,
} from "lucide-react";
import Lottie from "lottie-react";
import recipesIconAnim from "@/assets/lottie/recipes-icon.json";
import mayAlsoLikeAnim from "@/assets/lottie/may-also-like.json";
import iconTimeImg from "@assets/time_1776949603776.png";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SwipeHint } from "@/components/storefront/SwipeHint";
import type { Combo, Product } from "@shared/schema";
import { getActiveHubDb } from "@/lib/queryClient";
import { getDummyDetail } from "@/lib/productDummyData";

import weighScaleIcon from "@assets/weight-scale_1774801344716.png";
import piecesIcon from "@assets/cutlery_1774801395283.png";
import servesIcon from "@assets/hot-food_1774801420499.png";
import giftCardIconImg from "@/assets/gift-card.png";
import tagIconImg from "@/assets/tag.png";
import checkedIconImg from "@/assets/checked.png";

import noImageImg from "@assets/Gemini_Generated_Image_z60vyrz60vyrz60v_1782896627484.png";

function getFallbackImage(_category: string) {
  return noImageImg;
}

function ComboHeroImage({ productImages, productCategories, name, tags }: {
  productImages: string[];
  productCategories: string[];
  name: string;
  tags: string[];
}) {
  const images = productImages.length > 0
    ? productImages
    : productCategories.map(getFallbackImage);

  const n = Math.min(images.length, 3);
  const slotPct = 100 / n;
  const widthPct = n === 1 ? 100 : slotPct + slotPct * 0.5;

  return (
    <div className="relative">
      <div className="aspect-[4/3] sm:aspect-square rounded-3xl overflow-hidden border border-border/20 shadow-xl bg-muted/10">
        {n === 0 ? (
          <div className="w-full h-full flex items-center justify-center text-7xl bg-gradient-to-br from-primary/5 to-accent/5">🐟</div>
        ) : (
          <div className="relative w-full h-full overflow-hidden">
            {images.slice(0, n).map((img, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0"
                style={{ left: `${i * slotPct}%`, width: `${widthPct}%`, zIndex: i }}
              >
                <img src={img} alt={`${name} item ${i + 1}`} className="w-full h-full object-cover" />
                {i < n - 1 && (
                  <div className="absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-black/20" />
                )}
              </div>
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
          </div>
        )}
      </div>

      {/* Combo badge */}
      <div className="absolute bottom-4 right-4">
        <span className="text-xs font-bold bg-black/60 text-white px-3 py-1.5 rounded-full backdrop-blur-sm flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" /> Combo Pack
        </span>
      </div>
    </div>
  );
}

function CouponCard({ code, desc }: { code: string; desc: string; onApply?: () => void; isApplied?: boolean }) {
  return (
    <div className="flex items-center px-4 py-3 bg-background hover:bg-muted/10 transition-colors">
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        <span
          aria-hidden
          className="w-6 h-6 shrink-0 inline-block mt-0.5"
          style={{
            backgroundColor: "#364F9F",
            WebkitMaskImage: `url(${tagIconImg})`,
            maskImage: `url(${tagIconImg})`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
        <div className="min-w-0 flex-1">
          <span
            className="font-mono font-bold text-xs tracking-wider rounded-full px-2.5 py-0.5 text-white inline-block"
            style={{ backgroundColor: "#F05B4E" }}
          >
            {code}
          </span>
          <p className="text-xs text-muted-foreground mt-1 whitespace-normal break-words leading-snug">{desc}</p>
        </div>
      </div>
    </div>
  );
}

function IncludedProductCard({ item, product, comboItemPrice }: {
  item: { productId: string; label: string };
  product?: Product;
  comboItemPrice: number | null;
}) {
  const category = product?.category ?? "Fish";
  const img = product?.imageUrl || getFallbackImage(category);

  // standalone price = what you'd pay buying this product separately
  const standalonePrice = product?.price ?? product?.originalPrice ?? null;
  const showPricing = standalonePrice != null && comboItemPrice != null && comboItemPrice < standalonePrice;

  const dummy = product ? getDummyDetail(product.category) : null;
  const piecesText = product?.pieces || dummy?.pieces;
  const servesText = product?.serves || dummy?.serves;
  const hasGrossOrNet = !!(product?.grossWeight || product?.netWeight);
  const hasStats = !!(piecesText || servesText || hasGrossOrNet);

  return (
    <Link href={product ? `/product/${product.id}` : "#"}>
      <div className="flex items-start gap-4 py-4 group cursor-pointer">
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shrink-0 bg-muted/30 border border-border/30">
          <img src={img} alt={item.label} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-base sm:text-lg font-bold text-foreground leading-snug group-hover:text-primary transition-colors">
              {item.label}
            </span>
            {product && (
              <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
            )}
          </div>
          {product && (
            <p className="text-sm text-muted-foreground line-clamp-1 mt-0.5">
              {product.category}
              {product.unit ? ` · ${product.unit}` : product.weight ? ` · ${product.weight}` : ""}
            </p>
          )}
          {showPricing && comboItemPrice != null && standalonePrice != null && (
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-base sm:text-lg font-bold text-foreground">₹{comboItemPrice}</span>
              <span className="text-sm text-muted-foreground line-through">₹{standalonePrice}</span>
            </div>
          )}

          {/* Pieces / Serves / Weight — wraps on mobile so nothing collides or hides */}
          {hasStats && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2 text-black dark:text-white">
              {piecesText && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden
                    className="w-4 h-4 sm:w-5 sm:h-5 inline-block shrink-0 bg-black dark:bg-white"
                    style={{
                      WebkitMaskImage: `url(${piecesIcon})`,
                      maskImage: `url(${piecesIcon})`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                  <span className="text-xs sm:text-sm font-semibold leading-tight">{piecesText}</span>
                </div>
              )}

              {servesText && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden
                    className="w-4 h-4 sm:w-5 sm:h-5 inline-block shrink-0 bg-black dark:bg-white"
                    style={{
                      WebkitMaskImage: `url(${servesIcon})`,
                      maskImage: `url(${servesIcon})`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                  <span className="text-xs sm:text-sm font-semibold leading-tight">{servesText}</span>
                </div>
              )}

              {hasGrossOrNet && (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden
                    className="w-4 h-4 sm:w-5 sm:h-5 inline-block shrink-0 bg-black dark:bg-white"
                    style={{
                      WebkitMaskImage: `url(${weighScaleIcon})`,
                      maskImage: `url(${weighScaleIcon})`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                  <div className="flex items-baseline gap-1 leading-tight text-xs sm:text-sm font-semibold">
                    {product?.grossWeight && (
                      <span>
                        {product.grossWeight}
                        <span className="font-normal ml-0.5">gross</span>
                      </span>
                    )}
                    {product?.grossWeight && product?.netWeight && (
                      <span className="font-normal opacity-50">/</span>
                    )}
                    {product?.netWeight && (
                      <span>
                        {product.netWeight}
                        <span className="font-normal ml-0.5">net</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}

function ComboImages({ images }: { images: string[] }) {
  const n = images.length;
  if (n === 0) return <div className="w-full h-full flex items-center justify-center text-4xl">🎁</div>;
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
          <img src={img} alt="" className="w-full h-full object-cover" />
          {i < n - 1 && (
            <div className="absolute top-0 right-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-black/10" />
          )}
        </div>
      ))}
    </div>
  );
}

function ComboCard({ combo, productMap }: { combo: Combo; productMap: Record<string, Product> }) {
  const [, navigate] = useLocation();
  const savings = combo.originalPrice - combo.discountedPrice;
  const discountPct = combo.discount > 0 ? combo.discount : null;
  const comboImages = combo.includes
    .map((inc) => {
      const product = productMap[inc.productId];
      return product?.imageUrl || (product ? getFallbackImage(product.category) : null);
    })
    .filter(Boolean) as string[];
  return (
    <div
      onClick={() => navigate(`/combo/${combo.id}`)}
      className="w-[210px] sm:w-[230px] snap-start group relative bg-card flex flex-col h-full transition-all duration-300 cursor-pointer"
    >
      <div className="relative aspect-square w-full bg-muted/30 overflow-hidden mb-3 border border-border/20 rounded-xl">
        <div className="w-full h-full group-hover:scale-110 transition-transform duration-700">
          <ComboImages images={comboImages} />
        </div>
        <div className="absolute top-2 left-2">
          <span className="bg-primary/90 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Combo</span>
        </div>
      </div>
      <div className="flex-1 flex flex-col px-1">
        <h3 className="font-sans font-medium text-base sm:text-lg text-foreground leading-snug mb-1.5 line-clamp-2">
          {combo.name}
        </h3>
        <p className="text-sm text-muted-foreground mb-2.5 font-normal">
          {combo.includes.length} items&nbsp;&nbsp;|&nbsp;&nbsp;{combo.weight ?? "Combo pack"}
        </p>
        <div className="flex items-center justify-between mt-auto pt-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg sm:text-xl font-semibold text-foreground">₹{combo.discountedPrice}</span>
            <span className="text-sm text-muted-foreground line-through">₹{combo.originalPrice}</span>
            {discountPct && <span className="text-sm font-semibold text-green-600">{discountPct}% off</span>}
          </div>
        </div>
        {savings > 0 && (
          <p className="text-xs text-emerald-600 font-medium mt-1">Save ₹{savings}</p>
        )}
      </div>
    </div>
  );
}

export default function ComboDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { addToCart, setIsCartOpen, appliedCoupon, setAppliedCoupon, computeMaxQty, items } = useCart();
  const { customer, openLoginModal } = useCustomer();
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [showAllCoupons, setShowAllCoupons] = useState(false);
  const productRecipesScrollRef = useRef<HTMLDivElement>(null);
  const combosScrollRef = useRef<HTMLDivElement>(null);
  const similarScrollRef = useRef<HTMLDivElement>(null);

  const hubHeaders = getActiveHubDb() ? { "X-Hub-DB": getActiveHubDb()! } : {};

  const { data: combo, isLoading: comboLoading } = useQuery<Combo>({
    queryKey: ["/api/combos", id],
    queryFn: async () => {
      const res = await fetch(`/api/combos/${id}`, { credentials: "include", headers: hubHeaders });
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!id,
  });

  const { data: products = [] } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: allCombos = [] } = useQuery<Combo[]>({ queryKey: ["/api/combos"] });
  const { data: allCoupons = [] } = useCoupons();
  const { data: userCouponUsage = {} } = useQuery<Record<string, { usedCount: number; limit: number; isExhausted: boolean; message: string }>>({
    queryKey: ["/api/coupons/user-usage"],
    enabled: !!customer,
    staleTime: 0,
  });
  const liveCoupons = (allCoupons ?? []).filter((c) => c.isActive && c.visibleOnWebsite !== false && !(!!customer && userCouponUsage[c.code]?.isExhausted));

  const productMap = Object.fromEntries(products.map((p) => [p.id, p]));

  const includedProducts = (combo?.includes ?? []).map((inc) => ({
    item: inc,
    product: productMap[inc.productId] as Product | undefined,
  }));

  const productImages = includedProducts
    .map(({ product }) => product?.imageUrl)
    .filter(Boolean) as string[];

  const productCategories = includedProducts
    .map(({ product }) => product?.category ?? "Fish");

  const otherCombos = allCombos.filter((c) => c.id !== id).slice(0, 8);

  // Per-item combo prices calculated proportionally from each product's current standalone price
  const sumStandalonePrice = includedProducts.reduce((sum, { product }) => {
    return sum + (product?.price ?? product?.originalPrice ?? 0);
  }, 0);
  const getComboItemPrice = (product: Product | undefined): number | null => {
    if (!combo || !product || sumStandalonePrice <= 0) return null;
    const standalonePrice = product.price ?? product.originalPrice;
    if (standalonePrice == null) return null;
    return Math.round((standalonePrice / sumStandalonePrice) * combo.discountedPrice);
  };

  // Keep for any backward-compat uses (weight calc, etc.)
  const comboDiscountRatio = combo && combo.originalPrice > 0
    ? combo.discountedPrice / combo.originalPrice
    : 1;

  // Weight parsing + combo gross/net weight calculation
  const parseWeightGrams = (str: string | null | undefined): number | null => {
    if (!str || typeof str !== "string") return null;
    const m = str.match(/([\d.]+)\s*(kg|g|gm|gram|grams|kilogram|kilograms)/i);
    if (!m) return null;
    const val = parseFloat(m[1]);
    return m[2].toLowerCase().startsWith("kg") ? val * 1000 : val;
  };
  const fmtGrams = (g: number) => {
    if (g >= 1000) { const kg = g / 1000; return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(1)} kg`; }
    return `${Math.round(g)} g`;
  };
  const comboGrossGrams = includedProducts.reduce<number | null>((sum, { product }) => {
    const g = parseWeightGrams(product?.grossWeight);
    if (g === null) return sum;
    return (sum ?? 0) + g;
  }, null);
  const comboNetGrams = includedProducts.reduce<number | null>((sum, { product }) => {
    const g = parseWeightGrams(product?.netWeight);
    if (g === null) return sum;
    return (sum ?? 0) + g;
  }, null);
  const comboGrossWeight = comboGrossGrams !== null ? fmtGrams(comboGrossGrams) : null;
  const comboNetWeight = comboNetGrams !== null ? fmtGrams(comboNetGrams) : null;

  // Collect all recipes from the combo's included products
  const allProductRecipes = includedProducts.flatMap(({ product }) => {
    if (!product) return [];
    const dbRecipes = product.recipes ?? [];
    return dbRecipes.map((r: any, idx: number) => ({
      title: r.title ?? r.name,
      description: r.description,
      image: r.image ?? null,
      totalTime: r.totalTime ?? "",
      difficulty: r.difficulty ?? "",
      productName: product.name,
      productId: product.id,
      recipeIndex: idx,
    }));
  });

  // Similar products: same categories as combo items, excluding combo's own products
  // Falls back to all available products if not enough same-category ones exist
  const comboProductIds = new Set((combo?.includes ?? []).map((inc) => inc.productId));
  const comboCategories = new Set(includedProducts.map(({ product }) => product?.category).filter(Boolean));
  const sameCategorySimilar = products.filter(
    (p) => !p.isArchived && !comboProductIds.has(p.id) && comboCategories.has(p.category)
  );
  const similarProducts = sameCategorySimilar.length >= 3
    ? sameCategorySimilar.slice(0, 10)
    : products.filter((p) => !p.isArchived && !comboProductIds.has(p.id)).slice(0, 10);

  // Build a cart-item representation of this combo (for max-qty calculation)
  const comboCartItem = combo
    ? ({
        id: -Math.abs(parseInt(combo.id.slice(-6), 16) || 9999),
        originalId: combo.id,
        name: combo.name,
        price: combo.discountedPrice,
        category: "Combo",
        status: "available",
        unit: combo.weight ?? undefined,
        imageUrl: null,
        isArchived: false,
        updatedAt: new Date(),
        limitedStockNote: null,
        sectionId: null,
        isCombo: true,
        comboImages: [],
        comboCategories: [],
        availableQty: null,
        quantity: items.find((i) => i.isCombo && i.originalId === combo.id)?.quantity ?? 0,
        comboIncludes: combo.includes.map((inc) => ({
          productId: inc.productId,
          quantity: inc.quantity,
          availableQty: productMap[inc.productId]?.availableQty ?? null,
        })),
      } as any)
    : null;

  const maxComboQty = comboCartItem ? computeMaxQty(comboCartItem) : 99;

  const handleAddToCart = () => {
    if (!combo || !comboCartItem) return;
    if (!customer) { openLoginModal(); return; }
    const comboImagesForCart = includedProducts
      .slice(0, 3)
      .map(({ product }) => product?.imageUrl || getFallbackImage(product?.category ?? "Fish"));
    const comboCategoriesForCart = includedProducts
      .slice(0, 3)
      .map(({ product }) => product?.category ?? "Fish");
    addToCart(
      {
        ...comboCartItem,
        comboImages: comboImagesForCart,
        comboCategories: comboCategoriesForCart,
      } as any,
      qty
    );
    setAdded(true);
    setTimeout(() => { setAdded(false); setIsCartOpen(true); }, 800);
  };

  if (comboLoading) {
    return (
      <div className="min-h-screen bg-background font-sans">
        <Header
          onSearchSubmit={(q) => navigate(q ? `/?q=${encodeURIComponent(q)}` : "/")}
          collapsibleMobileSearch
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <Skeleton className="aspect-square rounded-3xl" />
            <div className="space-y-4">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
              <Skeleton className="h-12 w-full rounded-full" />
            </div>
          </div>
        </div>
        <CartDrawer />
      </div>
    );
  }

  if (!combo) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <Header
          onSearchSubmit={(q) => navigate(q ? `/?q=${encodeURIComponent(q)}` : "/")}
          collapsibleMobileSearch
        />
        <p className="text-muted-foreground text-lg">Combo not found.</p>
        <Button onClick={() => navigate("/")}>Go Home</Button>
        <CartDrawer />
      </div>
    );
  }

  const savings = combo.originalPrice - combo.discountedPrice;

  return (
    <div className="min-h-screen bg-background font-sans">
      <SeoHead
        title={`Buy ${combo.name} Combo Online in Mumbai | FishTokri`}
        description={`Order ${combo.name} combo online in Mumbai. Fresh seafood & meat bundle, hygienically packed and delivered same-day. Order now on FishTokri.`}
        canonical={`/combo/${id}`}
        ogType="product"
      />
      <Header
        onSearchSubmit={(q) => navigate(q ? `/?q=${encodeURIComponent(q)}` : "/")}
        collapsibleMobileSearch
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        {/* Back */}
        <button
          onClick={() => navigate("/" as any)}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back to store
        </button>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-14">

          {/* LEFT – Hero image collage */}
          <ComboHeroImage
            productImages={productImages}
            productCategories={productCategories}
            name={combo.name}
            tags={combo.tags}
          />

          {/* RIGHT – Details */}
          <div className="flex flex-col gap-5">

            {/* Name + badges */}
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span
                  className="text-xs font-bold tracking-wide rounded-full px-2.5 py-0.5 text-white inline-block"
                  style={{ backgroundColor: "#F05B4E" }}
                >
                  Combo Pack
                </span>
                <span
                  className="text-xs font-bold tracking-wide rounded-full px-2.5 py-0.5 text-white inline-block"
                  style={{ backgroundColor: "#F05B4E" }}
                >
                  {combo.includes.length} Items
                </span>
                {combo.discount > 0 && (
                  <span
                    className="text-xs font-bold tracking-wide rounded-full px-2.5 py-0.5 text-white inline-block"
                    style={{ backgroundColor: "#F05B4E" }}
                  >
                    {combo.discount}% Off
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">{combo.name}</h1>
            </div>

            {/* Description */}
            {combo.fullDescription && (
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">{combo.fullDescription}</p>
            )}

            {/* What's Included */}
            <div>
              <h3 className="text-base sm:text-lg font-bold text-foreground mb-3 flex items-center gap-2">
                <span
                  aria-hidden
                  className="w-5 h-5 sm:w-6 sm:h-6 inline-block shrink-0"
                  style={{
                    backgroundColor: "#F05B4E",
                    WebkitMaskImage: `url(${checkedIconImg})`,
                    maskImage: `url(${checkedIconImg})`,
                    WebkitMaskRepeat: "no-repeat",
                    maskRepeat: "no-repeat",
                    WebkitMaskSize: "contain",
                    maskSize: "contain",
                    WebkitMaskPosition: "center",
                    maskPosition: "center",
                  }}
                />
                What's Included
              </h3>
              <div className="divide-y divide-border/30">
                {includedProducts.map(({ item, product }, i) => (
                  <IncludedProductCard
                    key={i}
                    item={item}
                    product={product}
                    comboItemPrice={getComboItemPrice(product)}
                  />
                ))}
              </div>
            </div>

            {/* Price block */}
            <div className="bg-muted/30 border border-border/30 rounded-2xl px-5 py-4">
              <div className="flex items-end gap-3 mb-1">
                <span className="text-3xl font-bold text-foreground">₹{combo.discountedPrice}</span>
                <span className="text-base text-muted-foreground line-through mb-0.5">₹{combo.originalPrice}</span>
                <span className="text-sm font-semibold text-green-600 mb-0.5">{combo.discount}% off</span>
              </div>
              <p className="text-xs text-muted-foreground">Inclusive of all taxes.</p>
            </div>

            {/* Savings highlight */}
            {savings > 0 && (
              <div className="flex items-center gap-3 rounded-2xl p-4" style={{ backgroundColor: "#F97316" }}>
                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
                  <Star className="w-5 h-5 text-white fill-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    You save ₹{savings} ({combo.discount}% off)
                  </p>
                  <p className="text-xs text-white/80">vs buying each item separately</p>
                </div>
              </div>
            )}

            {/* Qty + Add to Cart */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 bg-muted/40 border border-border/40 rounded-full px-4 py-2">
                <button
                  onClick={() => setQty(q => Math.max(1, q - 1))}
                  className="text-xl font-bold text-foreground w-7 h-7 flex items-center justify-center hover:text-primary transition-colors"
                  data-testid="button-qty-decrease"
                >−</button>
                <span className="text-base font-semibold w-5 text-center" data-testid="text-qty">{qty}</span>
                <button
                  onClick={() => setQty(q => Math.min(q + 1, maxComboQty))}
                  disabled={qty >= maxComboQty}
                  className="text-xl font-bold text-foreground w-7 h-7 flex items-center justify-center hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  data-testid="button-qty-increase"
                >+</button>
              </div>
              <Button
                onClick={handleAddToCart}
                className={`flex-1 h-12 rounded-full font-bold text-base flex items-center justify-center gap-2 transition-all ${
                  added ? "bg-emerald-500 hover:bg-emerald-500 text-white" : "bg-primary text-white shadow-lg shadow-primary/20"
                }`}
                data-testid="button-add-combo-to-cart"
              >
                {added ? (
                  <><Check className="w-5 h-5" /> Added to Cart!</>
                ) : (
                  <><ShoppingBag className="w-5 h-5" /> Add {qty} to Cart — ₹{combo.discountedPrice * qty}</>
                )}
              </Button>
            </div>

            {/* Available Offers — matches single product page */}
            {liveCoupons.length > 0 && (
              <div className="border border-border/40 rounded-2xl overflow-hidden">
                <div
                  className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20"
                  data-testid="header-offers"
                >
                  <span
                    aria-hidden
                    className="w-5 h-5 shrink-0 inline-block"
                    style={{
                      backgroundColor: "#364F9F",
                      WebkitMaskImage: `url(${giftCardIconImg})`,
                      maskImage: `url(${giftCardIconImg})`,
                      WebkitMaskRepeat: "no-repeat",
                      maskRepeat: "no-repeat",
                      WebkitMaskSize: "contain",
                      maskSize: "contain",
                      WebkitMaskPosition: "center",
                      maskPosition: "center",
                    }}
                  />
                  <div className="flex-1 text-left min-w-0">
                    <span className="text-sm font-semibold text-foreground">
                      Offers Available
                    </span>
                  </div>
                </div>

                <div className="flex flex-col divide-y divide-border/20 border-t border-border/20">
                  {(showAllCoupons ? liveCoupons : liveCoupons.slice(0, 3)).map((c) => (
                    <CouponCard
                      key={c.id}
                      code={c.code}
                      desc={c.description}
                      isApplied={appliedCoupon?.code === c.code}
                      onApply={() => setAppliedCoupon(appliedCoupon?.code === c.code ? null : c)}
                    />
                  ))}
                  {liveCoupons.length > 3 && (
                    <button
                      onClick={() => setShowAllCoupons(v => !v)}
                      className="w-full py-2.5 text-xs font-semibold text-center transition-colors hover:opacity-80"
                      style={{ color: "#364F9F" }}
                    >
                      {showAllCoupons ? "View Less" : `View ${liveCoupons.length - 3} More Offer${liveCoupons.length - 3 > 1 ? "s" : ""}`}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Recipes from Combo Products ── */}
        {allProductRecipes.length > 0 && (
          <section className="mb-14">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                <Lottie animationData={recipesIconAnim} loop autoplay />
              </div>
              <h2 className="text-lg sm:text-xl font-medium text-foreground">Recipes from This Combo</h2>
            </div>
            <div className="relative">
              <div ref={productRecipesScrollRef} className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                {allProductRecipes.map((recipe, idx) => (
                  <div
                    key={idx}
                    className="min-w-[260px] sm:min-w-[280px] snap-start bg-card border border-border/30 rounded-2xl overflow-hidden hover:shadow-md transition-shadow flex flex-col cursor-pointer"
                  >
                    <div className="relative w-full h-44 overflow-hidden bg-muted/20 flex items-center justify-center">
                      {recipe.image ? (
                        <img src={recipe.image} alt={recipe.title} className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
                      ) : (
                        <ChefHat className="w-10 h-10 text-muted-foreground/30" />
                      )}
                      {recipe.difficulty && (
                        <span className="absolute top-2 right-2 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-[#F97316] text-white shadow-sm">
                          {recipe.difficulty}
                        </span>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-1 gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">{recipe.productName}</span>
                      <h4 className="font-medium text-base text-foreground leading-snug line-clamp-2">{recipe.title}</h4>
                      <p className="text-xs font-light text-muted-foreground leading-relaxed line-clamp-3 flex-1">{recipe.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {recipe.totalTime && (
                          <span className="inline-flex items-center gap-1">
                            <span
                              aria-hidden
                              className="w-3.5 h-3.5 inline-block shrink-0"
                              style={{
                                backgroundColor: "#364F9F",
                                WebkitMaskImage: `url(${iconTimeImg})`,
                                maskImage: `url(${iconTimeImg})`,
                                WebkitMaskRepeat: "no-repeat",
                                maskRepeat: "no-repeat",
                                WebkitMaskSize: "contain",
                                maskSize: "contain",
                                WebkitMaskPosition: "center",
                                maskPosition: "center",
                              }}
                            />
                            {recipe.totalTime}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate(`/recipe/product/${recipe.productId}/${recipe.recipeIndex}`); }}
                        className="mt-1 w-full text-sm font-semibold bg-accent text-white border border-accent rounded-full px-3 py-2 hover:bg-[#364F9F] hover:border-[#364F9F] hover:text-white transition-colors"
                      >
                        View Recipe
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <SwipeHint scrollRef={productRecipesScrollRef} />
            </div>
          </section>
        )}

        {/* ── More Combo Deals ── */}
        {otherCombos.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                <Lottie animationData={mayAlsoLikeAnim} loop autoplay />
              </div>
              <h2 className="text-lg sm:text-xl font-medium text-foreground">More Combo Deals</h2>
            </div>
            <div className="relative">
              <div ref={combosScrollRef} className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                {otherCombos.map((c) => (
                  <ComboCard key={c.id} combo={c} productMap={productMap} />
                ))}
              </div>
              <SwipeHint scrollRef={combosScrollRef} />
            </div>
          </section>
        )}
        {/* ── Similar Products ── */}
        {similarProducts.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                <Lottie animationData={mayAlsoLikeAnim} loop autoplay />
              </div>
              <h2 className="text-lg sm:text-xl font-medium text-foreground">You May Also Like</h2>
            </div>
            <div className="relative">
              <div ref={similarScrollRef} className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                {similarProducts.map((p) => (
                  <div key={p.id} className="w-[210px] sm:w-[230px] shrink-0 snap-start">
                    <ProductCard product={p} />
                  </div>
                ))}
              </div>
              <SwipeHint scrollRef={similarScrollRef} />
            </div>
          </section>
        )}
      </div>

      <CartDrawer />
      <Footer />
    </div>
  );
}

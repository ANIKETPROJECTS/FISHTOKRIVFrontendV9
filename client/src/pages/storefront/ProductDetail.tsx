import { useRoute, useLocation } from "wouter";
import { useProducts } from "@/hooks/use-products";
import { useProductCoupons } from "@/hooks/use-coupons";
import { useCart } from "@/context/CartContext";
import { useCustomer } from "@/context/CustomerContext";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { ProductCard } from "@/components/storefront/ProductCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getDummyDetail } from "@/lib/productDummyData";
import {
  ChevronLeft, Plus, Minus, Copy, Check, ChefHat, ShoppingBasket,
  ChevronDown, ChevronUp,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { SwipeHint } from "@/components/storefront/SwipeHint";
import type { Product } from "@shared/schema";
import { isNormalStorefrontProduct } from "@shared/productVisibility";

import weighScaleIcon from "@assets/weight-scale_1774801344716.png";
import piecesIcon from "@assets/cutlery_1774801395283.png";
import servesIcon from "@assets/hot-food_1774801420499.png";
import iconTimeImg from "@assets/time_1776949603776.png";
import giftCardIconImg from "@/assets/gift-card.png";
import tagIconImg from "@/assets/tag.png";
import Lottie from "lottie-react";
import recipesIconAnim from "@/assets/lottie/recipes-icon.json";
import mayAlsoLikeAnim from "@/assets/lottie/may-also-like.json";

import noImageImg from "@assets/Gemini_Generated_Image_z60vyrz60vyrz60v_1782896627484.png";
import { SeoHead } from "@/components/SeoHead";

function getFallbackImage(_category: string) {
  return noImageImg;
}

function CouponCard({ code, description }: { code: string; description: string; color?: string; onApply?: () => void; isApplied?: boolean }) {
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
          <p className="text-xs text-muted-foreground mt-1 whitespace-normal break-words leading-snug">{description}</p>
        </div>
      </div>
    </div>
  );
}

function RecipeCard({
  recipe, category, index, onViewRecipe,
}: {
  recipe: { name: string; description: string; image: string; totalTime: string; difficulty: string };
  category: string;
  index: number;
  onViewRecipe: (category: string, index: number) => void;
}) {
  return (
    <div
      className="min-w-[260px] sm:min-w-[280px] snap-start bg-card border border-border/30 rounded-2xl overflow-hidden hover:shadow-md transition-shadow flex flex-col cursor-pointer"
      onClick={() => onViewRecipe(category, index)}
    >
      <div className="relative w-full h-44 overflow-hidden bg-muted/20">
        <img
          src={recipe.image}
          alt={recipe.name}
          className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
        />
        {recipe.difficulty && (
          <span className="absolute top-2 right-2 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-[#F97316] text-white shadow-sm">
            {recipe.difficulty}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <h4 className="font-medium text-base text-foreground leading-snug line-clamp-2">{recipe.name}</h4>
        <p className="text-xs font-light text-muted-foreground leading-relaxed line-clamp-3 flex-1">{recipe.description}</p>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onViewRecipe(category, index); }}
          className="mt-1 w-full text-sm font-semibold bg-accent text-white border border-accent rounded-full px-3 py-2 hover:bg-[#364F9F] hover:border-[#364F9F] hover:text-white transition-colors"
        >
          View Recipe
        </button>
      </div>
    </div>
  );
}

export default function ProductDetail() {
  const [showAllCoupons, setShowAllCoupons] = useState(false);
  const [, params] = useRoute("/product/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: products, isLoading } = useProducts();
  const { addToCart, updateQuantity, appliedCoupon, setAppliedCoupon, items: cartItems } = useCart();
  const { customer, openLoginModal } = useCustomer();
  const [qty, setQty] = useState(1);
  const recipeScrollRef = useRef<HTMLDivElement>(null);
  const similarScrollRef = useRef<HTMLDivElement>(null);

  const productId = params?.id;
  const product = products?.find((p) => p.id === productId && !p.batchExpired);
  const isUnavailable = product?.status === "unavailable";

  // Auto-redirect to home when the product disappears from the list (went out of stock
  // after ordering or due to a background stock poll). Show a toast so the user knows why.
  useEffect(() => {
    if (!isLoading && products !== undefined && !product && productId) {
      toast({
        title: "This item is now out of stock",
        description: "You've been redirected to the home screen.",
        variant: "destructive",
      });
      setLocation("/");
    }
  }, [isLoading, products, product, productId, setLocation, toast]);

  // Inventory cap — same logic as home screen and ComboDetail
  const cartItem = cartItems.find(i => (i.originalId ?? String(i.id)) === product?.id);
  const currentCartQty = cartItem?.quantity ?? 0;
  const maxAddable = product?.availableQty != null
    ? Math.max(0, product.availableQty - currentCartQty)
    : 999;
  const [offersExpanded, setOffersExpanded] = useState(false);

  // Reset local qty when navigating to a different product
  useEffect(() => {
    setQty(1);
  }, [productId]);

  const { coupons: rawProductCoupons } = useProductCoupons(productId, product?.couponIds ?? []);
  const { data: userCouponUsage = {} } = useQuery<Record<string, { usedCount: number; limit: number; isExhausted: boolean; message: string }>>({
    queryKey: ["/api/coupons/user-usage"],
    enabled: !!customer,
    staleTime: 0,
  });
  const liveCoupons = rawProductCoupons.filter(c => c.visibleOnWebsite !== false && !(!!customer && userCouponUsage[c.code]?.isExhausted));

  const dummy = product ? getDummyDetail(product.category) : null;
  const hasDiscount = product?.originalPrice != null && product?.price != null && product.originalPrice > product.price;
  const effectiveDiscountPct = hasDiscount
    ? Math.round((product!.originalPrice! - product!.price!) / product!.originalPrice! * 100)
    : 0;
  const strikePrice = hasDiscount ? product!.originalPrice : null;

  const availableProducts = products?.filter((p) => !p.isArchived && p.id !== productId && isNormalStorefrontProduct(p)) ?? [];
  const sameCategory = availableProducts.filter((p) => p.category === product?.category);
  const otherCategory = availableProducts.filter((p) => p.category !== product?.category);
  const recommended = [...sameCategory, ...otherCategory].slice(0, 10);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header
          onSearchSubmit={(q) => setLocation(q ? `/?q=${encodeURIComponent(q)}` : "/")}
          collapsibleMobileSearch
        />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-2 gap-10">
          <Skeleton className="aspect-square rounded-3xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
        <CartDrawer />
      </div>
    );
  }

  if (!product || !dummy) {
    // The useEffect above will redirect to home. Render a blank screen in the
    // interim so there's no jarring "Product not found." flash behind the cart drawer.
    return <div className="min-h-screen bg-background" />;
  }

  const catKeyword = product.category?.toLowerCase() ?? "seafood";
  return (
    <div className="min-h-screen bg-background font-sans">
      <SeoHead
        title={`Buy ${product.name} Online in Mumbai | Fresh & Hygienically Cut`}
        description={`Order ${product.name} online in Mumbai. 100% fresh ${catKeyword}, hygienically cleaned & cut, delivered same-day to your doorstep. Free delivery above ₹500. Order now on FishTokri.`}
        canonical={`/product/${productId}`}
        ogImage={product.imageUrl ?? undefined}
        ogType="product"
        jsonLd={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            "itemListElement": [
              { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://fishtokri.com/" },
              { "@type": "ListItem", "position": 2, "name": product.category, "item": `https://fishtokri.com/category/${encodeURIComponent(product.category)}` },
              { "@type": "ListItem", "position": 3, "name": product.name, "item": `https://fishtokri.com/product/${productId}` },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": product.name,
            "image": product.imageUrl ?? "https://fishtokri.com/og-default.png",
            "description": `Fresh ${product.name}, hygienically cleaned and cut, delivered same-day across Mumbai.`,
            "category": product.category,
            "brand": { "@type": "Brand", "name": "FishTokri" },
            "offers": {
              "@type": "Offer",
              "priceCurrency": "INR",
              "price": String(product.price ?? 0),
              "availability": product.status === "unavailable" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
              "url": `https://fishtokri.com/product/${productId}`,
            },
          },
        ]}
      />
      <Header
        onSearchSubmit={(q) => setLocation(q ? `/?q=${encodeURIComponent(q)}` : "/")}
        collapsibleMobileSearch
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10">

        {/* Back */}
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back to store
        </button>

        {/* ── Main Grid: Image | Details ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 mb-14">

          {/* LEFT – Image */}
          <div className="relative">
            <div className="aspect-square rounded-3xl overflow-hidden border border-border/20 shadow-lg bg-muted/20">
              <img
                src={product.imageUrl || getFallbackImage(product.category)}
                alt={product.name}
                className="w-full h-full object-cover"
              />
            </div>
            {product.status === "limited" && (
              <Badge className="absolute top-4 left-4 bg-amber-500 text-white border-none shadow">Limited Stock</Badge>
            )}
            {product.status === "unavailable" && (
              <Badge className="absolute top-4 left-4 bg-red-500 text-white border-none shadow">Sold Out</Badge>
            )}
          </div>

          {/* RIGHT – Details */}
          <div className="flex flex-col gap-5">

            {/* Name + category / subcategory */}
            <div>
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span
                  className="text-xs font-bold tracking-wide rounded-full px-2.5 py-0.5 text-white inline-block"
                  style={{ backgroundColor: "#F05B4E" }}
                  data-testid={`badge-category-${product.category}`}
                >
                  {product.category}
                </span>
                {product.subCategory && product.subCategory !== product.name && (
                  <span
                    className="text-xs font-semibold tracking-wide rounded-full px-2.5 py-0.5 inline-block border"
                    style={{ borderColor: "#364F9F", color: "#364F9F", backgroundColor: "transparent" }}
                  >
                    {product.subCategory}
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-foreground leading-tight">{product.name}</h1>
            </div>

            {/* Description */}
            {product.description && (
              <p className="text-muted-foreground text-sm sm:text-base leading-relaxed">{product.description}</p>
            )}

            {/* Pieces / Serves / Weight — wraps gracefully when text is long */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 py-1 text-black dark:text-white">
              {/* Pieces */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  aria-hidden
                  className="w-6 h-6 sm:w-7 sm:h-7 inline-block shrink-0 bg-black dark:bg-white"
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
                <span className="text-sm sm:text-lg font-semibold leading-tight whitespace-nowrap">
                  {product.pieces || dummy.pieces}
                </span>
              </div>

              <span aria-hidden className="block w-px h-6 sm:h-7 bg-black/70 dark:bg-white/70 shrink-0" />

              {/* Serves */}
              <div className="flex items-center gap-2 shrink-0">
                <span
                  aria-hidden
                  className="w-6 h-6 sm:w-7 sm:h-7 inline-block shrink-0 bg-black dark:bg-white"
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
                <span className="text-sm sm:text-lg font-semibold leading-tight whitespace-nowrap">
                  {product.serves || dummy.serves}
                  {product.serves && !product.serves.toLowerCase().includes("serv") && (
                    <span className="text-xs sm:text-sm font-normal ml-1">Serving</span>
                  )}
                </span>
              </div>

              {(product.grossWeight || product.netWeight) && (
                <span aria-hidden className="block w-px h-6 sm:h-7 bg-black/70 dark:bg-white/70 shrink-0" />
              )}

              {/* Weight */}
              {(product.grossWeight || product.netWeight) && (
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    aria-hidden
                    className="w-6 h-6 sm:w-7 sm:h-7 inline-block shrink-0 bg-black dark:bg-white"
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
                  <div className="flex flex-row flex-wrap items-baseline gap-x-1 leading-tight text-sm sm:text-lg font-semibold">
                    {product.grossWeight && (
                      <span className="whitespace-nowrap">
                        {product.grossWeight}
                        <span className="font-normal ml-0.5"> gm gross</span>
                      </span>
                    )}
                    {product.grossWeight && product.netWeight && (
                      <span className="font-normal opacity-50">/</span>
                    )}
                    {product.netWeight && (
                      <span className="whitespace-nowrap">
                        {product.netWeight}
                        <span className="font-normal ml-0.5"> gm net</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Price */}
            <div className="bg-muted/30 border border-border/30 rounded-2xl px-5 py-4">
              <div className="flex items-end gap-3 mb-1">
                <span className="text-3xl font-bold text-foreground">₹{product.price}</span>
                {strikePrice && <span className="text-base text-muted-foreground line-through mb-0.5">₹{strikePrice}</span>}
                {effectiveDiscountPct > 0 && <span className="text-sm font-semibold text-green-600 mb-0.5">{effectiveDiscountPct}% off</span>}
              </div>
              <p className="text-xs text-muted-foreground">Inclusive of all taxes.</p>
            </div>

            {/* Qty + Add to Cart */}
            {(() => {
              const totalMax = product.availableQty != null ? product.availableQty : 999;
              const isInCart = currentCartQty > 0;
              // When in cart, the displayed qty IS the cart qty (real-time synced).
              // When not in cart, use local qty state.
              const displayQty = isInCart ? currentCartQty : qty;

              return (
                <div className="flex items-center gap-4">
                  <div className="flex items-center border border-border/40 rounded-full overflow-hidden">
                    <button
                      onClick={() => {
                        if (isInCart) {
                          updateQuantity(cartItem!.id, currentCartQty - 1);
                        } else {
                          setQty(q => Math.max(1, q - 1));
                        }
                      }}
                      className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="w-10 text-center font-semibold text-sm">{displayQty}</span>
                    <button
                      onClick={() => {
                        if (isInCart) {
                          updateQuantity(cartItem!.id, currentCartQty + 1);
                        } else {
                          setQty(q => Math.min(q + 1, totalMax));
                        }
                      }}
                      disabled={displayQty >= totalMax}
                      className="w-10 h-10 flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <Button
                    onClick={() => {
                      if (!customer) { openLoginModal(); return; }
                      if (!isInCart) {
                        addToCart(product, qty, true);
                      }
                    }}
                    disabled={isUnavailable || totalMax <= 0 || (isInCart && false)}
                    className="flex-1 h-11 rounded-full bg-primary hover:bg-primary/90 text-white font-semibold text-sm shadow-md"
                  >
                    {isUnavailable
                      ? "Out of Stock"
                      : isInCart
                      ? `In Cart — ₹${(product.price ?? 0) * currentCartQty}`
                      : `Add ${qty} to Cart — ₹${(product.price ?? 0) * qty}`}
                  </Button>
                </div>
              );
            })()}

            {/* Available Offers — collapsible (matches Order Summary styling) */}
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
                      description={c.description}
                      color={c.color}
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

        {/* ── Explore New Recipes — only shown when the admin has added recipes to this product ── */}
        {product.recipes && product.recipes.length > 0 && (
          <section className="mb-14">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                <Lottie animationData={recipesIconAnim} loop autoplay />
              </div>
              <h2 className="text-lg sm:text-xl font-medium text-foreground">Explore New Recipes</h2>
            </div>
            <div className="relative">
              <div ref={recipeScrollRef} className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x">
                {product.recipes.map((r, idx) => (
                  <div
                    key={idx}
                    className="min-w-[260px] sm:min-w-[280px] snap-start bg-card border border-border/30 rounded-2xl overflow-hidden hover:shadow-md transition-shadow flex flex-col cursor-pointer"
                    onClick={() => setLocation(`/recipe/product/${product.id}/${idx}`)}
                  >
                    <div className="relative w-full h-44 overflow-hidden bg-muted/20 flex items-center justify-center">
                      {r.image ? (
                        <img src={r.image} alt={r.title} className="w-full h-full object-cover transition-transform duration-500 hover:scale-105" />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-muted-foreground/40">
                          <ChefHat className="w-10 h-10" />
                        </div>
                      )}
                      {r.difficulty && (
                        <span className="absolute top-2 right-2 px-2.5 py-0.5 rounded-full font-semibold text-[11px] bg-[#F97316] text-white shadow-sm">
                          {r.difficulty}
                        </span>
                      )}
                    </div>
                    <div className="p-4 flex flex-col flex-1 gap-2">
                      <h4 className="font-medium text-base text-foreground leading-snug line-clamp-2">{r.title}</h4>
                      <p className="text-xs font-light text-muted-foreground leading-relaxed line-clamp-3 flex-1">{r.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {r.totalTime && (
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
                            {r.totalTime}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); setLocation(`/recipe/product/${product.id}/${idx}`); }}
                        className="mt-1 w-full text-sm font-semibold bg-accent text-white border border-accent rounded-full px-3 py-2 hover:bg-[#364F9F] hover:border-[#364F9F] hover:text-white transition-colors"
                      >
                        View Recipe
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <SwipeHint scrollRef={recipeScrollRef} />
            </div>
          </section>
        )}

        {/* ── Similar Products ── */}
        {recommended.length > 0 && (
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-14 h-14 sm:w-16 sm:h-16 shrink-0">
                <Lottie animationData={mayAlsoLikeAnim} loop autoplay />
              </div>
              <h2 className="text-lg sm:text-xl font-medium text-foreground">
                {sameCategory.length > 0 ? `More ${product.category}` : "You May Also Like"}
              </h2>
            </div>
            <div className="relative">
              <div
                ref={similarScrollRef}
                className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide snap-x"
              >
                {recommended.map((p) => (
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

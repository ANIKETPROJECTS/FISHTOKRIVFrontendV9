import { useEffect } from "react";
import { useRoute, useLocation, useSearch } from "wouter";
import { SeoHead, CATEGORY_SEO } from "@/components/SeoHead";
import { useQuery } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-products";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { ProductCard } from "@/components/storefront/ProductCard";
import { SwipeHint } from "@/components/storefront/SwipeHint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import type { Category } from "@shared/schema";
import { isNormalStorefrontProduct } from "@shared/productVisibility";

import fishImg from "@assets/Gemini_Generated_Image_w6wqkkw6wqkkw6wq_(1)_1772713077919.png";
import prawnsImg from "@assets/Gemini_Generated_Image_5xy0sd5xy0sd5xy0_1772713090650.png";
import chickenImg from "@assets/Gemini_Generated_Image_g0ecb4g0ecb4g0ec_1772713219972.png";
import muttonImg from "@assets/Gemini_Generated_Image_8fq0338fq0338fq0_1772713565349.png";
import masalaImg from "@assets/Gemini_Generated_Image_4e60a64e60a64e60_1772713888468.png";

function getFallbackImage(category: string) {
  switch (category) {
    case "Prawns": return prawnsImg;
    case "Chicken": return chickenImg;
    case "Mutton": return muttonImg;
    case "Masalas": return masalaImg;
    default: return fishImg;
  }
}

export default function CategoryPage() {
  const [, params] = useRoute("/category/:categoryName");
  const search = useSearch();
  const [, navigate] = useLocation();
  const { data: products, isLoading } = useProducts();
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const categoryName = params?.categoryName
    ? decodeURIComponent(params.categoryName)
    : "";

  const isAll = categoryName === "All";

  const searchParams = new URLSearchParams(search);
  const subFilter = searchParams.get("sub");
  const activeSub = subFilter ? decodeURIComponent(subFilter) : "All";

  const categoryProducts = isAll
    ? (products?.filter((p) => !p.isArchived && !p.batchExpired && isNormalStorefrontProduct(p)) || [])
    : (products?.filter((p) => !p.isArchived && !p.batchExpired && isNormalStorefrontProduct(p) && p.category === categoryName) || []);

  const currentCategory = categories.find((c) => c.name === categoryName);
  const subCategories = currentCategory?.subCategories ?? [];

  // Build the sub-categories that have at least one product (so we don't show empty ones)
  const subsWithProducts = subCategories.filter((sc) =>
    categoryProducts.some(
      (p) => p.subCategory?.toLowerCase() === sc.name.toLowerCase()
    )
  );

  const displayProducts =
    activeSub !== "All" && !isAll
      ? categoryProducts.filter(
          (p) => p.subCategory?.toLowerCase() === activeSub.toLowerCase()
        )
      : categoryProducts;

  // Clear stale ?sub= when its product no longer exists
  useEffect(() => {
    if (isAll || !subFilter || isLoading) return;
    if (subsWithProducts.length === 0) return;
    const exists = subsWithProducts.some(
      (sc) => sc.name.toLowerCase() === activeSub.toLowerCase()
    );
    if (!exists) {
      navigate(`/category/${encodeURIComponent(categoryName)}`, { replace: true });
    }
  }, [activeSub, subFilter, subsWithProducts, isAll, isLoading, categoryName, navigate]);

  const heroImage = getFallbackImage(categoryName);

  const handleSubClick = (subName: string) => {
    if (subName === "All") {
      navigate(`/category/${encodeURIComponent(categoryName)}`);
    } else {
      navigate(
        `/category/${encodeURIComponent(categoryName)}?sub=${encodeURIComponent(subName)}`
      );
    }
  };

  const catSeo = CATEGORY_SEO[categoryName] ?? null;

  return (
    <div className="min-h-screen bg-white flex flex-col font-sans">
      <SeoHead
        title={catSeo ? catSeo.title : `${categoryName} Online in Mumbai | Fresh & Hygienically Cut`}
        description={catSeo ? catSeo.description : `Buy fresh ${categoryName.toLowerCase()} online in Mumbai. Hygienically cleaned, cut & delivered same-day. Order now on FishTokri.`}
        canonical={`/category/${encodeURIComponent(categoryName)}`}
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          "itemListElement": [
            { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://fishtokri.com/" },
            { "@type": "ListItem", "position": 2, "name": categoryName, "item": `https://fishtokri.com/category/${encodeURIComponent(categoryName)}` },
          ],
        }}
      />
      <Header onSearch={() => {}} />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="rounded-full flex-shrink-0"
            data-testid="button-back-category"
          >
            <ChevronLeft className="w-6 h-6" />
          </Button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground leading-tight">
              {isAll ? "All Products" : categoryName}
            </h1>
            {!isLoading && (
              <p className="text-sm text-muted-foreground" data-testid="text-category-count">
                {displayProducts.length} item{displayProducts.length !== 1 ? "s" : ""} available
              </p>
            )}
          </div>
        </div>

        {/* Sub-category scrollable strip */}
        {!isAll && subsWithProducts.length > 0 && (
          <div className="mb-6 -mx-4 sm:mx-0">
            <div
              className="flex overflow-x-auto gap-6 sm:gap-7 scrollbar-hide snap-x px-4 sm:px-2 py-2"
              data-testid="strip-subcategories"
            >
              {/* "All" pill */}
              <button
                onClick={() => handleSubClick("All")}
                className="flex-none flex flex-col items-center gap-2 snap-start group min-w-[88px]"
                data-testid="subcategory-all"
              >
                <div
                  className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-slate-50 flex items-center justify-center transition-all duration-200 ${
                    activeSub === "All"
                      ? "ring-[3px] ring-accent ring-offset-2"
                      : "ring-1 ring-slate-200 group-hover:ring-slate-300"
                  }`}
                >
                  <img
                    src={heroImage}
                    alt="All"
                    className="w-full h-full object-cover"
                  />
                </div>
                <span
                  className={`text-sm sm:text-base whitespace-nowrap transition-colors ${
                    activeSub === "All"
                      ? "text-primary font-bold"
                      : "text-foreground/80 font-semibold group-hover:text-foreground"
                  }`}
                >
                  All
                </span>
              </button>

              {subsWithProducts.map((sc) => {
                const isActive = activeSub.toLowerCase() === sc.name.toLowerCase();
                const img = sc.imageUrl || heroImage;
                return (
                  <button
                    key={sc.name}
                    onClick={() => handleSubClick(sc.name)}
                    className="flex-none flex flex-col items-center gap-2 snap-start group min-w-[100px]"
                    data-testid={`subcategory-${sc.name.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <div
                      className={`w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden bg-slate-50 flex items-center justify-center transition-all duration-200 ${
                        isActive
                          ? "ring-[3px] ring-accent ring-offset-2"
                          : "ring-1 ring-slate-200 group-hover:ring-slate-300"
                      }`}
                    >
                      <img
                        src={img}
                        alt={sc.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <span
                      className={`text-sm sm:text-base whitespace-nowrap text-center transition-colors max-w-[120px] truncate ${
                        isActive
                          ? "text-primary font-bold"
                          : "text-foreground/80 font-semibold group-hover:text-foreground"
                      }`}
                    >
                      {sc.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <SwipeHint />
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 sm:gap-6">
          {isLoading
            ? [1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <Skeleton key={i} className="aspect-[3/4] rounded-3xl" />
              ))
            : displayProducts.length > 0
            ? displayProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))
            : (
                <div className="col-span-full py-20 text-center text-muted-foreground">
                  No products found in this category.
                </div>
              )}
        </div>
      </main>

      <CartDrawer />
      <Footer />
    </div>
  );
}

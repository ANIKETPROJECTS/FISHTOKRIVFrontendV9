import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Category, Product } from "@shared/schema";

import fishImg from "@assets/Gemini_Generated_Image_w6wqkkw6wqkkw6wq_(1)_1772713077919.png";
import prawnsImg from "@assets/Gemini_Generated_Image_5xy0sd5xy0sd5xy0_1772713090650.png";
import chickenImg from "@assets/Gemini_Generated_Image_g0ecb4g0ecb4g0ec_1772713219972.png";
import muttonImg from "@assets/Gemini_Generated_Image_8fq0338fq0338fq0_1772713565349.png";
import masalaImg from "@assets/Gemini_Generated_Image_4e60a64e60a64e60_1772713888468.png";
import menuIcon from "@assets/menu_1774777071510.png";
import bagIcon from "@/assets/bag-icon.png";
import { isNormalStorefrontProduct } from "@shared/productVisibility";

function getFallbackImage(category: string) {
  switch (category) {
    case "Prawns":
    case "Crab":
    case "Lobster":
      return prawnsImg;
    case "Chicken":
    case "Eggs":
      return chickenImg;
    case "Mutton":
    case "Mutton Keema":
      return muttonImg;
    case "Masalas":
      return masalaImg;
    default:
      return fishImg;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CategoryMenuDropdown({ open, onClose }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: allProducts = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const visibleCategories = categories.filter((c) => c.isActive);

  const activeCategoryName = activeCategory ?? "All";

  const activeProducts = activeCategoryName === "All"
    ? allProducts.filter((p) => !p.isArchived && !p.batchExpired && isNormalStorefrontProduct(p))
    : allProducts.filter((p) => !p.isArchived && !p.batchExpired && isNormalStorefrontProduct(p) && p.category === activeCategoryName);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const handleProductClick = (product: Product) => {
    onClose();
    navigate(`/product/${product.id}`);
  };

  const handleCategoryClick = (catName: string) => {
    setActiveCategory(catName);
  };

  const handleViewAll = (catName: string) => {
    onClose();
    navigate(`/category/${encodeURIComponent(catName)}`);
  };

  return (
    <div
      ref={ref}
      className="absolute top-full z-[100]
        left-0 right-0 border-t border-border/20 shadow-xl
        sm:left-auto sm:right-6 sm:w-[660px] sm:border sm:border-slate-200 sm:border-t sm:rounded-2xl sm:shadow-2xl"
      style={{ maxHeight: "75vh" }}
    >
      <div className="bg-white flex overflow-hidden h-full sm:rounded-2xl" style={{ maxHeight: "75vh" }}>
        {/* Left panel — categories from DB */}
        <div
          className="w-[52%] min-w-[160px] sm:w-56 flex-shrink-0 bg-slate-50 border-r border-slate-100 overflow-y-auto [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: "75vh", scrollbarWidth: "none" }}
        >
          {/* Virtual "All" entry */}
          <button
            onClick={() => handleCategoryClick("All")}
            onMouseEnter={() => setActiveCategory("All")}
            className={`w-full flex items-center gap-3 px-3 sm:px-4 py-3.5 sm:py-3.5 text-left transition-colors border-b border-slate-100/60 ${
              activeCategoryName === "All"
                ? "bg-white border-l-[3px] border-l-accent"
                : "hover:bg-white border-l-[3px] border-l-transparent"
            }`}
            data-testid="menu-category-all"
          >
            <div className="w-14 h-14 sm:w-14 sm:h-14 flex-shrink-0 flex items-center justify-center">
              <img src={bagIcon} alt="All" className="w-11 h-11 sm:w-11 sm:h-11 object-contain mix-blend-multiply" />
            </div>
            <span className={`text-base sm:text-base font-medium leading-tight ${activeCategoryName === "All" ? "text-foreground font-semibold" : "text-slate-700"}`}>
              All
            </span>
          </button>

          {visibleCategories.map((cat) => {
            const img = cat.imageUrl || getFallbackImage(cat.name);
            const isActive = cat.name === activeCategoryName;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryClick(cat.name)}
                onMouseEnter={() => setActiveCategory(cat.name)}
                className={`w-full flex items-center gap-3 px-3 sm:px-4 py-3.5 sm:py-3.5 text-left transition-colors border-b border-slate-100/60 ${
                  isActive
                    ? "bg-white border-l-[3px] border-l-accent"
                    : "hover:bg-white border-l-[3px] border-l-transparent"
                }`}
                data-testid={`menu-category-${cat.name.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="w-14 h-14 sm:w-14 sm:h-14 flex-shrink-0">
                  <img src={img} alt={cat.name} className="w-full h-full object-contain mix-blend-multiply" />
                </div>
                <span className={`text-base sm:text-base font-medium leading-tight ${isActive ? "text-foreground font-semibold" : "text-slate-700"}`}>
                  {cat.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right panel — actual products from DB */}
        <div
          className="flex-1 bg-white sm:bg-slate-50/50 p-4 sm:px-6 sm:py-4 overflow-y-auto [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight: "75vh", scrollbarWidth: "none" }}
        >
          {/* View All link for selected category */}
          <button
            onClick={() => handleViewAll(activeCategoryName)}
            className="w-full text-left text-xs font-semibold text-accent hover:underline mb-3 flex items-center gap-1"
          >
            View all in {activeCategoryName} →
          </button>

          {activeProducts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No products available.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-0">
              {activeProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleProductClick(product)}
                  className="text-left text-[15px] sm:text-base text-slate-700 hover:text-accent font-medium py-3.5 px-2 border-b border-slate-100 hover:bg-accent/5 sm:hover:bg-white rounded transition-colors"
                  data-testid={`menu-product-${product.id}`}
                >
                  {product.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { menuIcon };

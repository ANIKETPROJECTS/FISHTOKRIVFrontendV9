import { Helmet } from "react-helmet-async";

const CANONICAL_DOMAIN = "https://fishtokri.com";
const DEFAULT_OG_IMAGE = `${CANONICAL_DOMAIN}/og-default.png`;
const SITE_NAME = "FishTokri";

// ── Category SEO data (sourced from SEO brief) ──────────────────────────────
export const CATEGORY_SEO: Record<string, {
  title: string;
  description: string;
  intro: string;
  focusKeyword: string;
}> = {
  "Fish": {
    title: "Fish And Seafood Online in Mumbai | Fresh & Hygienically Cut",
    description: "Buy fresh fish and seafood online in Mumbai. Hygienically cleaned, cut & delivered same-day. 80+ varieties available. Order now on FishTokri.",
    intro: "Buy fresh fish and seafood online in Mumbai — pomfret, surmai, rawas, bombil, crabs and more, hygienically cleaned and cut, delivered same-day to your doorstep.",
    focusKeyword: "fish online Mumbai",
  },
  "Fish And Seafood": {
    title: "Fish And Seafood Online in Mumbai | Fresh & Hygienically Cut",
    description: "Buy fresh fish and seafood online in Mumbai. Hygienically cleaned, cut & delivered same-day. 80+ varieties available. Order now on FishTokri.",
    intro: "Buy fresh fish and seafood online in Mumbai — pomfret, surmai, rawas, bombil, crabs and more, hygienically cleaned and cut, delivered same-day to your doorstep.",
    focusKeyword: "fish online Mumbai",
  },
  "Prawns": {
    title: "Prawns Online in Mumbai | Fresh & Hygienically Cut",
    description: "Order fresh prawns online in Mumbai. Hygienically cleaned, cut & delivered same-day. 20+ varieties available. Order now on FishTokri.",
    intro: "Order fresh prawns online in Mumbai — jumbo, tiger, freshwater and seawater varieties, cleaned and ready to cook, delivered same-day.",
    focusKeyword: "prawns online Mumbai",
  },
  "Pomfret": {
    title: "Pomfret Fish Online in Mumbai | Fresh & Hygienically Cut",
    description: "Buy fresh silver pomfret and khapri pomfret online in Mumbai. Hygienically cleaned, cut & delivered same-day. 30+ varieties available. Order now on FishTokri.",
    intro: "Buy fresh silver pomfret and khapri pomfret (paplet) online in Mumbai, available whole or sliced in every size, hygienically cleaned and delivered same-day.",
    focusKeyword: "pomfret fish online Mumbai",
  },
  "Chicken": {
    title: "Chicken Online in Mumbai | Fresh & Hygienically Cut",
    description: "Order fresh chicken online in Mumbai. Hygienically cleaned, cut & delivered same-day. 10+ varieties available. Order now on FishTokri.",
    intro: "Order fresh chicken online in Mumbai — boneless, curry cut, lollipop, keema and more, delivered hygienically packed to your doorstep.",
    focusKeyword: "chicken online Mumbai",
  },
  "Mutton": {
    title: "Mutton Online in Mumbai | Fresh & Hygienically Cut",
    description: "Buy fresh goat mutton online in Mumbai. Hygienically cleaned, cut & delivered same-day. 8+ varieties available. Order now on FishTokri.",
    intro: "Buy fresh goat mutton online in Mumbai — curry cut, chops, boneless cubes and more, delivered fresh and hygienically packed.",
    focusKeyword: "mutton online Mumbai",
  },
  "Eggs": {
    title: "Eggs Online in Mumbai | Farm Fresh Delivery",
    description: "Order farm-fresh eggs online in Mumbai. Omega, power and desi eggs, delivered fresh to your doorstep. Order now on FishTokri.",
    intro: "Order farm-fresh eggs online in Mumbai — omega, power and desi eggs, delivered fresh to your doorstep.",
    focusKeyword: "eggs online Mumbai",
  },
  "Dry Fish": {
    title: "Dry Fish Online in Mumbai | Authentic & Fresh",
    description: "Buy authentic dry fish online in Mumbai. Dry bombil, dry prawns, dry kardi and more. Hygienically packed. Order now on FishTokri.",
    intro: "Buy authentic dry fish online in Mumbai — dry bombil, dry prawns (sode), dry kardi and more, sourced and packed for freshness.",
    focusKeyword: "dry fish online Mumbai",
  },
  "Ready To Cook": {
    title: "Ready To Cook Seafood Online in Mumbai | Marinated",
    description: "Order marinated, ready-to-cook fish, chicken and prawns online in Mumbai. Pre-marinated in Malvani and tandoori flavours. Order now on FishTokri.",
    intro: "Order marinated, ready-to-cook fish, chicken and prawns online in Mumbai — pre-marinated in authentic Malvani and tandoori flavours, ready for your pan.",
    focusKeyword: "ready to cook seafood online Mumbai",
  },
  "Masalas": {
    title: "Masala & Spices Online in Mumbai | Authentic Seafood Masala",
    description: "Buy authentic Malvani, Saraswat, CKP and Koli masalas online in Mumbai. Delivered fresh. Order now on FishTokri.",
    intro: "Buy authentic Malvani, Saraswat, CKP and Koli masalas online — the same spice blends used to marinate FishTokri's ready-to-cook range.",
    focusKeyword: "masala online Mumbai",
  },
  "Spices": {
    title: "Masala & Spices Online in Mumbai | Authentic Seafood Masala",
    description: "Buy authentic Malvani, Saraswat, CKP and Koli masalas online in Mumbai. Delivered fresh. Order now on FishTokri.",
    intro: "Buy authentic Malvani, Saraswat, CKP and Koli masalas online — the same spice blends used to marinate FishTokri's ready-to-cook range.",
    focusKeyword: "masala online Mumbai",
  },
  "Frozen Foods": {
    title: "Frozen Seafood Online in Mumbai | Hygienically Packed",
    description: "Order frozen seafood online in Mumbai, hygienically packed and delivered to your doorstep. Order now on FishTokri.",
    intro: "Order frozen seafood online in Mumbai, hygienically packed and delivered to your doorstep.",
    focusKeyword: "frozen seafood online Mumbai",
  },
};

// ── Types ────────────────────────────────────────────────────────────────────
interface SeoHeadProps {
  /** Page-specific title (suffix "| FishTokri" is added automatically) */
  title?: string;
  description?: string;
  /** Path only, e.g. "/category/Fish" */
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "product";
  /** One or more JSON-LD schema objects */
  jsonLd?: object | object[];
  noIndex?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function SeoHead({
  title,
  description,
  canonical,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
  jsonLd,
  noIndex = false,
}: SeoHeadProps) {
  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : `Fresh Fish, Seafood, Chicken & Mutton Online in Mumbai | ${SITE_NAME}`;
  const fullDescription =
    description ||
    "Order 100% fresh fish, seafood, chicken & mutton online in Mumbai. Hygienically cut, cleaned & delivered to your doorstep. 60+ varieties. Free delivery above ₹500. Order now on FishTokri.";
  const canonicalUrl = canonical
    ? `${CANONICAL_DOMAIN}${canonical}`
    : CANONICAL_DOMAIN;

  // Merge multiple schemas into a @graph block to avoid duplicate script tags
  const schemas = jsonLd ? (Array.isArray(jsonLd) ? jsonLd : [jsonLd]) : [];
  const ldJson =
    schemas.length === 0
      ? null
      : schemas.length === 1
      ? schemas[0]
      : { "@context": "https://schema.org", "@graph": schemas };

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={fullDescription} />
      <link rel="canonical" href={canonicalUrl} />
      {noIndex && <meta name="robots" content="noindex, follow" />}
      {/* Open Graph */}
      <meta property="og:type" content={ogType} />
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={fullDescription} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:site_name" content={SITE_NAME} />
      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={fullDescription} />
      <meta name="twitter:image" content={ogImage} />
      {/* JSON-LD */}
      {ldJson && (
        <script type="application/ld+json">{JSON.stringify(ldJson)}</script>
      )}
    </Helmet>
  );
}

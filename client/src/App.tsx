import { Switch, Route, useLocation } from "wouter";
import { useEffect, useRef } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CartProvider } from "@/context/CartContext";
import { CustomerProvider } from "@/context/CustomerContext";
import { HubProvider } from "@/context/HubContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/storefront/Home";
import ProductDetail from "@/pages/storefront/ProductDetail";
import CategoryPage from "@/pages/storefront/CategoryPage";
import RecipeDetail from "@/pages/storefront/RecipeDetail";
import Profile from "@/pages/storefront/Profile";
import ComboDetail from "@/pages/storefront/ComboDetail";
import CombosPage from "@/pages/storefront/CombosPage";
import AddAddress from "@/pages/storefront/AddAddress";
import { PolicyPage } from "@/pages/storefront/PolicyPage";
import Login from "@/pages/admin/Login";
import Dashboard from "@/pages/admin/Dashboard";
import Products from "@/pages/admin/Products";
import Orders from "@/pages/admin/Orders";
import SectionsAdmin from "@/pages/admin/Sections";
import AdminLayout from "@/components/admin/AdminLayout";
import { trackMetaEvent } from "@/lib/metaPixel";

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location]);
  return null;
}

function MetaPixelPageViews() {
  const [location] = useLocation();
  const previousLocation = useRef(location);

  useEffect(() => {
    if (previousLocation.current === location) return;
    previousLocation.current = location;
    trackMetaEvent("PageView");
  }, [location]);

  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/profile" component={Profile} />
      <Route path="/category/:categoryName" component={CategoryPage} />
      <Route path="/product/:id" component={ProductDetail} />
      <Route path="/recipe/product/:productId/:recipeIndex" component={RecipeDetail} />
      <Route path="/recipe/:category/:index" component={RecipeDetail} />
      <Route path="/combos" component={CombosPage} />
      <Route path="/combo/:id" component={ComboDetail} />
      <Route path="/add-address" component={AddAddress} />
      <Route path="/terms" component={() => <PolicyPage policy="terms" />} />
      <Route path="/privacy" component={() => <PolicyPage policy="privacy" />} />
      <Route path="/refund-policy" component={() => <PolicyPage policy="refund" />} />
      <Route path="/faq" component={() => <PolicyPage policy="faq" />} />
      <Route path="/admin/login" component={Login} />

      <Route path="/admin" component={() => (
        <AdminLayout><Dashboard /></AdminLayout>
      )} />

      <Route path="/admin/products" component={() => (
        <AdminLayout><Products /></AdminLayout>
      )} />

      <Route path="/admin/orders" component={() => (
        <AdminLayout><Orders /></AdminLayout>
      )} />

      <Route path="/admin/sections" component={() => (
        <AdminLayout><SectionsAdmin /></AdminLayout>
      )} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <HubProvider>
        <CustomerProvider>
          <CartProvider>
            <TooltipProvider>
              <Toaster />
              <ScrollToTop />
              <MetaPixelPageViews />
              <Router />
            </TooltipProvider>
          </CartProvider>
        </CustomerProvider>
      </HubProvider>
    </QueryClientProvider>
    </HelmetProvider>
  );
}

export default App;

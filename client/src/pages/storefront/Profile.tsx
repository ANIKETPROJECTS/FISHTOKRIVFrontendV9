import { useState, useEffect, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useProducts } from "@/hooks/use-products";
import Lottie from "lottie-react";
import { Header } from "@/components/storefront/Header";
import { Footer } from "@/components/storefront/Footer";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import scooterImg from "@assets/animation-original_(51)_1779950354153.png";
import whatsappIcon from "@assets/logo_(16)_1779950540352.png";
import callIcon from "@assets/call_(2)_1779950579819.png";
import logoutAnim from "@/assets/lottie/logout.json";
import walletIconImg from "@assets/wallet-filled-money-tool_1779874392752.png";
import logoutPopupAnim from "@/assets/lottie/logout-fish.json";
import searchImg from "@assets/search-interface-symbol_1774706690468.png";
import emptyAddressAnim from "@/assets/lottie/empty-address.json";
import iconHomeImg from "@assets/home_1776927604826.png";
import iconEditImg from "@assets/edit_1776927607777.png";
import iconBinImg from "@assets/bin_1776927610776.png";
import orderIconImg from "@/assets/order-icon.png";
import trackPlacedImg from "@/assets/track-placed.png";
import trackConfirmedImg from "@/assets/track-confirmed.png";
import trackDeliveryImg from "@/assets/track-delivery.png";
import trackDeliveredImg from "@/assets/track-delivered.png";
import invoiceImg from "@/assets/invoice.png";
import pdfIconImg from "@assets/pdf_(1)_1779891354459.png";
import iconBriefcaseImg from "@assets/briefcase_1776927648499.png";
import headerUserImg from "@assets/user_(1)_1774707188827.png";
import headerCartImg from "@assets/shopping-bag_1774706595493.png";
import headerLocationImg from "@assets/placeholder_(1)_1774706943633.png";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useCustomer } from "@/context/CustomerContext";
import { useHub } from "@/context/HubContext";
import { OtpModal } from "@/components/storefront/OtpModal";
import { CartDrawer } from "@/components/storefront/CartDrawer";
import { apiRequest } from "@/lib/queryClient";
import type { Customer, CustomerAddress, OrderRequest, Product } from "@shared/schema";
import fishImg from "@assets/Gemini_Generated_Image_w6wqkkw6wqkkw6wq_(1)_1772713077919.png";
import prawnsImg from "@assets/Gemini_Generated_Image_5xy0sd5xy0sd5xy0_1772713090650.png";
import chickenImg from "@assets/Gemini_Generated_Image_g0ecb4g0ecb4g0ec_1772713219972.png";
import muttonImg from "@assets/Gemini_Generated_Image_8fq0338fq0338fq0_1772713565349.png";
import masalaImg from "@assets/Gemini_Generated_Image_4e60a64e60a64e60_1772713888468.png";
import {
  User, MapPin, Plus, Pencil, Trash2,
  CheckCircle2, ChevronLeft, Home, Briefcase, Tag, Navigation,
  ShoppingBag, Clock, Truck, PackageCheck, ChevronDown, ChevronUp,
  Receipt, Package, AlertCircle, LogOut, LayoutGrid, List,
  Search, X, ChevronRight, Navigation2
} from "lucide-react";

function getFallbackImage(category: string): string {
  switch (category) {
    case "Prawns": return prawnsImg;
    case "Chicken": return chickenImg;
    case "Mutton": return muttonImg;
    case "Masalas": return masalaImg;
    default: return fishImg;
  }
}

const TYPE_OPTIONS = [
  { value: "house" as const, iconImg: iconHomeImg, label: "House" },
  { value: "office" as const, iconImg: iconBriefcaseImg, label: "Office" },
  { value: "other" as const, iconImg: null, label: "Other" },
];

const addressTypeColors: Record<string, string> = {
  house: "bg-pink-100 text-pink-700",
  office: "bg-purple-100 text-purple-700",
  other: "bg-amber-100 text-amber-700",
};

type EmptyAddress = Omit<CustomerAddress, "id">;
const emptyAddress: EmptyAddress = {
  name: "", phone: "", building: "", street: "", area: "",
  pincode: "", type: "house", label: "Home", instructions: "",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode; bgColor?: string }> = {
  pending:          { label: "Order Placed",      color: "text-white border-transparent", icon: null, bgColor: "#F97316" },
  confirmed:        { label: "Confirmed",          color: "text-white border-transparent", icon: null, bgColor: "#364F9F" },
  out_for_delivery: { label: "Out for Delivery",   color: "text-white border-transparent", icon: null, bgColor: "#F97316" },
  delivered:        { label: "Delivered",          color: "text-white border-transparent", icon: null, bgColor: "#22C55E" },
  cancelled:        { label: "Cancelled",          color: "text-white border-transparent", icon: null, bgColor: "#EF4444" },
};

function formatOrderId(mongoId: string): string {
  try {
    const timestampSec = parseInt(String(mongoId).slice(0, 8), 16);
    const d = new Date(timestampSec * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const suffix = String(mongoId).slice(-4).toUpperCase();
    return `FT-${yyyy}${mm}${dd}-${suffix}`;
  } catch {
    return String(mongoId);
  }
}

function getDisplayOrderId(order: { id: string; orderId?: string | null }): string {
  if (order.orderId) return order.orderId.replace(/^#+/, "");
  return formatOrderId(String(order.id));
}

interface OrderItem {
  productId: string | number;
  quantity: number;
  name: string;
  price: number;
  imageUrl?: string | null;
}

const TABS = ["Profile & Addresses", "My Orders"] as const;
type Tab = typeof TABS[number];
type OrdersSubTab = "current" | "previous";

const ORDERS_PER_PAGE = 5;

function isExpressOrder(order: OrderRequest) {
  if (order.isExpress) return true;
  if (order.scheduleType === "express" || order.scheduleType === "instant") return true;
  const label = (order.timeslotLabel ?? "").toLowerCase();
  return label.includes("porter") || label.includes("instant") || label.includes("express");
}

function getOrderTotal(order: OrderRequest) {
  if (order.total != null) return order.total;
  const items: OrderItem[] = Array.isArray(order.items) ? order.items as OrderItem[] : [];
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const deliveryCharge = order.deliveryCharge != null
    ? order.deliveryCharge
    : (order.slotCharge ?? 0);
  const totalDiscount = (order.discount ?? 0) + (order.extraDiscount ?? 0);
  return subtotal + deliveryCharge - totalDiscount;
}

const TRACK_STEPS = [
  { status: "pending",          label: "Order Placed",      desc: "We've received your order",       img: trackPlacedImg },
  { status: "confirmed",        label: "Confirmed",          desc: "Store confirmed your order",       img: trackConfirmedImg },
  { status: "out_for_delivery", label: "Out for Delivery",  desc: "Your order is on the way",         img: trackDeliveryImg },
  { status: "delivered",        label: "Delivered",          desc: "Order delivered successfully",     img: trackDeliveredImg },
];
const BRAND_RED_FILTER = "brightness(0) saturate(100%) invert(45%) sepia(89%) saturate(1620%) hue-rotate(331deg) brightness(99%) contrast(89%)";
const BRAND_BLUE_FILTER = "brightness(0) saturate(100%) invert(28%) sepia(48%) saturate(1517%) hue-rotate(212deg) brightness(91%) contrast(89%)";
const BRAND_ORANGE_FILTER = "brightness(0) saturate(100%) invert(63%) sepia(76%) saturate(1515%) hue-rotate(347deg) brightness(103%) contrast(96%)";
const TRACK_STATUS_ORDER = ["pending", "confirmed", "out_for_delivery", "delivered"];

function TrackOrderModal({ order, onClose }: { order: OrderRequest; onClose: () => void }) {
  const currentIdx = TRACK_STATUS_ORDER.indexOf(order.status);
  const isCancelled = order.status === "cancelled";
  const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <Navigation2 className="w-4 h-4 text-primary" />
                <p className="text-sm font-bold text-foreground">Track Order</p>
              </div>
              <p className="text-xs text-muted-foreground">#{getDisplayOrderId(order)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{date}</p>
            </div>
            <button onClick={onClose} className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-muted-foreground hover:bg-slate-200 transition-colors shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 py-5">
          {isCancelled ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle className="w-7 h-7 text-red-500" />
              </div>
              <p className="text-sm font-bold text-red-600">Order Cancelled</p>
              <p className="text-xs text-muted-foreground text-center">This order has been cancelled.</p>
            </div>
          ) : (
            <div className="space-y-0">
              {TRACK_STEPS.map((step, idx) => {
                const isDone = idx < currentIdx;
                const isCurrent = idx === currentIdx;
                const isLast = idx === TRACK_STEPS.length - 1;

                return (
                  <div key={step.status} className="flex gap-4">
                    {/* Icon column */}
                    <div className="flex flex-col items-center">
                      <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
                        {isCurrent && step.status !== "delivered" ? (
                          <div
                            className="w-7 h-7 animate-pulse"
                            style={{
                              backgroundColor: "#F97316",
                              maskImage: `url(${step.img})`,
                              maskSize: "contain",
                              maskRepeat: "no-repeat",
                              maskPosition: "center",
                              WebkitMaskImage: `url(${step.img})`,
                              WebkitMaskSize: "contain",
                              WebkitMaskRepeat: "no-repeat",
                              WebkitMaskPosition: "center",
                            }}
                          />
                        ) : (
                          <img src={step.img} alt="" className="w-7 h-7 object-contain" style={{ filter: BRAND_BLUE_FILTER }} />
                        )}
                        {isCurrent && step.status !== "delivered" && (
                          <>
                            <span className="absolute inset-0 rounded-full ring-2 ring-orange-400/50" />
                            <span className="absolute inset-0 rounded-full ring-4 ring-orange-400/30 animate-ping" />
                          </>
                        )}
                      </div>
                      {!isLast && (
                        <div className={`w-0.5 flex-1 my-1 min-h-[28px] rounded-full transition-all ${
                          isDone ? "bg-primary" : "bg-slate-200"
                        }`} />
                      )}
                    </div>

                    {/* Content column */}
                    <div className={`pt-2 pb-6 ${isLast ? "pb-2" : ""}`}>
                      <p className={`text-sm font-bold leading-none mb-1 ${
                        isDone ? "text-primary" : isCurrent ? "text-foreground" : "text-slate-300"
                      }`}>
                        {step.label}
                        {isCurrent && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            Current
                          </span>
                        )}
                      </p>
                      <p className={`text-xs ${isDone || isCurrent ? "text-muted-foreground" : "text-slate-300"}`}>{step.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 pt-0">
          <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
            <MapPin className="w-4 h-4 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">Delivering to</p>
              <p className="text-xs font-semibold text-foreground truncate">{order.address}, {order.deliveryArea}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const FISHTOKRI_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 325 815 160" style="height:38px;display:block;"><path fill="#f05c4e" d="M 77.949219 472.652344 L 100.703125 459.390625 L 123.460938 472.652344 L 123.460938 485.417969 L 100.703125 472.300781 L 77.949219 485.417969 Z M 58.382812 412.21875 C 59.042969 411.980469 68.5 405.875 68.964844 405.382812 C 68.011719 404.605469 67.03125 397.320312 66.9375 395.542969 C 66.742188 391.933594 67.273438 388.175781 68.140625 384.996094 C 69.695312 379.308594 72.789062 374.097656 76.890625 370 L 97.691406 349.195312 C 98.363281 348.527344 100.054688 346.667969 100.703125 346.28125 C 101.363281 346.671875 103.101562 348.585938 103.78125 349.265625 L 112.707031 358.1875 C 116.722656 362.203125 120.632812 366.121094 124.652344 370.132812 C 125.226562 370.707031 125.574219 371.199219 126.125 371.746094 C 129.253906 374.847656 132.152344 380.945312 133.355469 385.308594 C 134.914062 390.960938 134.875 397.859375 133.140625 403.570312 C 132.984375 404.085938 132.753906 405.382812 132.296875 405.65625 C 132.636719 406.074219 136.664062 408.570312 137.5 409.085938 C 138.421875 409.65625 139.296875 410.214844 140.199219 410.820312 C 140.785156 411.214844 142.351562 412.296875 142.9375 412.519531 C 143.121094 411.664062 143.765625 410.316406 144.085938 409.421875 C 145.226562 406.238281 146.03125 402.632812 146.40625 399.242188 C 147.582031 388.546875 145.136719 378.179688 139.558594 369.3125 C 138.328125 367.347656 136.617188 365.171875 135.128906 363.410156 C 134.84375 363.070312 134.390625 362.636719 134.074219 362.320312 C 128.492188 356.742188 123.011719 351.261719 117.429688 345.679688 C 114.625 342.875 111.914062 340.164062 109.109375 337.359375 L 100.703125 329.011719 C 100.125 329.421875 99.242188 330.417969 98.671875 330.984375 L 67.46875 362.1875 C 65.515625 364.132812 63.445312 366.863281 61.953125 369.148438 C 55.070312 379.699219 52.921875 393.679688 56.277344 406.03125 C 56.90625 408.34375 57.660156 410.128906 58.382812 412.21875 Z M 93.207031 373.460938 C 93.207031 378.058594 96.773438 381.488281 100.328125 381.488281 L 101.402344 381.488281 C 105.335938 381.488281 108.636719 377.773438 108.703125 373.867188 C 108.769531 369.882812 105.386719 366.058594 101.535156 366.058594 L 100.328125 366.058594 C 96.632812 366.058594 93.207031 369.789062 93.207031 373.460938 Z M 93.207031 373.460938 " fillRule="evenodd"/><path fill="#354f9f" d="M 17.777344 435.4375 L 32.675781 425.921875 L 55.410156 440.351562 L 77.941406 426.015625 L 100.707031 440.160156 L 123.257812 426.03125 L 145.515625 440.351562 L 168.253906 425.921875 L 183.535156 435.640625 L 179.207031 447.265625 L 168.25 439.992188 L 145.6875 454.390625 L 123.265625 440.042969 L 100.707031 454.394531 L 77.945312 440 L 54.984375 454.398438 L 32.65625 440 L 22.175781 447.015625 Z M 8.15625 410.320312 L 32.675781 394.65625 L 55.410156 409.089844 L 77.941406 394.75 L 100.707031 408.898438 L 123.257812 394.765625 L 145.515625 409.089844 L 168.253906 394.65625 L 193.257812 410.5625 L 188.816406 421.921875 L 168.25 408.714844 L 145.6875 423.125 L 123.265625 408.78125 L 100.707031 423.132812 L 77.945312 408.738281 L 54.984375 423.136719 L 32.65625 408.738281 L 12.523438 421.726562 Z M 8.15625 410.320312 " fillRule="evenodd"/><path fill="#354f9f" d="M 248.613281 383.648438 L 248.613281 378.21875 L 233.539062 378.21875 L 233.539062 372.089844 C 234.066406 367.539062 237.042969 365.261719 242.476562 365.261719 L 248.613281 365.261719 L 248.613281 346.003906 C 245.105469 345.476562 241.425781 345.300781 237.394531 345.300781 C 220.042969 345.300781 209.703125 352.304688 210.578125 369.988281 L 210.578125 465.066406 L 233.890625 465.066406 L 233.890625 395.378906 L 237.042969 395.378906 C 243.355469 395.378906 248.613281 389.949219 248.613281 383.648438 Z M 260.179688 346.003906 L 260.179688 364.210938 L 283.492188 364.210938 L 283.492188 357.382812 C 283.667969 349.855469 279.984375 346.003906 272.273438 346.003906 Z M 260.179688 372.441406 L 260.179688 465.066406 L 283.492188 465.066406 L 283.492188 383.648438 C 283.492188 376.117188 279.808594 372.441406 272.273438 372.441406 Z M 317.84375 434.597656 L 294.007812 434.597656 C 294.007812 445.277344 297.511719 453.332031 304.523438 458.585938 C 310.832031 464.015625 320.648438 466.816406 333.617188 466.816406 C 358.15625 466.816406 376.03125 458.410156 376.03125 435.648438 C 376.03125 429.347656 373.929688 423.742188 369.546875 419.191406 C 364.464844 414.464844 354.125 410.4375 338.351562 407.285156 C 326.257812 405.007812 320.296875 401.332031 320.296875 396.605469 C 320.296875 391.875 324.855469 389.425781 333.96875 389.425781 C 341.679688 389.425781 346.414062 391.703125 347.988281 395.726562 C 349.390625 399.40625 352.898438 401.332031 358.332031 401.507812 L 373.054688 401.507812 C 372.527344 391.875 368.847656 384.347656 362.011719 378.921875 C 355 373.667969 345.535156 371.039062 333.617188 371.039062 C 312.410156 371.390625 296.636719 380.84375 296.636719 400.804688 C 296.8125 415.339844 307.328125 424.445312 327.832031 428.121094 C 343.785156 430.921875 351.84375 434.773438 351.84375 439.5 C 351.84375 445.453125 346.9375 448.257812 337.121094 448.257812 C 325.730469 448.257812 318.371094 444.753906 317.84375 434.597656 Z M 448.59375 417.617188 L 448.59375 465.066406 L 471.730469 465.066406 L 471.730469 411.3125 C 472.429688 391.175781 466.296875 378.746094 453.328125 374.019531 C 435.976562 367.890625 421.429688 371.742188 409.507812 385.398438 L 409.507812 357.734375 C 409.507812 350.03125 405.652344 346.003906 397.941406 346.003906 L 386.199219 346.003906 L 386.199219 465.066406 L 409.507812 465.066406 L 409.507812 417.617188 C 409.507812 403.433594 415.46875 391.875 429.316406 391.875 C 442.636719 391.875 448.59375 402.03125 448.59375 417.617188 Z M 520.980469 377.519531 L 520.980469 372.441406 L 506.960938 372.441406 L 506.960938 357.734375 C 506.960938 351.605469 501.875 346.003906 495.742188 346.003906 L 483.648438 346.003906 L 483.648438 447.203125 C 483.472656 457.535156 487.679688 462.964844 496.441406 463.839844 C 505.207031 464.714844 513.445312 464.714844 520.980469 464.015625 L 520.980469 446.328125 L 513.792969 446.328125 C 509.238281 446.328125 506.960938 444.230469 506.960938 440.375 L 506.960938 389.074219 L 509.414062 389.074219 C 515.898438 389.074219 520.980469 384.171875 520.980469 377.519531 Z M 572.160156 371.039062 C 544.117188 371.039062 530.09375 386.972656 530.09375 419.191406 C 530.09375 451.058594 544.117188 467.164062 572.160156 467.164062 C 600.203125 467.164062 614.398438 451.058594 614.398438 419.191406 C 614.398438 386.972656 600.203125 371.039062 572.160156 371.039062 Z M 572.160156 391.527344 C 584.078125 391.527344 590.035156 400.457031 590.035156 418.492188 C 589.863281 436.875 583.902344 446.328125 571.984375 446.328125 C 560.066406 446.328125 553.929688 437.226562 553.757812 419.191406 C 553.757812 400.804688 559.890625 391.527344 572.160156 391.527344 Z M 637.710938 346.003906 L 625.617188 346.003906 L 625.617188 465.066406 L 648.925781 465.066406 L 648.925781 431.273438 C 648.925781 428.820312 650.152344 427.246094 652.609375 426.71875 C 655.585938 426.71875 658.566406 429.347656 661.546875 434.597656 L 678.023438 465.066406 L 706.066406 465.066406 L 673.640625 410.085938 L 705.714844 375.769531 L 677.671875 375.769531 L 648.925781 408.6875 L 648.925781 357.382812 C 648.925781 351.253906 643.84375 346.003906 637.710938 346.003906 Z M 711.148438 465.066406 L 734.808594 465.066406 L 734.808594 416.914062 C 734.808594 403.433594 741.292969 396.605469 754.265625 396.605469 L 762.152344 396.605469 L 762.152344 372.441406 L 758.820312 372.441406 C 727.800781 372.441406 711.847656 387.324219 711.148438 417.265625 Z M 776.523438 346.003906 L 776.523438 364.210938 L 799.835938 364.210938 L 799.835938 357.382812 C 800.011719 349.855469 796.328125 346.003906 788.617188 346.003906 Z M 776.523438 372.441406 L 776.523438 465.066406 L 799.835938 465.066406 L 799.835938 383.648438 C 799.835938 376.117188 796.152344 372.441406 788.617188 372.441406 Z M 776.523438 372.441406 " fillRule="nonzero"/></svg>`;

function downloadInvoicePDF(order: OrderRequest, items: OrderItem[], subtotal: number, slotCharge: number, discount: number, total: number, date: string) {
  const orderId = getDisplayOrderId(order);
  const paymentStatusVal = (order as any).paymentStatus ?? "unpaid";
  const isPaid = paymentStatusVal === "paid";
  const isPartial = paymentStatusVal === "partial";
  const couponCode = (order as any).coupon?.code ?? "";
  const couponDiscount = (order as any).coupon?.discountAmount ?? 0;
  const extraDiscount = Math.max(0, discount - couponDiscount);
  const isInstant = isExpressOrder(order);
  const dbDeliveryCharge = (order as any).deliveryCharge;
  // Prefer admin-set deliveryCharge when explicitly present (even if 0), else slotCharge
  const effectiveCharge = dbDeliveryCharge != null ? (dbDeliveryCharge as number) : slotCharge;
  const porterCharge = isInstant ? effectiveCharge : 0;
  const deliveryFee = isInstant ? 0 : effectiveCharge;

  const payments: Array<{ mode: string; amount: number }> = (order as any).payments ?? [];
  const walletPaid = payments.filter(p => p.mode === "wallet").reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);

  const modes = payments.length > 0 ? [...new Set(payments.map(p => p.mode))] : [(order as any).paymentMethod ?? "cash"];
  const paymentMethod = (modes as string[]).map(m => m === "wallet" ? "Wallet Balance" : m === "upi" ? "UPI" : "Cash on Delivery").join(" + ");

  const statusLabel = isPaid ? "Paid" : isPartial ? "Partial" : "Unpaid";
  const statusColor = isPaid ? "#22c55e" : isPartial ? "#f59e0b" : "#ef4444";

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#1e293b;">${item.name}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:center;color:#64748b;">${item.quantity}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;color:#64748b;">₹${item.price.toLocaleString()}</td>
      <td style="padding:10px 6px;border-bottom:1px solid #f1f5f9;font-size:13px;text-align:right;font-weight:700;color:#1e293b;">₹${(item.price * item.quantity).toLocaleString()}</td>
    </tr>`).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <title>Invoice ${orderId}</title>
  <style>
    @page { margin: 0; size: A4; }
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; color:#1e293b; background:#fff; }
    .page { padding: 36px 40px; min-height: 100vh; }
    .header { display:flex; align-items:flex-start; justify-content:space-between; padding-bottom:18px; border-bottom:2.5px solid #364F9F; margin-bottom:22px; }
    .brand-block { display:flex; flex-direction:column; gap:2px; }
    .brand-sub { font-size:11px; color:#64748b; margin-top:4px; }
    .company-details { margin-top:8px; }
    .company-details p { font-size:11px; color:#475569; line-height:1.7; }
    .company-details .detail-label { font-weight:700; color:#1e293b; }
    .invoice-meta { text-align:right; }
    .invoice-meta .tax-label { font-size:10px; font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:#94a3b8; margin-bottom:4px; }
    .invoice-meta .id { font-size:15px; font-weight:800; color:#364F9F; }
    .invoice-meta .date { font-size:11px; color:#64748b; margin-top:3px; }
    .bill-box { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:16px 18px; margin-bottom:22px; }
    .bill-label { font-size:9px; font-weight:800; letter-spacing:1.5px; text-transform:uppercase; color:#94a3b8; margin-bottom:8px; }
    .bill-name { font-size:15px; font-weight:800; color:#1e293b; margin-bottom:3px; }
    .bill-detail { font-size:12px; color:#64748b; line-height:1.6; }
    table { width:100%; border-collapse:collapse; margin-bottom:0; }
    thead tr { background:#f8fafc; }
    thead tr th { font-size:9px; font-weight:800; letter-spacing:1.2px; text-transform:uppercase; color:#94a3b8; padding:10px 6px; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0; text-align:left; }
    thead tr th:not(:first-child) { text-align:center; }
    thead tr th:last-child, thead tr th:nth-child(3) { text-align:right; }
    .totals { margin-top:16px; border-top:1px solid #e2e8f0; padding-top:12px; }
    .t-row { display:flex; justify-content:space-between; font-size:13px; padding:4px 0; color:#64748b; }
    .t-row.discount { color:#16a34a; font-weight:600; }
    .t-row.wallet { color:#364F9F; font-weight:600; }
    .t-row.free { color:#16a34a; }
    .t-row.grand-total { font-size:15px; font-weight:800; color:#1e293b; border-top:2px solid #334155; padding-top:12px; margin-top:8px; }
    .divider { border:none; border-top:1px solid #e2e8f0; margin:16px 0; }
    .info-row { display:flex; justify-content:space-between; align-items:center; padding:7px 0; border-bottom:1px solid #f8fafc; font-size:13px; }
    .info-label { color:#64748b; }
    .info-val { font-weight:600; color:#1e293b; text-align:right; }
    .badge { font-size:11px; font-weight:800; padding:3px 12px; border-radius:99px; color:#fff; display:inline-block; }
    .notes-box { background:#364F9F; border-radius:8px; padding:12px 16px; margin-top:16px; }
    .notes-label { font-size:9px; font-weight:800; color:rgba(255,255,255,0.65); letter-spacing:1px; text-transform:uppercase; margin-bottom:4px; }
    .notes-text { font-size:12px; color:#fff; }
    .footer { margin-top:28px; padding-top:16px; border-top:1px solid #e2e8f0; text-align:center; }
    .footer-thank { font-size:13px; font-weight:700; color:#364F9F; margin-bottom:3px; }
    .footer-sub { font-size:10px; color:#94a3b8; }
    @media print { .page { padding: 28px 36px; } }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand-block">
      ${FISHTOKRI_LOGO_SVG}
      <div class="brand-sub">Fresh Seafood &amp; Meat &middot; Mumbai</div>
      <div class="company-details">
        <p><span class="detail-label">ADD :</span> Thane, Mumbai</p>
        <p><span class="detail-label">Mob No :</span> 9220200100</p>
        <p><span class="detail-label">GST No :</span> 27AAOCA7628P1ZT</p>
        <p><span class="detail-label">FSSAI :</span> 75050106800481</p>
      </div>
    </div>
    <div class="invoice-meta">
      <div class="tax-label">Tax Invoice</div>
      <div class="id">#${orderId}</div>
      <div class="date">${date}</div>
    </div>
  </div>

  <div class="bill-box">
    <div class="bill-label">Bill To</div>
    <div class="bill-name">${order.customerName}</div>
    <div class="bill-detail">${order.phone}<br/>${order.address}, ${order.deliveryArea}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center;">Qty</th>
        <th style="text-align:right;">Rate</th>
        <th style="text-align:right;">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="totals">
    <div class="t-row"><span>Subtotal</span><span>₹${subtotal.toLocaleString()}</span></div>
    <div class="t-row ${deliveryFee === 0 ? 'free' : ''}"><span>Delivery Fee</span><span>${deliveryFee === 0 ? 'FREE' : '₹' + deliveryFee.toLocaleString()}</span></div>
    ${porterCharge > 0 ? `<div class="t-row" style="color:#d97706;font-weight:600;"><span>Porter Charge</span><span>+₹${porterCharge.toLocaleString()}</span></div>` : ''}
    ${couponDiscount > 0 ? `<div class="t-row discount"><span>Coupon Discount${couponCode ? ` (${couponCode})` : ''}</span><span>−₹${couponDiscount.toLocaleString()}</span></div>` : ''}
    ${extraDiscount > 0 ? `<div class="t-row discount"><span>Extra Discount</span><span>−₹${extraDiscount.toLocaleString()}</span></div>` : ''}
    ${walletPaid > 0 ? `<div class="t-row wallet"><span>Wallet Balance Used</span><span>−₹${walletPaid.toLocaleString()}</span></div>` : ''}
    <div class="t-row grand-total"><span>Total</span><span>₹${Math.max(0, total - walletPaid).toLocaleString()}</span></div>
  </div>

  <hr class="divider"/>

  ${order.timeslotLabel ? `<div class="info-row"><span class="info-label">Delivery Slot</span><span class="info-val">${order.timeslotLabel}</span></div>` : ''}
  <div class="info-row"><span class="info-label">Payment Method</span><span class="info-val">${paymentMethod}</span></div>
  <div class="info-row" style="border-bottom:none;"><span class="info-label">Payment Status</span><span class="badge" style="background:${statusColor};">${statusLabel}</span></div>

  ${order.notes ? `<div class="notes-box"><div class="notes-label">Order Notes</div><div class="notes-text">${order.notes}</div></div>` : ''}

  <div class="footer">
    <div class="footer-thank">Thank you for shopping with FishTokri!</div>
    <div class="footer-sub">fishtokri.com &middot; Fresh Seafood &amp; Meat delivered to your door</div>
  </div>
</div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=700,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 500);
}

function OrderCard({ order, productImageMap }: { order: OrderRequest; productImageMap: Record<string, string> }) {
  const [expanded, setExpanded] = useState(false);
  const items: OrderItem[] = Array.isArray(order.items) ? order.items as OrderItem[] : [];
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const slotCharge = order.slotCharge ?? 0;
  const dbDeliveryCharge = order.deliveryCharge ?? 0;
  const isExpress = isExpressOrder(order);
  // Effective charge: prefer admin-set deliveryCharge when explicitly present (even if 0), else slotCharge
  const effectiveCharge = order.deliveryCharge != null ? dbDeliveryCharge : slotCharge;
  // Porter charge for express orders; delivery fee for regular orders
  const porterCharge = isExpress ? effectiveCharge : 0;
  const deliveryFee = isExpress ? 0 : effectiveCharge;
  // Discounts: coupon discount and extra discount are separate fields
  const couponDiscount = order.coupon?.discountAmount ?? 0;
  const extraDiscount = order.extraDiscount ?? 0;
  const discount = (order.discount ?? couponDiscount) + extraDiscount;
  const total = order.total ?? (subtotal + porterCharge + deliveryFee - couponDiscount - extraDiscount);
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  }) : "";
  const isCancelled = order.status === "cancelled";
  const currentStepIdx = TRACK_STATUS_ORDER.indexOf(order.status);

  return (
    <div className="bg-white rounded-2xl border border-border/50 shadow-sm overflow-hidden" data-testid={`card-order-${order.id}`}>
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-100">
        <div className="flex items-center gap-2.5 min-w-0">
          <img src={orderIconImg} alt="" className="w-7 h-7 object-contain flex-shrink-0" style={{ filter: "brightness(0) saturate(100%) invert(28%) sepia(48%) saturate(1517%) hue-rotate(212deg) brightness(91%) contrast(89%)" }} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">Order #{getDisplayOrderId(order)}</p>
            <p className="text-xs text-muted-foreground">{date}</p>
          </div>
        </div>
        <div
          className={`flex items-center gap-1 px-3 py-1 rounded-full border text-xs font-semibold shrink-0 ${status.color}`}
          style={status.bgColor ? { backgroundColor: status.bgColor } : undefined}
        >
          {status.icon}
          {status.label}
        </div>
      </div>

      <div className="px-4 py-3 space-y-2">
        {items.map((item, i) => {
          const resolvedImage = item.imageUrl || productImageMap[String(item.productId)] || getFallbackImage('');
          return (
          <div key={i} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img src={resolvedImage} alt={item.name} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-sm text-foreground truncate block">{item.name}</span>
                <span className="text-xs text-muted-foreground">Qty: {item.quantity}</span>
              </div>
            </div>
            <span className="text-sm font-semibold text-foreground shrink-0">₹{((item.price ?? 0) * item.quantity).toLocaleString()}</span>
          </div>
          );
        })}
      </div>

      <div className="px-4 pb-1 flex items-start gap-2">
        <img src={headerLocationImg} alt="" className="w-3.5 h-3.5 object-contain mt-0.5 shrink-0" />
        <p className="text-xs text-muted-foreground leading-relaxed">{order.address}, {order.deliveryArea}</p>
      </div>
      {order.timeslotLabel && (() => {
        const deliveryDate = (order as any).deliveryDate as string | null | undefined;
        const orderDay = order.createdAt ? new Date(order.createdAt).toISOString().slice(0, 10) : null;
        const isScheduledNextDay = deliveryDate && orderDay && deliveryDate !== orderDay;
        const dateLabel = isScheduledNextDay
          ? new Date(deliveryDate + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })
          : null;
        return (
          <div className="px-4 pb-3 flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <p className="text-xs text-muted-foreground">
              {dateLabel ? <span className="font-medium text-slate-600">{dateLabel} · </span> : null}
              {order.timeslotLabel}
            </p>
          </div>
        );
      })()}

      {!isCancelled && (
        <div className="px-4 pb-4">
          <div className="flex items-start justify-between gap-1">
            {TRACK_STEPS.map((step, idx) => {
              const isDone = idx < currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              const isLast = idx === TRACK_STEPS.length - 1;
              return (
                <div key={step.status} className="flex-1 flex flex-col items-center relative">
                  {!isLast && (
                    <div className={`absolute top-5 left-1/2 w-full h-0.5 ${isDone ? "bg-primary" : "bg-slate-200"}`} />
                  )}
                  <div className="relative z-10 w-10 h-10 flex items-center justify-center">
                    {isCurrent && step.status !== "delivered" ? (
                      <div
                        className="w-7 h-7 animate-pulse"
                        style={{
                          backgroundColor: "#F97316",
                          maskImage: `url(${step.img})`,
                          maskSize: "contain",
                          maskRepeat: "no-repeat",
                          maskPosition: "center",
                          WebkitMaskImage: `url(${step.img})`,
                          WebkitMaskSize: "contain",
                          WebkitMaskRepeat: "no-repeat",
                          WebkitMaskPosition: "center",
                        }}
                      />
                    ) : (
                      <img src={step.img} alt="" className="w-7 h-7 object-contain" style={{ filter: BRAND_BLUE_FILTER }} />
                    )}
                    {isCurrent && step.status !== "delivered" && (
                      <>
                        <span className="absolute inset-0 rounded-full ring-2 ring-orange-400/50" />
                        <span className="absolute inset-0 rounded-full ring-4 ring-orange-400/30 animate-ping" />
                      </>
                    )}
                  </div>
                  <p className={`mt-1.5 text-[10px] font-medium text-center leading-tight ${
                    isCurrent ? "text-foreground font-semibold" : "text-primary"
                  }`}>{step.label}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {isCancelled && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-100">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <p className="text-xs font-semibold text-red-600">This order was cancelled</p>
          </div>
        </div>
      )}

      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Total</span>
          <span className="text-base font-bold text-foreground">₹{total.toLocaleString()}</span>
        </div>
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
          data-testid={`button-invoice-${order.id}`}
        >
          <img src={invoiceImg} alt="" className="w-3.5 h-3.5 object-contain" style={{ filter: BRAND_RED_FILTER }} />
          {expanded ? "Hide Invoice" : "View Invoice"}
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-xs font-bold text-foreground uppercase tracking-widest">Tax Invoice</p>
                <p className="text-[11px] text-muted-foreground">FishTokri · Mumbai</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold text-foreground">#{getDisplayOrderId(order)}</p>
                <p className="text-[11px] text-muted-foreground">{date}</p>
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
              <p className="text-[11px] text-muted-foreground uppercase font-semibold tracking-wide">Bill To</p>
              <p className="text-sm font-semibold text-foreground">{order.customerName}</p>
              <p className="text-xs text-muted-foreground">{order.phone}</p>
              <p className="text-xs text-muted-foreground">{order.address}, {order.deliveryArea}</p>
            </div>

            <div>
              <div className="flex text-[11px] font-semibold text-muted-foreground uppercase tracking-wide pb-1.5 border-b border-slate-100">
                <span className="flex-1">Item</span>
                <span className="w-10 text-center">Qty</span>
                <span className="w-20 text-right">Rate</span>
                <span className="w-20 text-right">Amount</span>
              </div>
              <div className="space-y-0">
                {items.map((item, i) => (
                  <div key={i} className="flex items-center py-2 border-b border-slate-50 text-sm">
                    <span className="flex-1 text-foreground">{item.name}</span>
                    <span className="w-10 text-center text-muted-foreground">{item.quantity}</span>
                    <span className="w-20 text-right text-muted-foreground">₹{item.price.toLocaleString()}</span>
                    <span className="w-20 text-right font-semibold text-foreground">₹{(item.price * item.quantity).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>

            {(() => {
              const orderPayments: Array<{ mode: string; amount: number }> = (order as any).payments ?? [];
              const walletPaidAmt = orderPayments.filter(p => p.mode === "wallet").reduce((s, p) => s + (Number.isFinite(p.amount) ? p.amount : 0), 0);
              const paymentStatusVal = (order as any).paymentStatus ?? "unpaid";
              const isPaidVal = paymentStatusVal === "paid";
              const isPartialVal = paymentStatusVal === "partial";
              const paymentModes = orderPayments.length > 0 ? [...new Set(orderPayments.map(p => p.mode))] : [(order as any).paymentMethod ?? "cash"];
              const paymentMethodText = (paymentModes as string[]).map(m => m === "wallet" ? "Wallet Balance" : m === "upi" ? "UPI" : "Cash on Delivery").join(" + ");
              const statusBg = isPaidVal ? "bg-green-500" : isPartialVal ? "bg-amber-500" : "bg-red-500";
              const statusLabel = isPaidVal ? "Paid" : isPartialVal ? "Partial" : "Unpaid";
              return (
                <>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Subtotal</span><span>₹{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground">
                      <span>Delivery Fee</span>
                      <span>{deliveryFee === 0 ? <span className="text-green-600">FREE</span> : `₹${deliveryFee.toLocaleString()}`}</span>
                    </div>
                    {porterCharge > 0 && (
                      <div className="flex justify-between text-sm text-amber-600 font-medium">
                        <span>Porter Charge</span>
                        <span>+₹{porterCharge.toLocaleString()}</span>
                      </div>
                    )}
                    {couponDiscount > 0 && (
                      <div className="flex justify-between text-sm text-green-600 font-medium">
                        <span>Coupon Discount {(order as any).coupon?.code ? `(${(order as any).coupon.code})` : ""}</span>
                        <span>-₹{couponDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {extraDiscount > 0 && (
                      <div className="flex justify-between text-sm text-green-600 font-medium">
                        <span>Extra Discount</span>
                        <span>-₹{extraDiscount.toLocaleString()}</span>
                      </div>
                    )}
                    {walletPaidAmt > 0 && (
                      <div className="flex justify-between text-sm font-medium" style={{ color: "#364F9F" }}>
                        <span>Wallet Balance Used</span>
                        <span>-₹{walletPaidAmt.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold text-foreground pt-2 border-t border-slate-200">
                      <span>Total</span><span>₹{Math.max(0, total - walletPaidAmt).toLocaleString()}</span>
                    </div>
                    {order.timeslotLabel && (
                      <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100">
                        <span className="text-muted-foreground">Delivery Slot</span>
                        <span className="font-semibold text-foreground text-right">{order.timeslotLabel}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm pt-2 border-t border-slate-100">
                      <span className="text-muted-foreground">Payment Method</span>
                      <span className="font-semibold text-foreground">{paymentMethodText}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Payment Status</span>
                      <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full text-white ${statusBg}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </div>

                  {order.notes && (
                    <div className="rounded-lg p-2.5" style={{ backgroundColor: "#364F9F" }}>
                      <p className="text-[11px] font-semibold text-white mb-0.5">Order Notes</p>
                      <p className="text-xs text-white/90">{order.notes}</p>
                    </div>
                  )}
                  <p className="text-[11px] text-center text-muted-foreground pt-1">Thank you for shopping with FishTokri!</p>

                  <button
                    onClick={() => downloadInvoicePDF(order, items, subtotal, slotCharge, discount, total, date)}
                    className="w-full mt-3 flex items-center justify-center gap-2 py-2.5 rounded-full text-white text-sm font-semibold transition-colors"
                    style={{ backgroundColor: "#364F9F" }}
                    data-testid={`button-download-invoice-${order.id}`}
                  >
                    <img src={pdfIconImg} alt="" className="w-5 h-5 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
                    Download Invoice PDF
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderGridCard({ order, productImageMap }: { order: OrderRequest; productImageMap: Record<string, string> }) {
  const items: OrderItem[] = Array.isArray(order.items) ? order.items as OrderItem[] : [];
  const total = getOrderTotal(order);
  const status = STATUS_CONFIG[order.status] || STATUS_CONFIG.pending;
  const date = order.createdAt ? new Date(order.createdAt).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  }) : "";
  const time = order.createdAt ? new Date(order.createdAt).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit"
  }) : "";

  return (
    <div className="bg-white rounded-2xl border border-border/50 shadow-sm overflow-hidden flex flex-col" data-testid={`card-grid-order-${order.id}`}>
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Package className="w-3.5 h-3.5 text-primary" />
        </div>
        <div
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold ${status.color}`}
          style={status.bgColor ? { backgroundColor: status.bgColor } : undefined}
        >
          {status.label}
        </div>
      </div>

      <div className="px-3 pb-2 flex-1 space-y-1">
        <p className="text-[11px] font-bold text-foreground truncate">#{getDisplayOrderId(order)}</p>
        <p className="text-[10px] text-muted-foreground">{date} · {time}</p>
        <div className="pt-1 space-y-1.5">
          {items.slice(0, 2).map((item, i) => {
            const resolvedImage = item.imageUrl || productImageMap[String(item.productId)] || getFallbackImage('');
            return (
            <div key={i} className="flex items-center gap-1.5">
              <div className="w-7 h-7 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 border border-slate-200">
                <img src={resolvedImage} alt={item.name} className="w-full h-full object-cover" />
              </div>
              <p className="text-xs text-foreground truncate">
                <span className="text-muted-foreground">{item.quantity}×</span> {item.name}
              </p>
            </div>
            );
          })}
          {items.length > 2 && (
            <p className="text-[10px] text-muted-foreground">+{items.length - 2} more</p>
          )}
        </div>
      </div>

      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs font-bold text-foreground">₹{total.toLocaleString()}</span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <MapPin className="w-3 h-3" />
          <span className="truncate max-w-[70px]">{order.deliveryArea}</span>
        </div>
      </div>
    </div>
  );
}

interface OrderFilters {
  search: string;
  status: string;
}

type OrderSort = "newest" | "oldest" | "highest" | "lowest";

const emptyFilters: OrderFilters = { search: "", status: "" };

const STATUS_PILLS = [
  { value: "", label: "All" },
  { value: "pending", label: "Placed" },
  { value: "confirmed", label: "Confirmed" },
  { value: "out_for_delivery", label: "On the way" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

const SORT_OPTIONS: { value: OrderSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest amount" },
  { value: "lowest", label: "Lowest amount" },
];

function applyFilters(orders: OrderRequest[], filters: OrderFilters): OrderRequest[] {
  return orders.filter(order => {
    const items: OrderItem[] = Array.isArray(order.items) ? order.items as OrderItem[] : [];
    if (filters.status && order.status !== filters.status) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      const matchId = String(order.id).toLowerCase().includes(q);
      const matchItem = items.some(i => i.name.toLowerCase().includes(q));
      if (!matchId && !matchItem) return false;
    }
    return true;
  });
}

function applySorting(orders: OrderRequest[], sort: OrderSort): OrderRequest[] {
  return [...orders].sort((a, b) => {
    if (sort === "newest" || sort === "oldest") {
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return sort === "newest" ? db - da : da - db;
    }
    const ta = getOrderTotal(a);
    const tb = getOrderTotal(b);
    return sort === "highest" ? tb - ta : ta - tb;
  });
}

export default function Profile() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { customer, isLoading: customerLoading, refetch, logout } = useCustomer();
  const { selectedSubHub } = useHub();
  const queryClient = useQueryClient();

  const search = useSearch();
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const params = new URLSearchParams(search);
    return params.get("tab") === "orders" ? "My Orders" : "Profile & Addresses";
  });
  const [ordersSubTab, setOrdersSubTab] = useState<OrdersSubTab>("current");
  const [otpModalOpen, setOtpModalOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const [editingProfile, setEditingProfile] = useState(false);
  const [draftProfile, setDraftProfile] = useState({ name: "", email: "", dateOfBirth: "" });

  const [showAddressForm, setShowAddressForm] = useState(false);
  const [editingAddress, setEditingAddress] = useState<CustomerAddress | null>(null);
  const [addressForm, setAddressForm] = useState<EmptyAddress>(emptyAddress);
  const [useAccountDetails, setUseAccountDetails] = useState(false);
  const [showUnserviceablePopup, setShowUnserviceablePopup] = useState(false);
  const [unserviceablePincode, setUnserviceablePincode] = useState("");

  const checkPincodeServiceability = (pincode: string): boolean => {
    if (pincode.length < 6 || !selectedSubHub?.pincodes?.length) return true;
    return !!selectedSubHub.pincodes.find(p => p.pincode === pincode);
  };

  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [filters, setFilters] = useState<OrderFilters>(emptyFilters);
  const [sort, setSort] = useState<OrderSort>("newest");
  const [currentPage, setCurrentPage] = useState(1);

  const hasActiveFilters = filters.search !== "" || filters.status !== "";

  const updateFilter = (key: keyof OrderFilters, value: string) => {
    setFilters(f => ({ ...f, [key]: value }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setCurrentPage(1);
  };

  useEffect(() => {
    if (customer) {
      setDraftProfile({
        name: customer.name || "",
        email: customer.email || "",
        dateOfBirth: customer.dateOfBirth || "",
      });
    }
  }, [customer]);

  useEffect(() => {
    setCurrentPage(1);
  }, [ordersSubTab]);

  const { data: orders = [], isLoading: ordersLoading } = useQuery<OrderRequest[]>({
    queryKey: ["/api/customer/me/orders"],
    queryFn: async () => {
      const res = await fetch("/api/customer/me/orders", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!customer && activeTab === "My Orders",
    refetchOnMount: true,
  });

  const { data: products = [] } = useProducts();

  const productImageMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const p of products) map[p.id] = p.imageUrl || getFallbackImage(p.category || '');
    return map;
  }, [products]);

  const currentOrders = useMemo(() => orders.filter(o => ["pending", "confirmed", "out_for_delivery"].includes(o.status)), [orders]);
  const previousOrders = useMemo(() => orders.filter(o => ["delivered", "cancelled"].includes(o.status)), [orders]);

  const activeOrders = ordersSubTab === "current" ? currentOrders : previousOrders;
  const filteredOrders = useMemo(() => applySorting(applyFilters(activeOrders, filters), sort), [activeOrders, filters, sort]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
  const paginatedOrders = filteredOrders.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);

  const updateProfileMutation = useMutation({
    mutationFn: (data: { name?: string | null; email?: string | null; dateOfBirth?: string | null }) =>
      apiRequest("PATCH", "/api/customer/me", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me"] });
      setEditingProfile(false);
      toast({ title: "Profile updated" });
    },
    onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
  });

  const addAddressMutation = useMutation({
    mutationFn: (data: EmptyAddress) => apiRequest("POST", "/api/customer/me/addresses", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me"] });
      cancelForm();
      toast({ title: "Address added" });
    },
    onError: () => toast({ title: "Failed to add address", variant: "destructive" }),
  });

  const updateAddressMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<EmptyAddress> }) =>
      apiRequest("PATCH", `/api/customer/me/addresses/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me"] });
      cancelForm();
      toast({ title: "Address updated" });
    },
    onError: () => toast({ title: "Failed to update address", variant: "destructive" }),
  });

  const deleteAddressMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/customer/me/addresses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customer/me"] });
      toast({ title: "Address removed" });
    },
    onError: () => toast({ title: "Failed to remove address", variant: "destructive" }),
  });

  const openAddForm = () => {
    setEditingAddress(null);
    const isFirstAddress = (customer?.addresses?.length || 0) === 0;
    setAddressForm({
      ...emptyAddress,
      name: isFirstAddress ? (customer?.name || "") : "",
      phone: isFirstAddress ? (customer?.phone || "") : "",
    });
    setUseAccountDetails(false);
    setShowAddressForm(true);
  };

  const openEditForm = (addr: CustomerAddress) => {
    setEditingAddress(addr);
    setAddressForm({
      name: addr.name, phone: addr.phone, building: addr.building,
      street: addr.street, area: addr.area, pincode: addr.pincode || "",
      type: addr.type, label: addr.label, instructions: addr.instructions,
    });
    setUseAccountDetails(false);
    setShowAddressForm(true);
  };

  const cancelForm = () => {
    setShowAddressForm(false);
    setEditingAddress(null);
    setAddressForm(emptyAddress);
    setUseAccountDetails(false);
  };

  const handleUseAccountDetails = (v: boolean) => {
    setUseAccountDetails(v);
    if (v) setAddressForm(f => ({
      ...f,
      name: customer?.name || "",
      phone: customer?.phone || "",
    }));
  };

  const saveAddress = () => {
    if (!addressForm.name || !addressForm.phone || !addressForm.building || !addressForm.area || !addressForm.pincode) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (!/^[6-9]\d{9}$/.test(addressForm.phone.trim())) {
      toast({ title: "Enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }
    if (!/^\d{6}$/.test(addressForm.pincode)) {
      toast({ title: "Please enter a valid 6-digit pincode", variant: "destructive" });
      return;
    }
    if (!checkPincodeServiceability(addressForm.pincode)) {
      setUnserviceablePincode(addressForm.pincode);
      setShowUnserviceablePopup(true);
      return;
    }
    const label = addressForm.type === "other"
      ? (addressForm.label || "Other")
      : addressForm.type === "house" ? "Home" : "Office";
    const entry = { ...addressForm, label };
    if (editingAddress) {
      updateAddressMutation.mutate({ id: editingAddress.id, data: entry });
    } else {
      addAddressMutation.mutate(entry);
    }
  };

  if (customerLoading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <Header />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          <Skeleton className="h-10 w-48 rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </main>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <Header />
        <main className="max-w-5xl mx-auto px-4 sm:px-6 py-16 flex flex-col items-center justify-center gap-6">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-10 h-10 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">Sign in to continue</h1>
            <p className="text-muted-foreground text-sm">Login with your mobile number to view your profile and orders.</p>
          </div>
          <Button
            onClick={() => setOtpModalOpen(true)}
            className="rounded-xl bg-primary text-white px-8 font-semibold"
            data-testid="button-login"
          >
            Login / Sign up
          </Button>
        </main>
        <OtpModal open={otpModalOpen} onClose={() => setOtpModalOpen(false)} />
      </div>
    );
  }

  const addresses = customer.addresses || [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <Header />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Back + Title (left) with Lottie animations (right) */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="rounded-full border border-border/50 bg-white shrink-0"
              data-testid="button-profile-back"
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-xl sm:text-2xl font-medium text-foreground tracking-tight truncate">My Profile</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0 bg-white border border-blue-100 rounded-2xl px-3 py-2 shadow-sm">
            <img
              src={walletIconImg}
              alt="Wallet"
              className="w-6 h-6 object-contain shrink-0"
              style={{ filter: BRAND_BLUE_FILTER }}
            />
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground font-medium leading-none mb-0.5 whitespace-nowrap">Fishtokri Wallet</p>
              <p className="text-sm font-bold leading-none whitespace-nowrap" style={{ color: "#364F9F" }}>
                ₹{(customer.walletBalance ?? 0).toLocaleString("en-IN")}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex mb-6 rounded-full p-1 border-2 border-black">
          {TABS.map(tab => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={isActive ? { backgroundColor: "#F05B4E" } : {}}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-full text-sm font-medium transition-all ${isActive ? "text-white shadow-sm" : "text-slate-700 hover:text-black"}`}
                data-testid={`tab-${tab.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {tab === "Profile & Addresses" && (
                  <img src={headerUserImg} alt="" className="w-4 h-4 object-contain" style={{ filter: isActive ? "brightness(0) invert(1)" : "brightness(0)" }} />
                )}
                {tab === "My Orders" && (
                  <img src={headerCartImg} alt="" className="w-4 h-4 object-contain" style={{ filter: isActive ? "brightness(0) invert(1)" : "brightness(0)" }} />
                )}
                {tab}
              </button>
            );
          })}
        </div>

        {/* ── Profile & Addresses Tab ── */}
        {activeTab === "Profile & Addresses" && (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <img src={headerUserImg} alt="" className="w-5 h-5 object-contain" />
                  <h2 className="text-base font-medium text-foreground">Profile Details</h2>
                </div>
                {!editingProfile && (
                  <Button
                    variant="ghost" size="icon"
                    onClick={() => {
                      setDraftProfile({ name: customer.name || "", email: customer.email || "", dateOfBirth: customer.dateOfBirth || "" });
                      setEditingProfile(true);
                    }}
                    className="w-7 h-7 rounded-full hover:bg-slate-100"
                    data-testid="button-edit-profile"
                  >
                    <img src={iconEditImg} alt="Edit" className="w-4 h-4 object-contain" style={{ filter: "brightness(0)" }} />
                  </Button>
                )}
              </div>

              {editingProfile ? (
                <div className="space-y-5">
                  {([
                    { field: "name" as const, label: "Full Name", placeholder: "Your name", type: "text" },
                    { field: "email" as const, label: "Email", placeholder: "you@example.com", type: "email" },
                  ] as const).map(({ field, label, placeholder, type }) => (
                    <div key={field} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{label}</Label>
                      <input
                        type={type}
                        value={draftProfile[field]}
                        onChange={e => setDraftProfile(p => ({ ...p, [field]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                        data-testid={`input-profile-${field}`}
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Date of Birth</Label>
                    <input
                      type="date"
                      value={draftProfile.dateOfBirth}
                      onChange={e => setDraftProfile(p => ({ ...p, dateOfBirth: e.target.value }))}
                      onClick={(e) => {
                        const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                        if (typeof el.showPicker === "function") el.showPicker();
                      }}
                      className="dob-input w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors cursor-pointer"
                      data-testid="input-profile-dob"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      className="flex-1 rounded-xl text-white hover:opacity-90"
                      style={{ backgroundColor: "#F05B4E" }}
                      onClick={() => setEditingProfile(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 rounded-xl text-white hover:opacity-90"
                      style={{ backgroundColor: "#364F9F" }}
                      disabled={updateProfileMutation.isPending}
                      onClick={() => {
                        if (draftProfile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draftProfile.email.trim())) {
                          toast({ title: "Enter a valid email address", variant: "destructive" });
                          return;
                        }
                        updateProfileMutation.mutate({
                          name: draftProfile.name || null,
                          email: draftProfile.email || null,
                          dateOfBirth: draftProfile.dateOfBirth || null,
                        });
                      }}
                      data-testid="button-save-profile"
                    >
                      {updateProfileMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {[
                    { label: "Phone", value: customer.phone, verified: true },
                    { label: "Name", value: customer.name },
                    { label: "Email", value: customer.email },
                    {
                      label: "Date of Birth",
                      value: customer.dateOfBirth
                        ? new Date(customer.dateOfBirth).toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" })
                        : null,
                    },
                  ].map(({ label, value, verified }) => (
                    <div key={label} className="py-3">
                      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                      <div className="flex items-center justify-between gap-2">
                        {value
                          ? <p className="font-medium text-foreground">{value}</p>
                          : <p className="font-normal italic text-muted-foreground text-sm">Not set</p>}
                        {verified && value && (
                          <span className="text-xs font-medium text-emerald-600 shrink-0">Verified</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Addresses section */}
            <div className="bg-white rounded-2xl border border-border/50 shadow-sm p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-2">
                  <img src={headerLocationImg} alt="" className="w-5 h-5 object-contain" />
                  <h2 className="text-base font-medium text-foreground">Saved Addresses</h2>
                </div>
                {!showAddressForm ? (
                  <Button
                    variant="ghost" size="sm"
                    onClick={openAddForm}
                    className="gap-1.5 rounded-xl text-xs hover:opacity-90"
                    style={{ color: "#364F9F" }}
                    data-testid="button-add-address"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Address
                  </Button>
                ) : null}
              </div>

              {showAddressForm && (
                <div className="space-y-3 mb-5 pb-5 border-b border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-foreground">{editingAddress ? "Edit Address" : "New Address"}</p>
                    <Button variant="ghost" size="icon" onClick={cancelForm} className="w-7 h-7 rounded-full text-muted-foreground">
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Pincode *</Label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={6}
                      value={addressForm.pincode}
                      onChange={e => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setAddressForm(f => ({ ...f, pincode: val }));
                        if (val.length === 6 && !checkPincodeServiceability(val)) {
                          setUnserviceablePincode(val);
                          setShowUnserviceablePopup(true);
                        }
                      }}
                      placeholder="400601"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-pincode"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Phone *</Label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={10}
                      value={addressForm.phone}
                      onChange={e => setAddressForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                      placeholder="10-digit mobile"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-phone"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Full Name *</Label>
                    <input
                      value={addressForm.name}
                      onChange={e => setAddressForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Recipient name"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-name"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Building / Flat No *</Label>
                    <input
                      value={addressForm.building}
                      onChange={e => setAddressForm(f => ({ ...f, building: e.target.value }))}
                      placeholder="Wing A, Flat 302, Building Name"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-building"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Street / Locality</Label>
                    <input
                      value={addressForm.street}
                      onChange={e => setAddressForm(f => ({ ...f, street: e.target.value }))}
                      placeholder="Street name or society"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-street"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Area / Suburb *</Label>
                    <input
                      value={addressForm.area}
                      onChange={e => setAddressForm(f => ({ ...f, area: e.target.value }))}
                      placeholder="e.g. Thane West"
                      className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                      data-testid="input-address-area"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Address Type</Label>
                    <div className="flex gap-2">
                      {TYPE_OPTIONS.map(opt => {
                        const selected = addressForm.type === opt.value;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setAddressForm(f => ({
                              ...f, type: opt.value,
                              label: opt.value === "house" ? "Home" : opt.value === "office" ? "Office" : f.label,
                            }))}
                            style={{ backgroundColor: selected ? "#364F9F" : "#F05B4E", borderColor: selected ? "#364F9F" : "#F05B4E" }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border text-white transition-all hover:opacity-90"
                            data-testid={`button-address-type-${opt.value}`}
                          >
                            {opt.iconImg && (
                              <img src={opt.iconImg} alt="" className="w-3.5 h-3.5 object-contain brightness-0 invert" />
                            )}
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    {addressForm.type === "other" && (
                      <Input
                        value={addressForm.label}
                        onChange={e => setAddressForm(f => ({ ...f, label: e.target.value }))}
                        placeholder='Custom label (e.g. "Parents Home")'
                        className="rounded-xl border-border/60 text-sm"
                        data-testid="input-address-custom-label"
                      />
                    )}
                  </div>
                  <div className="flex gap-2 pt-3">
                    <Button
                      onClick={cancelForm}
                      className="flex-1 rounded-xl text-white font-medium hover:opacity-90"
                      style={{ backgroundColor: "#F05B4E" }}
                      data-testid="button-cancel-address"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={saveAddress}
                      disabled={addAddressMutation.isPending || updateAddressMutation.isPending}
                      className="flex-1 rounded-xl text-white font-medium hover:opacity-90"
                      style={{ backgroundColor: "#364F9F" }}
                      data-testid="button-save-address"
                    >
                      {(addAddressMutation.isPending || updateAddressMutation.isPending) ? "Saving..." : editingAddress ? "Update Address" : "Save Address"}
                    </Button>
                  </div>
                </div>
              )}

              {addresses.length === 0 && !showAddressForm ? (
                <div className="flex flex-col items-center py-6 gap-2">
                  <Lottie
                    animationData={emptyAddressAnim}
                    loop
                    className="w-28 h-28"
                  />
                  <p className="text-sm text-muted-foreground text-center">No saved addresses yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {addresses.map((addr) => (
                    <div key={addr.id} className="py-3 first:pt-0 last:pb-0" data-testid={`card-address-${addr.id}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                          {(addr.type === "house" || addr.type === "office") && (
                            <div className="mt-0.5 shrink-0">
                              <img
                                src={addr.type === "house" ? iconHomeImg : iconBriefcaseImg}
                                alt=""
                                className="w-4 h-4 object-contain"
                                style={{ filter: "brightness(0)" }}
                              />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-sm text-foreground">{addr.name}</p>
                              <Badge className={`text-[10px] font-semibold px-2 py-0 h-4 ${addressTypeColors[addr.type] || "bg-slate-100 text-slate-600"}`}>{addr.label}</Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{addr.phone}</p>
                            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                              {[addr.building, addr.street, addr.area, addr.pincode].filter(Boolean).join(", ")}
                            </p>
                            {addr.instructions && (
                              <p className="text-[11px] text-muted-foreground/70 mt-1 italic">{addr.instructions}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="w-7 h-7 rounded-full hover:bg-slate-100" onClick={() => openEditForm(addr)} data-testid={`button-edit-address-${addr.id}`}>
                            <img src={iconEditImg} alt="Edit" className="w-4 h-4 object-contain" style={{ filter: "brightness(0)" }} />
                          </Button>
                          <Button
                            variant="ghost" size="icon"
                            className="w-7 h-7 rounded-full hover:bg-slate-100"
                            disabled={deleteAddressMutation.isPending}
                            onClick={() => deleteAddressMutation.mutate(addr.id)}
                            data-testid={`button-delete-address-${addr.id}`}
                          >
                            <img src={iconBinImg} alt="Delete" className="w-4 h-4 object-contain" style={{ filter: "brightness(0)" }} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Logout button — bottom of Profile & Addresses tab */}
            <button
              onClick={() => setLogoutConfirmOpen(true)}
              style={{ backgroundColor: "#F05B4E" }}
              className="w-full rounded-xl shadow-sm px-5 py-2.5 flex items-center justify-center gap-2 hover:opacity-90 transition-all"
              data-testid="button-logout"
            >
              <Lottie
                animationData={logoutAnim}
                loop
                className="w-6 h-6 shrink-0"
                style={{ filter: "brightness(0) invert(1)" }}
              />
              <span className="text-sm font-medium text-white">Logout</span>
            </button>
          </div>
        )}

        {/* ── My Orders Tab ── */}
        {activeTab === "My Orders" && (
          <div className="space-y-3">
            {/* Active / Previous sub-tabs */}
            <div className="flex rounded-full p-1 border-2 border-black">
              {(["current", "previous"] as OrdersSubTab[]).map(sub => {
                const isActive = ordersSubTab === sub;
                const count = sub === "current" ? currentOrders.length : previousOrders.length;
                return (
                  <button
                    key={sub}
                    onClick={() => setOrdersSubTab(sub)}
                    style={isActive ? { backgroundColor: "#364F9F" } : {}}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-full text-sm font-medium transition-all ${isActive ? "text-white shadow-sm" : "text-slate-700 hover:text-black"}`}
                    data-testid={`tab-orders-${sub}`}
                  >
                    {sub === "current" ? "Active" : "Previous"}
                    {count > 0 && (
                      <span
                        className="text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
                        style={isActive
                          ? { backgroundColor: "white", color: "#364F9F" }
                          : { backgroundColor: "#364F9F", color: "white" }}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search bar — same style as home screen */}
            <div className="relative">
              <img src={searchImg} alt="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 object-contain z-10" />
              <input
                type="search"
                value={filters.search}
                onChange={e => updateFilter("search", e.target.value)}
                placeholder="Search by order ID or item name…"
                className="w-full pl-10 pr-10 h-10 rounded-full bg-white border border-slate-200 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 text-sm transition-all"
                data-testid="input-filter-search"
              />
              {filters.search && (
                <button
                  onClick={() => updateFilter("search", "")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
                  data-testid="button-clear-search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Orders list */}
            {ordersLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center py-12 gap-3 bg-white rounded-2xl border border-border/50 shadow-sm">
                <ShoppingBag className="w-10 h-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {filters.search ? "No orders match your search" : ordersSubTab === "current" ? "No active orders" : "No previous orders"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredOrders.map(order => <OrderCard key={order.id} order={order} productImageMap={productImageMap} />)}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />

      {/* Logout confirmation dialog */}
      <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
        <AlertDialogContent className="rounded-3xl max-w-sm">
          <div className="flex justify-center -mt-2 mb-5">
            <Lottie animationData={logoutPopupAnim} loop className="w-28 h-28" />
          </div>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center text-lg font-medium" style={{ color: "#364F9F" }}>
              Logout from FishTokri?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-center text-sm">
              You'll need to login again to view your orders, addresses and continue shopping.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row gap-2 sm:gap-2 sm:justify-center mt-2">
            <AlertDialogCancel
              className="flex-1 mt-0 rounded-xl border-border/60 font-medium"
              data-testid="button-logout-cancel"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => { await logout(); navigate("/"); }}
              className="flex-1 rounded-xl text-white font-medium hover:opacity-90"
              style={{ backgroundColor: "#F05B4E" }}
              data-testid="button-logout-confirm"
            >
              Yes, Logout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CartDrawer />

      {/* Unserviceable pincode popup — same logic as cart drawer */}
      <Dialog open={showUnserviceablePopup} onOpenChange={setShowUnserviceablePopup}>
        <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden border-0 shadow-2xl" style={{ fontFamily: "'Poppins', sans-serif" }}>
          <div className="flex flex-col items-center px-6 pt-6 pb-7 text-center gap-0">
            <img src={scooterImg} alt="Delivery" className="w-36 h-auto object-contain mb-3" />
            <p className="text-base font-semibold text-slate-800 mb-1" style={{ fontWeight: 600 }}>
              We can still reach you! 🚚
            </p>
            <p className="text-sm text-slate-500 leading-relaxed mb-4" style={{ fontWeight: 400 }}>
              Online ordering isn't available for{" "}
              <span className="font-semibold text-slate-700">{unserviceablePincode}</span> yet, but we
              deliver via <span className="font-semibold text-slate-700">Porter</span> right to your doorstep.
            </p>
            <div className="w-full rounded-2xl px-4 py-3 mb-4 text-left" style={{ backgroundColor: "#EEF1FA" }}>
              <p className="text-xs font-semibold mb-0.5" style={{ color: "#364F9F" }}>
                📦 Outstation Delivery Available
              </p>
              <p className="text-xs text-slate-500 leading-relaxed" style={{ fontWeight: 400 }}>
                We ship in insulated cold-store boxes so your seafood &amp; meat arrives
                perfectly fresh, no matter the distance.
              </p>
            </div>
            <div className="w-full flex flex-col gap-2.5 mb-4">
              <a
                href={`https://wa.me/919220200100?text=${encodeURIComponent("Hi FishTokri! I'd like to place an order for outstation delivery.")}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-opacity hover:opacity-90 active:opacity-75"
                style={{ backgroundColor: "#25D366" }}
              >
                <img src={whatsappIcon} alt="WhatsApp" className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="text-left">
                  <p className="text-white text-xs font-semibold leading-none mb-0.5">Chat on WhatsApp</p>
                  <p className="text-white/90 text-xs font-normal">+91 92202 00100</p>
                </div>
              </a>
              <a
                href="tel:+919220200100"
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-opacity hover:opacity-90 active:opacity-75"
                style={{ backgroundColor: "#2196F3" }}
              >
                <img src={callIcon} alt="Call" className="w-7 h-7 rounded-full flex-shrink-0" />
                <div className="text-left">
                  <p className="text-white text-xs font-semibold leading-none mb-0.5">Call Us</p>
                  <p className="text-white/90 text-xs font-normal">+91 92202 00100</p>
                </div>
              </a>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

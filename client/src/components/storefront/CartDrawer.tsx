import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

import Lottie from "lottie-react";
import {
  CheckCircle2, Minus, Plus, ShoppingBag, Trash2,
  MapPin, Banknote, CreditCard, ChevronRight, ClipboardList,
  X, Home, Briefcase, Tag, Navigation, Loader2, AlertCircle, Search,
  Clock, Zap, Ticket, ChevronDown, ChevronUp
} from "lucide-react";
import popperAnim from "@/assets/lottie/popper.json";
import emptyAddressAnim from "@/assets/lottie/empty-address.json";
import orderSuccessAnim from "@/assets/lottie/order-success.json";
import confettiAnim from "@/assets/lottie/confetti.json";
import emptyCartBagAnim from "@/assets/lottie/empty-cart-bag.json";
import { FishTokriLogo } from "@/components/storefront/FishTokriLogo";
import iconWalletImg from "@assets/wallet_1776953301704.png";
import headerCartImg from "@assets/shopping-bag_1774706595493.png";
import iconBinImg from "@assets/bin_1776927610776.png";
import iconHomeTypeImg from "@assets/home_1776927604826.png";
import iconBriefcaseImg from "@assets/briefcase_1776927648499.png";
import iconShippingHomeImg from "@assets/home_1776927604826.png";
import iconTimeImg from "@assets/time_1776949603776.png";
import iconScheduleImg from "@assets/schedule_1777284518383.png";
import notesIconImg from "@/assets/notes.png";
import giftCardIconImg from "@/assets/gift-card.png";
import tagIconImg from "@/assets/tag.png";
import { useCart } from "@/context/CartContext";
import { useCreateOrder } from "@/hooks/use-orders";
import { useCustomer } from "@/context/CustomerContext";
import { useHub } from "@/context/HubContext";
import { useCoupons } from "@/hooks/use-coupons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getHubHeaders } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CustomerAddress, Timeslot, Coupon } from "@shared/schema";
import { isPreorderDateAvailable, normalizePreorderAvailability } from "@shared/preorderAvailability";
import { format } from "date-fns";

import noImageImg from "@assets/Gemini_Generated_Image_z60vyrz60vyrz60v_1782896627484.png";
import scooterImg from "@assets/animation-original_(51)_1779950354153.png";
import whatsappIcon from "@assets/logo_(16)_1779950540352.png";
import callIcon from "@assets/call_(2)_1779950579819.png";

const addressTypeColors: Record<string, string> = {
  house: "bg-blue-100 text-blue-700",
  office: "bg-purple-100 text-purple-700",
  other: "bg-amber-100 text-amber-700",
};

const TYPE_OPTIONS = [
  { value: "house" as const, iconImg: iconHomeTypeImg, icon: null, label: "House" },
  { value: "office" as const, iconImg: iconBriefcaseImg, icon: null, label: "Office" },
  { value: "other" as const, iconImg: null, icon: null, label: "Other" },
];

const emptyForm = {
  name: "", phone: "", building: "", street: "", area: "",
  pincode: "", type: "house" as "house" | "office" | "other",
  label: "", instructions: "",
};

interface PhotonFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    osm_id?: number;
    name?: string;
    street?: string;
    locality?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}

async function photonSearch(query: string): Promise<PhotonFeature[]> {
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lang=en&bbox=68.7,8.4,97.3,37.1`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.features ?? []).filter(
      (f: PhotonFeature) => f.properties.country === "India" || !f.properties.country
    );
  } catch {
    return [];
  }
}

function photonTitle(f: PhotonFeature): string {
  const p = f.properties;
  return p.name || p.locality || p.district || p.city || "";
}

function photonSubtitle(f: PhotonFeature): string {
  const p = f.properties;
  const parts: string[] = [];
  if (p.locality && p.locality !== photonTitle(f)) parts.push(p.locality);
  if (p.district && p.district !== photonTitle(f)) parts.push(p.district);
  if (p.city && p.city !== photonTitle(f)) parts.push(p.city);
  if (p.state) parts.push(p.state);
  return parts.slice(0, 3).join(", ");
}

function startOfTomorrow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(0, 0, 0, 0);
  return date;
}

const PREORDER_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dateFromKey(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatPreorderAvailability(item: any): string {
  const rule = normalizePreorderAvailability(item.preorderAvailability);
  if (rule.type === "all") return "Available on all future dates";
  if (rule.type === "weekdays") {
    const days = (rule.weekdays ?? [0, 1, 2, 3, 4, 5, 6])
      .map((day) => PREORDER_DAY_NAMES[day])
      .join(", ");
    return `Available on ${days}`;
  }
  if (rule.startDate && rule.endDate && rule.startDate === rule.endDate) {
    return `Available on ${format(dateFromKey(rule.startDate), "dd MMM yyyy")}`;
  }
  if (rule.startDate && rule.endDate) {
    return `Available from ${format(dateFromKey(rule.startDate), "dd MMM yyyy")} to ${format(dateFromKey(rule.endDate), "dd MMM yyyy")}`;
  }
  if (rule.startDate) return `Available from ${format(dateFromKey(rule.startDate), "dd MMM yyyy")}`;
  if (rule.endDate) return `Available until ${format(dateFromKey(rule.endDate), "dd MMM yyyy")}`;
  return "Available on all future dates";
}

export function CartDrawer() {
  const { isCartOpen, setIsCartOpen, items, updateQuantity, updateInstruction, totalPrice, clearCart, appliedCoupon, setAppliedCoupon, discountAmount, computeMaxQty } = useCart();
  const { mutate: createOrder, isPending } = useCreateOrder();
  const { customer } = useCustomer();
  const { selectedSubHub, isHubReady } = useHub();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [isSuccess, setIsSuccess] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const paymentSucceededRef = useRef(false);
  // Guards against a duplicate order: Razorpay's own `handler` callback and the
  // `visibilitychange` UPI-resume poll can BOTH detect the same successful payment
  // (e.g. the tab regains focus and fires visibilitychange slightly before/after
  // Razorpay's checkout.js internally confirms the payment and calls `handler`).
  // Whichever path gets here first synchronously flips this to true; the other
  // path checks it (with no `await` in between the check and the set, so it's
  // atomic in JS's single-threaded event loop) and bails out instead of also
  // calling createOrder for the same payment.
  const orderClaimedRef = useRef(false);
  // Mobile UPI return refs — store pending Razorpay order so we can poll when user comes back from GPay
  const pendingRzpOrderIdRef = useRef<string | null>(null);
  const pendingSelectedAddressRef = useRef<any>(null);
  const returningFromUpiRef = useRef(false);
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "online">("online");
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [showUnserviceablePopup, setShowUnserviceablePopup] = useState(false);
  const [unserviceablePincode, setUnserviceablePincode] = useState("");
  const [selectedTimeslotId, setSelectedTimeslotId] = useState<string | null>(null);
  const [expandedInstructions, setExpandedInstructions] = useState<Record<number, boolean>>({});
  const [useWallet, setUseWallet] = useState(false);

  // Coupon state
  const [couponInput, setCouponInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [showAllCoupons, setShowAllCoupons] = useState(false);
  const [couponExpanded, setCouponExpanded] = useState(false);
  const [timeslotExpanded, setTimeslotExpanded] = useState(false);
  const [isNextDay, setIsNextDay] = useState(false);
  const [selectedDeliveryDate, setSelectedDeliveryDate] = useState<Date>(startOfTomorrow);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [isApplyingCoupon, setIsApplyingCoupon] = useState(false);
  const [applyingCouponId, setApplyingCouponId] = useState<string | null>(null);

  const { data: allCoupons = [] } = useCoupons();

  // Per-user coupon usage from the server (only fetched when logged in and cart is open)
  const { data: userCouponUsage = {} } = useQuery<Record<string, { usedCount: number; limit: number; isExhausted: boolean; message: string }>>({
    queryKey: ["/api/coupons/user-usage"],
    enabled: isCartOpen && !!customer,
    staleTime: 0,
  });

  // Collect unique coupon IDs across all cart items
  const allCartCouponIds = [...new Set(items.flatMap(item => (item as any).couponIds ?? []))];
  const cartCoupons = allCoupons.filter(c => allCartCouponIds.includes(c.id));

  const isCouponExhausted = (c: Coupon) => !!customer && !!(userCouponUsage[c.code]?.isExhausted);
  const isCouponApplicable = (c: Coupon) => c.isActive && c.minOrderAmount <= totalPrice && !isCouponExhausted(c);

  // A coupon is visible to this customer if:
  // - applicableCustomers is empty (open to all), OR
  // - the logged-in customer's id is in the list
  const isCouponVisibleToCustomer = (c: Coupon) => {
    if (!c.applicableCustomers || c.applicableCustomers.length === 0) return true;
    if (!customer) return false;
    return c.applicableCustomers.includes(customer.id);
  };

  // Hide exhausted coupons, coupons not targeted at this customer, and coupons hidden from website
  const visibleCartCoupons = cartCoupons.filter(c => c.visibleOnWebsite !== false && !isCouponExhausted(c) && isCouponVisibleToCustomer(c));

  const validateCouponViaApi = async (code: string): Promise<{ valid: boolean; message: string }> => {
    const res = await fetch("/api/coupon/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getHubHeaders() },
      body: JSON.stringify({ couponCode: code, cartTotal: totalPrice, userId: customer?.phone ?? null }),
    });
    return res.json();
  };

  const applyCartCoupon = async (coupon: Coupon) => {
    // Check exhaustion first (client-side, from pre-fetched user usage)
    if (isCouponExhausted(coupon)) {
      setCouponError(userCouponUsage[coupon.code]?.message || "Coupon limit reached");
      return;
    }
    if (coupon.minOrderAmount > totalPrice) {
      const needed = coupon.minOrderAmount - totalPrice;
      setCouponError(`Add ₹${needed} more to your cart to use this coupon`);
      return;
    }
    setIsApplyingCoupon(true);
    setApplyingCouponId(coupon.id);
    setCouponError("");
    try {
      const result = await validateCouponViaApi(coupon.code);
      if (result.valid) {
        setAppliedCoupon(coupon);
        setCouponInput("");
      } else {
        const msg = result.message || "";
        const isUsageMsg = msg.toLowerCase().includes("usage limit") || msg.toLowerCase().includes("reached its");
        setCouponError(isUsageMsg ? "Invalid coupon code" : msg || "Coupon could not be applied");
      }
    } catch {
      setCouponError("Failed to validate coupon. Please try again.");
    } finally {
      setIsApplyingCoupon(false);
      setApplyingCouponId(null);
    }
  };

  const applyFromInput = async () => {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const coupon = cartCoupons.find(c => c.code === code);
    if (!coupon) {
      setCouponError("This code is not valid for items in your cart");
      return;
    }
    await applyCartCoupon(coupon);
  };

  // Clear coupon error when cart is opened (stale errors from previous sessions shouldn't persist)
  useEffect(() => {
    if (isCartOpen) {
      setCouponError("");
    }
  }, [isCartOpen]);

  // Clear coupon error when usage data refreshes and the applied/errored coupon is now valid
  useEffect(() => {
    if (!couponError || !userCouponUsage) return;
    // Find the coupon that caused the error (by checking if any cart coupon now shows not-exhausted)
    const allNowValid = cartCoupons.every(c => !userCouponUsage[c.code]?.isExhausted);
    if (allNowValid) setCouponError("");
  }, [userCouponUsage]);

  // Clear coupon input when cart is emptied
  useEffect(() => {
    if (items.length === 0) {
      setCouponError("");
      setCouponInput("");
    }
  }, [items.length]);

  const { data: timeslots = [], isLoading: timeslotsLoading } = useQuery<Timeslot[]>({
    queryKey: ["/api/timeslots"],
    enabled: isCartOpen,
  });

  // Convert a time string to a Date (handles both "21:30" 24h and "9:30 PM" 12h formats)
  const parseTimeStr = useCallback((timeStr: string): Date | null => {
    if (!timeStr) return null;
    const parts = timeStr.trim().split(" ");
    const [hStr, mStr] = parts[0].split(":");
    const period = parts[1]?.toUpperCase();
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return null;
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    // No AM/PM → treat as 24-hour (no conversion needed)
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }, []);

  // Format a 24h time string like "21:30" → "9:30 PM"
  const format24to12 = useCallback((timeStr: string | null): string => {
    if (!timeStr) return "";
    const [hStr, mStr] = timeStr.split(":");
    let h = parseInt(hStr, 10);
    const m = parseInt(mStr ?? "0", 10);
    if (isNaN(h) || isNaN(m)) return timeStr;
    // Already 12h with AM/PM suffix — return as-is
    if (timeStr.toLowerCase().includes("am") || timeStr.toLowerCase().includes("pm")) return timeStr;
    const period = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${period}`;
  }, []);

  // Build a human-readable time range for a slot (e.g. "9:30 PM – 10:00 PM")
  const getSlotTimeDisplay = useCallback((slot: Timeslot): string | null => {
    if (slot.isInstant) return null;
    if (slot.startTime && slot.endTime) {
      return `${format24to12(slot.startTime)} – ${format24to12(slot.endTime)}`;
    }
    return null;
  }, [format24to12]);

  // Extract start time string from a slot — supports both dedicated startTime field
  // and labels like "09:30 PM – 10:00 PM" or "21:30 - 22:00"
  const extractSlotStartTime = useCallback((slot: Timeslot): string | null => {
    if (slot.startTime) return slot.startTime;
    if (slot.label) {
      const match = slot.label.match(/^(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i);
      if (match) return match[1].trim();
    }
    return null;
  }, []);

  // Returns true if the slot is active on the given Date's day of week
  const isSlotActiveOnDay = useCallback((slot: Timeslot, date: Date): boolean => {
    if (!slot.activeDays || slot.activeDays.length === 0) return true; // no config = always on
    const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const dayName = dayNames[date.getDay()];
    const entry = slot.activeDays.find(d => d.day.toLowerCase() === dayName);
    return !entry || entry.status === "on";
  }, []);

  const isSlotAvailable = useCallback((slot: Timeslot): boolean => {
    if (slot.isInstant) return true;
    const now = new Date();
    // Hide slot if today's day is marked off
    if (!isSlotActiveOnDay(slot, now)) return false;
    // A slot is unavailable 30 minutes before its START time.
    const startStr = extractSlotStartTime(slot);
    if (startStr) {
      const startTime = parseTimeStr(startStr);
      if (startTime) {
        const cutoff = new Date(startTime.getTime() - 30 * 60 * 1000);
        if (now >= cutoff) return false;
      }
    }
    // Check today's order limit (always enforced when orderLimit > 0)
    if (slot.orderLimit > 0 && slot.todaysOrderCount >= slot.orderLimit) return false;
    return true;
  }, [parseTimeStr, extractSlotStartTime, isSlotActiveOnDay]);

  const isPreorderCart = items.some((item) => item.isPreorderCheckout);

  const getDateKey = useCallback((date: Date): string => (
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  ), []);

  const getAvailableTimeslotsForDate = useCallback((date: Date, isToday: boolean): Timeslot[] => {
    const dateKey = getDateKey(date);
    const tomorrowKey = getDateKey(startOfTomorrow());
    return timeslots.filter((slot) => {
      if (slot.isInstant) return isToday && isSlotActiveOnDay(slot, date) && isSlotAvailable(slot);
      if (!isSlotActiveOnDay(slot, date)) return false;
      if (slot.orderLimit > 0) {
        const orderCount =
          isToday ? slot.todaysOrderCount :
          dateKey === tomorrowKey ? slot.nextDayOrderCount :
          null;
        if (orderCount !== null && orderCount >= slot.orderLimit) return false;
      }
      if (isToday) {
        const startStr = extractSlotStartTime(slot);
        if (startStr) {
          const startTime = parseTimeStr(startStr);
          if (startTime) {
            const now = new Date();
            const cutoff = new Date(startTime.getTime() - 30 * 60 * 1000);
            if (now >= cutoff) return false;
          }
        }
      }
      return true;
    });
  }, [timeslots, isSlotAvailable, isSlotActiveOnDay, extractSlotStartTime, parseTimeStr, getDateKey]);

  const preorderItems = useMemo(
    () => items.filter((item) => item.isPreorderCheckout),
    [items],
  );

  const isPreorderProductDateAvailable = useCallback((date: Date): boolean => {
    const dateKey = getDateKey(date);
    return preorderItems.length > 0 &&
      preorderItems.every((item) => isPreorderDateAvailable(dateKey, item.preorderAvailability));
  }, [getDateKey, preorderItems]);

  const isPreorderDateSelectable = useCallback((date: Date): boolean => {
    if (!isPreorderProductDateAvailable(date)) return false;
    return getAvailableTimeslotsForDate(date, false).length > 0;
  }, [getAvailableTimeslotsForDate, isPreorderProductDateAvailable]);

  const firstValidPreorderDate = useMemo(() => {
    if (!isPreorderCart || preorderItems.length === 0) return startOfTomorrow();
    const candidate = startOfTomorrow();
    // Availability ranges are finite or weekday based. Search two years, which
    // avoids rendering a large set of calendar buttons while still finding the
    // next valid configured date.
    for (let index = 0; index < 730; index += 1) {
      if (isPreorderDateSelectable(candidate)) return new Date(candidate);
      candidate.setDate(candidate.getDate() + 1);
    }
    return null;
  }, [getAvailableTimeslotsForDate, isPreorderCart, isPreorderDateSelectable, preorderItems.length]);

  const availableTimeslots = getAvailableTimeslotsForDate(new Date(), true);
  const nextDayAvailableTimeslots = getAvailableTimeslotsForDate(
    new Date(new Date().setDate(new Date().getDate() + 1)),
    false,
  );
  const preorderAvailableTimeslots = getAvailableTimeslotsForDate(
    selectedDeliveryDate,
    getDateKey(selectedDeliveryDate) === getDateKey(new Date()),
  );
  const displayTimeslots = isPreorderCart
    ? preorderAvailableTimeslots
    : (isNextDay ? nextDayAvailableTimeslots : availableTimeslots);
  const selectedTimeslot = displayTimeslots.find(t => t.id === selectedTimeslotId) ?? null;

  useEffect(() => {
    if (selectedTimeslotId && !displayTimeslots.find(t => t.id === selectedTimeslotId)) {
      setSelectedTimeslotId(null);
    }
  }, [displayTimeslots, selectedTimeslotId]);

  useEffect(() => {
    if (!isPreorderCart) return;
    if (!firstValidPreorderDate) {
      setSelectedDeliveryDate(startOfTomorrow());
      setSelectedTimeslotId(null);
      return;
    }
    if (!isPreorderDateSelectable(selectedDeliveryDate)) {
      setSelectedDeliveryDate(firstValidPreorderDate);
      setSelectedTimeslotId(null);
    }
  }, [isPreorderCart, selectedDeliveryDate, firstValidPreorderDate, isPreorderDateSelectable]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(emptyForm);
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [geoFilling, setGeoFilling] = useState(false);
  const [geoFillStatus, setGeoFillStatus] = useState<"idle" | "success" | "error">("idle");
  const [geoFillMessage, setGeoFillMessage] = useState("");

  const [locSearch, setLocSearch] = useState("");
  const [locResults, setLocResults] = useState<PhotonFeature[]>([]);
  const [locSearching, setLocSearching] = useState(false);
  const [showLocDropdown, setShowLocDropdown] = useState(false);
  const locTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (locTimeoutRef.current) clearTimeout(locTimeoutRef.current);
    const q = locSearch.trim();
    if (q.length < 2) {
      setLocResults([]);
      setLocSearching(false);
      setShowLocDropdown(q.length > 0);
      return;
    }
    setLocSearching(true);
    setShowLocDropdown(true);
    locTimeoutRef.current = setTimeout(async () => {
      const results = await photonSearch(q);
      setLocResults(results);
      setLocSearching(false);
    }, 350);
    return () => { if (locTimeoutRef.current) clearTimeout(locTimeoutRef.current); };
  }, [locSearch]);

  const handleLocResultSelect = useCallback((feature: PhotonFeature) => {
    const p = feature.properties;

    // area fields: locality → district → city (never use p.name here — that's the place name)
    const area = p.locality || p.district || p.city || "";
    const pincode = p.postcode?.replace(/\s/g, "") || "";
    const street = p.street || "";

    // p.name is the specific named place (e.g. "Hubtown Greenwoods") → Building/Floor
    // Only use it if it's different from the derived area (i.e. it's a POI / complex name, not just a locality)
    const placeName = p.name && p.name !== area ? p.name : "";

    setAddForm(f => ({
      ...f,
      building: placeName || f.building,
      street: street || f.street,
      area: area || f.area,
      pincode: pincode || f.pincode,
    }));
    setLocSearch("");
    setLocResults([]);
    setShowLocDropdown(false);
    setGeoFillStatus("success");
    const summary = [placeName, street, area, pincode].filter(Boolean).join(", ");
    setGeoFillMessage(`Auto-filled: ${summary || "please verify the fields below"}`);
  }, []);

  const savedAddresses: CustomerAddress[] = customer?.addresses ?? [];

  const activeAddressId = selectedAddressId ?? (savedAddresses[0]?.id || null);

  // Pincode-based delivery charge and time delay from sub_hub config
  // When the add-address form is open and has a complete valid pincode, preview that pincode's
  // config in real-time so delivery fee and slot labels update as the user types.
  const pincodeConfig = useMemo(() => {
    if (!selectedSubHub?.pincodes?.length) return null;
    if (showAddForm && addForm.pincode.length === 6) {
      return selectedSubHub.pincodes.find(p => p.pincode === addForm.pincode) ?? null;
    }
    const selected = savedAddresses.find(a => a.id === activeAddressId);
    if (!selected?.pincode) return null;
    return selectedSubHub.pincodes.find(p => p.pincode === selected.pincode) ?? null;
  }, [activeAddressId, savedAddresses, selectedSubHub, showAddForm, addForm.pincode]);

  const pincodeDeliveryCharge = pincodeConfig?.charge ?? 0;
  const pincodeTimeDelay = pincodeConfig?.timeDelay ?? 0;

  // Helper: check if a pincode is unserviceable in the current hub
  const checkPincodeServiceability = useCallback((pincode: string): boolean => {
    if (pincode.length < 6 || !selectedSubHub?.pincodes?.length) return true;
    return !!selectedSubHub.pincodes.find(p => p.pincode === pincode);
  }, [selectedSubHub]);

  // Show popup when switching between existing saved addresses with unserviceable pincodes
  useEffect(() => {
    const selected = savedAddresses.find(a => a.id === activeAddressId);
    if (!selected?.pincode || selected.pincode.length < 6) return;
    if (!selectedSubHub?.pincodes?.length) return;
    const matched = selectedSubHub.pincodes.find(p => p.pincode === selected.pincode);
    if (!matched) {
      setUnserviceablePincode(selected.pincode);
      setShowUnserviceablePopup(true);
    }
  }, [activeAddressId, selectedSubHub]);

  // Add N minutes to a formatted time string and return 12h format
  const addMinutesToTime = useCallback((timeStr: string, minutes: number): string => {
    if (!timeStr || minutes === 0) return timeStr;
    const d = parseTimeStr(timeStr);
    if (!d) return timeStr;
    d.setMinutes(d.getMinutes() + minutes);
    let h = d.getHours();
    const m = d.getMinutes();
    const period = h >= 12 ? "PM" : "AM";
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, "0")} ${period}`;
  }, [parseTimeStr]);

  // Returns the slot label adjusted for pincode time delay (only end time shifts)
  const getAdjustedSlotLabel = useCallback((slot: Timeslot): string => {
    if (slot.isInstant || pincodeTimeDelay === 0) return slot.label;
    const start = slot.startTime ? format24to12(slot.startTime) : null;
    const end = slot.endTime ? format24to12(slot.endTime) : null;
    if (start && end) {
      return `${start} – ${addMinutesToTime(end, pincodeTimeDelay)}`;
    }
    return slot.label;
  }, [pincodeTimeDelay, format24to12, addMinutesToTime]);

  const getFallbackImage = (_category: string) => noImageImg;

  const openAddForm = () => {
    setAddForm({
      ...emptyForm,
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
    });
    setGeoFillStatus("idle");
    setGeoFillMessage("");
    setLocSearch("");
    setLocResults([]);
    setShowLocDropdown(false);
    setShowAddForm(true);
    setTimeout(() => locInputRef.current?.focus(), 250);
  };

  const handleAutoFillLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      setGeoFillStatus("error");
      setGeoFillMessage("Your browser doesn't support location detection.");
      return;
    }
    setGeoFilling(true);
    setGeoFillStatus("idle");

    // Same geolocation options as the header location picker for consistent accuracy
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        try {
          // Same Nominatim URL as the header – no zoom/accept-language params which cause inconsistency
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&addressdetails=1`,
            { headers: { "Accept-Language": "en" } }
          );
          const data = await res.json();
          const addr = data?.address ?? {};

          const pincode = addr.postcode?.replace(/\s/g, "") ?? "";

          // Same priority chain the header uses for postcode, extended for area/street fields
          const area =
            addr.suburb ||
            addr.neighbourhood ||
            addr.quarter ||
            addr.city_district ||
            addr.residential ||
            addr.hamlet ||
            addr.city ||
            addr.town ||
            addr.village ||
            "";

          const street = [addr.house_number, addr.road].filter(Boolean).join(", ") || addr.pedestrian || "";

          setAddForm(f => ({
            ...f,
            pincode: pincode || f.pincode,
            area: area || f.area,
            street: street || f.street,
          }));

          const filled = [area, pincode].filter(Boolean).join(", ");
          const city = addr.city || addr.town || addr.state_district || "";
          setGeoFillStatus("success");
          setGeoFillMessage(`Location detected: ${filled || city || "Please verify the fields below"}`);
        } catch {
          setGeoFillStatus("error");
          setGeoFillMessage("Couldn't fetch location details. Please fill manually.");
        } finally {
          setGeoFilling(false);
        }
      },
      (err) => {
        setGeoFilling(false);
        setGeoFillStatus("error");
        setGeoFillMessage(
          err.code === err.PERMISSION_DENIED
            ? "Location access denied. Please allow it in your browser settings."
            : "Couldn't detect location. Please fill address manually."
        );
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  }, []);

  const saveAddress = async () => {
    if (!addForm.name || !addForm.phone || !addForm.building || !addForm.area) {
      toast({ title: "Please fill all required fields", variant: "destructive" });
      return;
    }
    if (addForm.pincode.length === 6 && !checkPincodeServiceability(addForm.pincode)) {
      setUnserviceablePincode(addForm.pincode);
      setShowUnserviceablePopup(true);
      return;
    }
    const label =
      addForm.type === "other" ? (addForm.label || "Other") :
      addForm.type === "house" ? "Home" : "Office";

    setIsSavingAddress(true);
    try {
      const res = await fetch("/api/customer/me/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addForm, label }),
      });
      if (!res.ok) throw new Error("Failed to save address");
      const updated = await res.json();
      queryClient.setQueryData(["/api/customer/me"], updated);
      const newAddr = updated.addresses?.[updated.addresses.length - 1];
      if (newAddr) setSelectedAddressId(newAddr.id);
      toast({ title: "Address saved!" });
      setShowAddForm(false);
      setAddForm(emptyForm);
    } catch {
      toast({ title: "Could not save address. Please try again.", variant: "destructive" });
    } finally {
      setIsSavingAddress(false);
    }
  };

  const walletBalance = (customer as any)?.walletBalance ?? 0;
  const rawTotal = totalPrice + pincodeDeliveryCharge + (selectedTimeslot?.isInstant ? (selectedTimeslot.extraCharge ?? 0) : 0);
  const afterCouponTotal = rawTotal - discountAmount;
  const walletDeduction = useWallet ? Math.min(walletBalance, afterCouponTotal) : 0;
  const finalTotal = afterCouponTotal - walletDeduction;

  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if ((window as any).Razorpay) { resolve(true); return; }
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const buildOrderPayload = (selected: CustomerAddress, razorpayPaymentId?: string) => {
    // Guard/log per the delivery-charge race investigation (see explain.md): record the
    // charge we're about to submit alongside the pincode it was computed for, so a $0
    // charge on a pincode that should have a fee is easy to spot in logs instead of
    // being discovered later as missing revenue.
    if (pincodeDeliveryCharge === 0 && selected.pincode) {
      console.warn(
        `[checkout] Submitting order with pincodeDeliveryCharge=0 for pincode=${selected.pincode} ` +
        `(hubReady=${isHubReady}, subHub=${selectedSubHub?.dbName ?? "none"}). ` +
        `This is expected only if that pincode is genuinely configured with a ₹0 fee.`
      );
    } else {
      console.debug(`[checkout] Computed delivery charge ₹${pincodeDeliveryCharge} for pincode=${selected.pincode}`);
    }
    const fullAddress = `${selected.building} · ${selected.street}, ${selected.area} · ${selected.pincode}`;
    const orderItems = items.map(i => ({
      productId: i.originalId ?? String(i.id),
      quantity: i.quantity,
      name: i.name,
      price: i.price,
      unit: (i as any).unit ?? null,
      imageUrl: i.imageUrl ?? null,
    }));
    const slotLabel = selectedTimeslot!.isInstant ? "Instant Delivery (Porter)" : getAdjustedSlotLabel(selectedTimeslot!);
    const instantCharge = selectedTimeslot!.isInstant ? (selectedTimeslot!.extraCharge ?? 0) : 0;
    const slotCharge = pincodeDeliveryCharge + instantCharge;
    const subtotal = totalPrice;
    const orderDate = isPreorderCart
      ? selectedDeliveryDate
      : isNextDay
        ? new Date(new Date().getTime() + 24 * 60 * 60 * 1000)
        : new Date();
    const deliveryDate = getDateKey(orderDate);

    const cashMode = paymentMethod === "online" ? "upi" : "cash";
    const paidAt = new Date().toISOString();
    const orderPayments: Array<{ mode: string; amount: number; reference: string; paidAt: string }> = [];
    if (walletDeduction > 0) {
      orderPayments.push({ mode: "wallet", amount: walletDeduction, reference: "", paidAt });
      if (finalTotal > 0) {
        orderPayments.push({ mode: cashMode, amount: finalTotal, reference: razorpayPaymentId ?? "", paidAt });
      }
    } else if (paymentMethod === "online") {
      orderPayments.push({ mode: "upi", amount: afterCouponTotal, reference: razorpayPaymentId ?? "", paidAt });
    } else {
      orderPayments.push({ mode: "cash", amount: afterCouponTotal, reference: "", paidAt });
    }

    const paidAmount = orderPayments
      .filter(p => p.mode !== "cash")
      .reduce((sum, p) => sum + p.amount, 0);
    const dueAmount = afterCouponTotal - paidAmount;
    const paymentStatus = paidAmount === 0 ? "unpaid" : paidAmount >= afterCouponTotal ? "paid" : "partial";

    return {
      customerName: selected.name || customer?.name || "",
      phone: selected.phone || customer?.phone || "",
      email: customer?.email ?? null,
      customerId: customer?.id ?? null,
      deliveryArea: selected.area,
      address: fullAddress,
      deliveryAddressDetail: {
        _id: selected.id,
        name: selected.name,
        phone: selected.phone,
        building: selected.building,
        street: selected.street,
        area: selected.area,
        pincode: selected.pincode,
        type: selected.type,
        label: selected.label,
        instructions: selected.instructions,
      },
      notes: selected.instructions || "",
      items: orderItems,
      subtotal,
      discount: discountAmount,
      slotCharge,
      total: afterCouponTotal,
      payments: orderPayments,
      paidAmount,
      dueAmount,
      paymentStatus,
      source: "online",
      deliveryType: "delivery",
      orderType: isPreorderCart ? "preorder" : "normal",
      scheduleType: selectedTimeslot!.isInstant ? "instant" : "slot",
      timeslotId: selectedTimeslot!.id,
      timeslotLabel: slotLabel,
      timeslotStart: (selectedTimeslot as any).startTime ?? null,
      timeslotEnd: (selectedTimeslot as any).endTime ?? null,
      deliveryDate,
      couponCode: appliedCoupon?.code ?? null,
      discountAmount: discountAmount > 0 ? discountAmount : null,
      paymentMode: finalTotal === 0 ? "wallet" : paymentMethod === "online" ? "upi" : "cash",
      hubDbName: selectedSubHub?.dbName ?? null,
    } as any;
  };

  const placeOrder = async () => {
    const selected = savedAddresses.find(a => a.id === activeAddressId);
    if (!selected) return;
    if (isPreorderCart) {
      if (!firstValidPreorderDate) {
        toast({
          title: "No common preorder date is available",
          description: "These products have different preorder availability. Please remove an item or return to the cart.",
          variant: "destructive",
        });
        return;
      }
      if (!isPreorderDateSelectable(selectedDeliveryDate)) {
        setSelectedDeliveryDate(firstValidPreorderDate);
        setSelectedTimeslotId(null);
        toast({
          title: "Please choose an available preorder date",
          description: "The selected date is not available for every item or has no delivery slot.",
          variant: "destructive",
        });
        return;
      }
    }
    if (!selectedTimeslot) {
      toast({ title: "Please select a delivery time slot", variant: "destructive" });
      return;
    }
    // Hard guard against the delivery-charge race (see explain.md): never submit a
    // delivery order before the hub/pincode config has loaded. Without this, a fast tap
    // right after the app loads (or right after resuming from backgrounding a UPI app)
    // can build the order payload while pincodeDeliveryCharge is still stuck at its
    // unresolved default of 0, undercharging a real delivery fee.
    if (!isHubReady) {
      toast({ title: "Still loading delivery details, please try again in a moment", variant: "destructive" });
      return;
    }

    // Wallet covers entire total — place order directly, no payment method needed
    if (finalTotal === 0) {
      createOrder(buildOrderPayload(selected), {
        onSuccess: () => { setIsSuccess(true); clearCart(); setUseWallet(false); },
        onError: (err: any) => {
          toast({ title: err?.message || "Could not place order. Please try again.", variant: "destructive" });
        },
      });
      return;
    }

    // COD flow: place order directly
    if (paymentMethod === "cod") {
      createOrder(buildOrderPayload(selected), {
        onSuccess: () => { setIsSuccess(true); clearCart(); setUseWallet(false); },
        onError: (err: any) => {
          toast({ title: err?.message || "Could not place order. Please try again.", variant: "destructive" });
        },
      });
      return;
    }

    // UPI flow: go through Razorpay
    setIsProcessingPayment(true);
    // Close the drawer BEFORE opening Razorpay so its Sheet backdrop doesn't sit on top
    // and intercept touch events on the Razorpay bottom sheet (mobile bug).
    // We will force it back open when payment succeeds to show the success screen.
    setIsCartOpen(false);
    // Give the Sheet close animation time to complete before Razorpay opens
    await new Promise((r) => setTimeout(r, 320));
    try {
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        toast({ title: "Payment gateway unavailable. Please try again.", variant: "destructive" });
        setIsProcessingPayment(false);
        setIsCartOpen(true);
        return;
      }

      // Build the pre-payment payload now (before the modal) so the server can store
      // it as a pending checkout. The webhook uses this to reconstruct the order if
      // the browser closes before the client-side handler fires.
      const pendingOrderPayload = buildOrderPayload(selected);

      const res = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: finalTotal, orderPayload: pendingOrderPayload }),
      });
      if (!res.ok) {
        toast({ title: "Could not initiate payment. Please try again.", variant: "destructive" });
        setIsProcessingPayment(false);
        return;
      }
      const { order_id, amount: rzpAmount, currency } = await res.json();

      const options = {
        key: import.meta.env.VITE_RAZORPAY_KEY_ID,
        amount: rzpAmount,
        currency,
        name: "FishTokri",
        description: "Fresh seafood & meat delivery",
        order_id,
        prefill: {
          name: selected.name || customer?.name || "",
          contact: `91${selected.phone || customer?.phone || ""}`,
          email: customer?.email || "",
        },
        handler: async (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          // Claim the order-creation slot atomically (no `await` before this point)
          // in case the visibilitychange UPI-resume poll already claimed it first.
          if (orderClaimedRef.current) {
            console.warn("[checkout] Razorpay handler fired after order already claimed by the UPI-resume flow; skipping duplicate order.");
            setIsProcessingPayment(false);
            return;
          }
          orderClaimedRef.current = true;
          // Mark as succeeded and clear pending UPI refs so the visibilitychange listener doesn't double-process
          paymentSucceededRef.current = true;
          pendingRzpOrderIdRef.current = null;
          pendingSelectedAddressRef.current = null;
          try {
            const verifyRes = await fetch("/api/razorpay/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
              }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyData.verified) {
              paymentSucceededRef.current = false;
              toast({ title: "Payment verification failed. Contact support.", variant: "destructive" });
              setIsProcessingPayment(false);
              return;
            }
            createOrder({ ...buildOrderPayload(selected, response.razorpay_payment_id), razorpayOrderId: order_id }, {
              onSuccess: () => {
                // Force the drawer open so the success screen is visible
                setIsCartOpen(true);
                setIsSuccess(true);
                clearCart();
                setUseWallet(false);
                setIsProcessingPayment(false);
                paymentSucceededRef.current = false;
              },
              onError: (err: any) => {
                paymentSucceededRef.current = false;
                setIsProcessingPayment(false);
                setIsCartOpen(true);
                toast({ title: err?.message || "Could not place order. Please try again.", variant: "destructive" });
              },
            });
          } catch {
            paymentSucceededRef.current = false;
            toast({ title: "Payment failed. Please contact support.", variant: "destructive" });
            setIsProcessingPayment(false);
          }
        },
        modal: {
          ondismiss: () => {
            // Suppress if payment already succeeded OR if we're actively polling after returning from a UPI app
            if (paymentSucceededRef.current || returningFromUpiRef.current) return;
            // User closed the modal — treat as cancellation and reset state
            pendingRzpOrderIdRef.current = null;
            pendingSelectedAddressRef.current = null;
            setIsProcessingPayment(false);
            setIsCartOpen(true);
            toast({ title: "Payment cancelled", variant: "destructive" });
          },
        },
        theme: { color: "#364F9F" },
      };

      // Store order details before opening so the visibilitychange listener can
      // recover payment completion when the user returns from GPay / PhonePe
      pendingRzpOrderIdRef.current = order_id;
      pendingSelectedAddressRef.current = selected;
      orderClaimedRef.current = false;

      const rzp = new (window as any).Razorpay(options);
      rzp.open();
    } catch {
      toast({ title: "Payment failed. Please try again.", variant: "destructive" });
      setIsProcessingPayment(false);
      setIsCartOpen(true);
    }
  };

  // Preload Razorpay script as soon as cart opens so it's ready instantly when user clicks Pay
  useEffect(() => {
    if (isCartOpen && !(window as any).Razorpay) {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      document.body.appendChild(script);
    }
  }, [isCartOpen]);

  // Mobile UPI return: when the user comes back from GPay/PhonePe/etc., the browser
  // fires visibilitychange. We poll our backend to check if payment completed, then
  // finish the order flow so the user sees the success animation.
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (
        document.visibilityState !== "visible" ||
        !pendingRzpOrderIdRef.current ||
        paymentSucceededRef.current
      ) return;

      const orderId = pendingRzpOrderIdRef.current;
      const selected = pendingSelectedAddressRef.current;
      if (!selected) return;

      // Flag we're checking so ondismiss doesn't show a false "Payment cancelled" toast
      returningFromUpiRef.current = true;

      // Give Razorpay a moment to settle before querying
      await new Promise((r) => setTimeout(r, 1500));

      try {
        const statusRes = await fetch(`/api/razorpay/order-status/${orderId}`);
        const statusData = await statusRes.json();

        if (!statusData.paid) {
          returningFromUpiRef.current = false;
          return; // Payment not complete yet — user may still be in UPI app
        }

        // Payment confirmed server-side — mark as succeeded and place the order.
        // Same guard as placeOrder(): don't build the payload with a possibly-stale/
        // unresolved delivery charge if the hub/pincode config isn't loaded (e.g. the
        // app was fully reloaded while the user was away in the UPI app).
        if (!isHubReady) {
          console.warn("[checkout] UPI resume: hub config not ready yet, deferring order creation.");
          returningFromUpiRef.current = false;
          return;
        }

        // Claim the order-creation slot atomically (no `await` before this point)
        // in case Razorpay's own `handler` callback already claimed it first.
        if (orderClaimedRef.current) {
          console.warn("[checkout] UPI resume: order already claimed by the Razorpay handler; skipping duplicate order.");
          returningFromUpiRef.current = false;
          return;
        }
        orderClaimedRef.current = true;
        paymentSucceededRef.current = true;
        pendingRzpOrderIdRef.current = null;

        createOrder({ ...buildOrderPayload(selected, statusData.paymentId), razorpayOrderId: orderId }, {
          onSuccess: () => {
            setIsCartOpen(true);
            setIsSuccess(true);
            clearCart();
            setUseWallet(false);
            setIsProcessingPayment(false);
            paymentSucceededRef.current = false;
            returningFromUpiRef.current = false;
          },
          onError: (err: any) => {
            paymentSucceededRef.current = false;
            returningFromUpiRef.current = false;
            setIsProcessingPayment(false);
            setIsCartOpen(true);
            toast({ title: err?.message || "Could not place order. Please try again.", variant: "destructive" });
          },
        });
      } catch {
        returningFromUpiRef.current = false;
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [createOrder, buildOrderPayload, clearCart, setIsCartOpen, setUseWallet, toast, isHubReady]);

  // Safety net: always clear the cart when the success screen is shown,
  // regardless of whether the mutation onSuccess callback fires.
  useEffect(() => {
    if (isSuccess) {
      clearCart();
      setUseWallet(false);
    }
  }, [isSuccess]);

  const handleClose = (open: boolean) => {
    if (!open && isSuccess) setTimeout(() => setIsSuccess(false), 300);
    setIsCartOpen(open);
  };

  const savedTotal = items.reduce((acc, item) => {
    const original = item.originalPrice ?? 0;
    const discount = original > item.price ? (original - item.price) * item.quantity : 0;
    return acc + discount;
  }, 0);

  return (
    <>
      <Sheet open={isCartOpen} onOpenChange={handleClose}>
        <SheetContent className={`w-full sm:max-w-md flex flex-col h-full bg-white border-l border-border/30 p-0 overflow-hidden font-sans ${isSuccess ? "[&>button]:hidden" : ""}`}>
          {isSuccess ? (
            <div className="relative flex flex-col items-center justify-start h-full p-6 text-center overflow-hidden">
              <div className="pointer-events-none absolute inset-0 z-0">
                <Lottie animationData={confettiAnim} loop autoplay style={{ width: "100%", height: "100%" }} />
              </div>
              <div className="relative z-10 mt-4 mb-8">
                <FishTokriLogo className="h-16 w-auto" />
              </div>
              <div className="relative z-10 w-40 h-40 -mb-2">
                <Lottie
                  animationData={orderSuccessAnim}
                  loop={false}
                  autoplay
                  style={{ width: "100%", height: "100%" }}
                  onComplete={() => {
                    setIsCartOpen(false);
                    setTimeout(() => {
                      setIsSuccess(false);
                      navigate("/profile?tab=orders");
                    }, 300);
                  }}
                />
              </div>
              <h2 className="relative z-10 text-2xl font-bold text-foreground mb-2">Order Placed!</h2>
              <p className="relative z-10 text-muted-foreground text-base mb-8 max-w-[260px]">
                Thank you! We'll contact you shortly to confirm your delivery.
              </p>
              <Button
                onClick={() => {
                  setIsCartOpen(false);
                  setTimeout(() => {
                    setIsSuccess(false);
                    navigate("/profile?tab=orders");
                  }, 300);
                }}
                size="lg"
                className="relative z-10 w-full max-w-[220px] !rounded-full font-semibold bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-500/20"
              >
                View My Orders
              </Button>
            </div>
          ) : (
            <>
              <SheetHeader className="px-5 py-4 border-b border-border/30 bg-white sticky top-0 z-10">
                <SheetTitle className="flex items-center gap-2 text-xl font-bold text-foreground">
                  <img src={headerCartImg} alt="Cart" className="w-5 h-5 object-contain" />
                  Order Summary
                </SheetTitle>
              </SheetHeader>

              {items.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
                  <div className="w-44 h-44 -mb-2">
                    <Lottie animationData={emptyCartBagAnim} loop autoplay style={{ width: "100%", height: "100%" }} />
                  </div>
                  <p className="text-lg font-semibold text-foreground">Your cart is empty</p>
                  <p className="text-sm mt-1 mb-6">Add some fresh items to get started</p>
                  <Button variant="outline" onClick={() => setIsCartOpen(false)} className="rounded-xl">
                    Continue Browsing
                  </Button>
                </div>
              ) : (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto scrollbar-hide">
                    {(savedTotal + discountAmount) > 0 && (
                      <div className="mx-4 -mt-2 -mb-2 flex items-center justify-center px-2">
                        <div className="w-12 h-12 -mr-1 overflow-hidden flex items-center justify-center shrink-0">
                          <Lottie
                            animationData={popperAnim}
                            loop
                            autoplay
                            style={{ width: 96, height: 96 }}
                          />
                        </div>
                        <p className="text-sm font-semibold leading-tight">
                          <span style={{ color: "#F05B4E" }}>Congratulations!</span>
                          <span style={{ color: "#364F9F" }}> You've saved ₹{savedTotal + discountAmount}</span>
                        </p>
                      </div>
                    )}

                     <div className="px-4 pt-4 space-y-3">
                      {items.map(item => (
                        <div key={item.id} className="overflow-hidden" data-testid={`cart-item-${item.id}`}>
                          <div className="flex items-center gap-3 p-3">
                            <div className="w-20 h-20 overflow-hidden flex-shrink-0 rounded-xl border border-border/20">
                              {item.isCombo && item.comboImages && item.comboImages.length > 0 ? (
                                (() => {
                                  const imgs = item.comboImages!;
                                  const n = Math.min(imgs.length, 3);
                                  const slotPct = 100 / n;
                                  const widthPct = n === 1 ? 100 : slotPct + slotPct * 0.5;
                                  return (
                                    <div className="relative w-full h-full overflow-hidden">
                                      {imgs.slice(0, n).map((img, i) => (
                                        <div
                                          key={i}
                                          className="absolute top-0 bottom-0"
                                          style={{ left: `${i * slotPct}%`, width: `${widthPct}%`, zIndex: i }}
                                        >
                                          <img src={img} alt="" className="w-full h-full object-cover" />
                                          {i < n - 1 && (
                                            <div className="absolute top-0 right-0 bottom-0 w-4 bg-gradient-to-r from-transparent to-black/20" />
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })()
                              ) : (
                                <img src={item.imageUrl || getFallbackImage(item.category)} alt={item.name} className="w-full h-full object-cover" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold text-foreground text-sm truncate">{item.name}</h4>
                              <p className="text-xs text-muted-foreground">{item.unit}</p>
                               {item.isPreorderCheckout && (
                                 <p className="text-[11px] leading-snug text-[#364F9F] mt-1" data-testid={`availability-${item.id}`}>
                                   {formatPreorderAvailability(item)}
                                 </p>
                               )}
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-sm font-bold text-primary">₹{item.price}</span>
                                {!item.isCombo && item.originalPrice && item.originalPrice > item.price && (
                                  <>
                                    <span className="text-xs text-muted-foreground line-through">₹{item.originalPrice}</span>
                                    <span className="text-[10px] font-semibold text-emerald-600">{Math.round((1 - item.price / item.originalPrice) * 100)}% off</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 bg-slate-50 rounded-full px-2 py-1 border border-slate-100">
                              <button className="h-6 w-6 rounded-full hover:bg-white flex items-center justify-center" onClick={() => updateQuantity(item.id, item.quantity - 1)} data-testid={`button-decrease-${item.id}`}>
                                {item.quantity === 1
                                  ? <img src={iconBinImg} alt="Remove" className="w-3 h-3 object-contain" style={{ filter: "brightness(0)" }} />
                                  : <Minus className="w-3 h-3 text-slate-600" />}
                              </button>
                              <span className="text-sm font-bold w-5 text-center">{item.quantity}</span>
                              <button
                                className="h-6 w-6 rounded-full hover:bg-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                disabled={item.quantity >= computeMaxQty(item)}
                                data-testid={`button-increase-${item.id}`}
                              >
                                <Plus className="w-3 h-3 text-slate-600" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Coupon Section — collapsible */}
                    {cartCoupons.length > 0 && (
                      <div className="mx-4 mt-4 border border-border/40 rounded-2xl overflow-hidden">
                        {/* Header — always visible, tap to expand/collapse */}
                        <button
                          type="button"
                          onClick={() => setCouponExpanded(s => !s)}
                          className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/20 hover:bg-muted/30 transition-colors"
                          data-testid="button-toggle-coupons"
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
                            {appliedCoupon ? (
                              <span className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                                <span className="font-mono tracking-wider">{appliedCoupon.code}</span>
                                <span className="font-normal text-emerald-600">· saved ₹{discountAmount}</span>
                              </span>
                            ) : (
                              <span className="text-sm font-semibold text-foreground">
                                Offers Available
                              </span>
                            )}
                          </div>
                          {couponExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                        </button>

                        {/* Expanded body */}
                        {couponExpanded && (
                          <>
                            {/* Applied coupon banner */}
                            {appliedCoupon && (
                              <div className="flex items-center justify-between px-4 py-3 bg-emerald-600 border-t border-emerald-700">
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span
                                    aria-hidden
                                    className="w-5 h-5 shrink-0 inline-block"
                                    style={{
                                      backgroundColor: "#ffffff",
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
                                  <div className="min-w-0">
                                    <span className="font-mono font-bold text-sm text-white tracking-wider">{appliedCoupon.code}</span>
                                    <p className="text-xs text-white/90">
                                      {appliedCoupon.type === "flat" ? `₹${discountAmount} off applied!` : `${appliedCoupon.discountValue}% off — you save ₹${discountAmount}!`}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => { setAppliedCoupon(null); setCouponError(""); }}
                                  className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center shrink-0 transition-colors ml-3"
                                  aria-label="Remove coupon"
                                  data-testid="button-remove-coupon"
                                >
                                  <img src={iconBinImg} alt="" className="w-3.5 h-3.5 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
                                </button>
                              </div>
                            )}

                            {/* Manual code entry */}
                            {!appliedCoupon && (
                              <div className="px-4 py-3 border-t border-border/20">
                                <div className="flex gap-2 w-full min-w-0">
                                  <input
                                    type="text"
                                    value={couponInput}
                                    onChange={e => { setCouponInput(e.target.value.toUpperCase()); setCouponError(""); }}
                                    onKeyDown={e => e.key === "Enter" && applyFromInput()}
                                    placeholder="Enter coupon code"
                                    className="flex-1 min-w-0 h-9 px-4 text-sm font-mono font-semibold tracking-wider rounded-full border border-border/60 bg-muted/30 focus:outline-none focus:border-[#364F9F] placeholder:font-normal placeholder:tracking-normal"
                                    data-testid="input-coupon-code"
                                  />
                                  <button
                                    onClick={applyFromInput}
                                    disabled={!couponInput.trim() || isApplyingCoupon}
                                    className="shrink-0 whitespace-nowrap px-4 h-9 rounded-full text-white text-xs font-bold disabled:opacity-40 transition-colors flex items-center gap-1.5"
                                    style={{ backgroundColor: "#364F9F" }}
                                    data-testid="button-apply-coupon"
                                  >
                                    {isApplyingCoupon ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                    Apply
                                  </button>
                                </div>
                                {couponError && (
                                  <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3 shrink-0" /> {couponError}
                                  </p>
                                )}
                              </div>
                            )}

                            {/* Coupon list */}
                            <div className="divide-y divide-border/20 border-t border-border/20">
                              {(showAllCoupons ? visibleCartCoupons : visibleCartCoupons.slice(0, 3)).map(coupon => {
                                const exhausted = isCouponExhausted(coupon);
                                const applicable = isCouponApplicable(coupon);
                                const isApplied = appliedCoupon?.id === coupon.id;
                                const belowMin = !exhausted && coupon.minOrderAmount > totalPrice;
                                const needed = belowMin ? coupon.minOrderAmount - totalPrice : 0;
                                const usageInfo = customer ? userCouponUsage[coupon.code] : undefined;
                                const remaining = usageInfo && usageInfo.limit > 0
                                  ? usageInfo.limit - usageInfo.usedCount
                                  : null;
                                return (
                                  <div
                                    key={coupon.id}
                                    className={`flex items-center justify-between px-4 py-3 transition-colors ${applicable ? "bg-background hover:bg-muted/10" : "bg-muted/5 opacity-60"}`}
                                  >
                                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                      <span
                                        aria-hidden
                                        className="w-6 h-6 shrink-0 inline-block mt-0.5"
                                        style={{
                                          backgroundColor: applicable ? "#364F9F" : "#9CA3AF",
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
                                          className={`font-mono font-bold text-xs tracking-wider rounded-full px-2.5 py-0.5 text-white inline-block ${applicable ? "" : "opacity-60"}`}
                                          style={{ backgroundColor: "#F05B4E" }}
                                        >
                                          {coupon.code}
                                        </span>
                                        <p className="text-xs text-muted-foreground mt-1 whitespace-normal break-words leading-snug">{coupon.description}</p>
                                        {exhausted && (
                                          <p className="text-[10px] text-red-500 mt-0.5 font-medium">Limit reached</p>
                                        )}
                                        {belowMin && coupon.minOrderAmount > 0 && (
                                          <p className="text-[10px] text-amber-600 mt-0.5 font-medium">Add ₹{needed} more to unlock</p>
                                        )}
                                      </div>
                                    </div>
                                    {(() => {
                                      const isThisApplying = applyingCouponId === coupon.id;
                                      return (
                                        <button
                                          onClick={() => { if (applicable && !isApplied && !isApplyingCoupon) { applyCartCoupon(coupon).then(() => setCouponExpanded(false)); } }}
                                          disabled={!applicable || isApplied || isApplyingCoupon || exhausted}
                                          className={`ml-3 shrink-0 text-xs font-bold px-3.5 py-1.5 rounded-full transition-colors flex items-center gap-1 ${
                                            isApplied
                                              ? "text-white cursor-default"
                                              : exhausted
                                                ? "bg-red-50 text-red-400 cursor-not-allowed"
                                                : applicable
                                                  ? "text-white"
                                                  : "bg-muted text-muted-foreground cursor-not-allowed"
                                          }`}
                                          style={
                                            isApplied
                                              ? { backgroundColor: "#047857" }
                                              : applicable && !exhausted
                                                ? { backgroundColor: "#364F9F" }
                                                : undefined
                                          }
                                        >
                                          {isThisApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                                          {isApplied ? "Applied" : exhausted ? "Limit reached" : applicable ? "Apply" : "Locked"}
                                        </button>
                                      );
                                    })()}
                                  </div>
                                );
                              })}
                              {visibleCartCoupons.length > 3 && (
                                <button
                                  onClick={() => setShowAllCoupons(s => !s)}
                                  className="w-full py-2.5 text-xs text-primary font-semibold flex items-center justify-center gap-1 hover:bg-muted/10"
                                >
                                  {showAllCoupons ? <><ChevronUp className="w-3 h-3" /> Show less</> : <><ChevronDown className="w-3 h-3" /> +{visibleCartCoupons.length - 3} more coupons</>}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Fishtokri Wallet — shown right below Offers */}
                    {customer && walletBalance > 0 && (
                      <div className="mx-4 mt-4">
                        <button
                          type="button"
                          onClick={() => setUseWallet(w => !w)}
                          className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all text-left ${useWallet ? "border-[#364F9F] bg-[#364F9F]/5" : "border-border/40 bg-white hover:border-[#364F9F]/30"}`}
                          data-testid="button-toggle-wallet"
                        >
                          <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${useWallet ? "border-[#364F9F]" : "border-slate-300"}`}>
                            {useWallet && <div className="w-2 h-2 rounded-full bg-[#364F9F]" />}
                          </div>
                          <img
                            src={iconWalletImg}
                            alt=""
                            className="w-5 h-5 object-contain shrink-0"
                            style={{ filter: "brightness(0) saturate(100%) invert(28%) sepia(48%) saturate(1517%) hue-rotate(212deg) brightness(91%) contrast(89%)" }}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">Use Fishtokri Wallet</p>
                            <p className="text-xs text-muted-foreground">
                              Balance: <span className="font-bold" style={{ color: "#364F9F" }}>₹{walletBalance.toLocaleString("en-IN")}</span>
                              {useWallet && walletDeduction > 0 && (
                                <span className="ml-1 font-semibold" style={{ color: "#364F9F" }}> · −₹{walletDeduction} applied</span>
                              )}
                            </p>
                          </div>
                        </button>
                      </div>
                    )}

                    {/* Bill Details */}
                    <div className="mx-4 mt-4 border border-dashed border-border/60 rounded-2xl p-4 space-y-2.5">
                      <h3 className="font-semibold text-foreground text-sm mb-3">Bill Details</h3>
                      {items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm">
                          <span className="text-muted-foreground truncate mr-2">{item.name} × {item.quantity}</span>
                          <span className="font-medium flex-shrink-0">₹{item.price * item.quantity}</span>
                        </div>
                      ))}
                      <div className="pt-2 border-t border-dashed border-border/40 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span className="font-medium">₹{totalPrice}</span>
                        </div>
                        {discountAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-emerald-600 flex items-center gap-1">
                              <Tag className="w-3 h-3" /> Coupon ({appliedCoupon!.code})
                            </span>
                            <span className="font-semibold text-emerald-600">−₹{discountAmount}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Delivery fee</span>
                          {pincodeDeliveryCharge > 0 ? (
                            <span className="font-semibold text-amber-600">+₹{pincodeDeliveryCharge}</span>
                          ) : (
                            <span className="font-semibold text-emerald-600">FREE</span>
                          )}
                        </div>
                        {selectedTimeslot?.isInstant && (selectedTimeslot.extraCharge ?? 0) > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-amber-600 text-xs">Instant delivery (Porter)</span>
                            <span className="font-semibold text-amber-600 text-xs">+₹{selectedTimeslot.extraCharge}</span>
                          </div>
                        )}
                        {walletDeduction > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-blue-600 flex items-center gap-1">
                              <img src={iconWalletImg} alt="" className="w-3 h-3 object-contain" style={{ filter: "brightness(0) saturate(100%) invert(28%) sepia(48%) saturate(1517%) hue-rotate(212deg) brightness(91%) contrast(89%)" }} />
                              Wallet
                            </span>
                            <span className="font-semibold text-blue-600">−₹{walletDeduction}</span>
                          </div>
                        )}
                      </div>
                      <div className="pt-2 border-t border-border/40 flex justify-between items-center">
                        <span className="font-bold text-foreground">Total</span>
                        <div className="text-right">
                          {(discountAmount > 0 || walletDeduction > 0) && (
                            <p className="text-xs text-muted-foreground line-through">
                              ₹{rawTotal}
                            </p>
                          )}
                          <span className="text-lg font-bold text-primary">₹{finalTotal}</span>
                        </div>
                      </div>
                    </div>

                    {/* Shipping Address */}
                    <div className="px-4 mt-5 mb-2">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="w-4 h-4 inline-block"
                            style={{
                              backgroundColor: "#364F9F",
                              WebkitMaskImage: `url(${iconShippingHomeImg})`,
                              maskImage: `url(${iconShippingHomeImg})`,
                              WebkitMaskRepeat: "no-repeat",
                              maskRepeat: "no-repeat",
                              WebkitMaskSize: "contain",
                              maskSize: "contain",
                              WebkitMaskPosition: "center",
                              maskPosition: "center",
                            }}
                          />
                          Shipping Address
                        </h3>
                        {customer && !showAddForm ? (
                          <Button
                            size="sm"
                            onClick={openAddForm}
                            className="rounded-full h-8 px-3 text-xs text-white gap-1 hover:opacity-90"
                            style={{ backgroundColor: "#364F9F" }}
                            data-testid="button-add-address"
                          >
                            <Plus className="w-3 h-3" /> Add Address
                          </Button>
                        ) : null}
                      </div>

                      {/* Inline Add Address form */}
                      {customer && showAddForm && (
                        <div className="space-y-3 mb-4 pb-4 border-b border-slate-100">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-foreground">New Address</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => { setShowAddForm(false); setAddForm(emptyForm); }}
                              className="w-7 h-7 rounded-full text-muted-foreground"
                              data-testid="button-close-address-form"
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Pincode</Label>
                            <input
                              type="tel"
                              inputMode="numeric"
                              maxLength={6}
                              value={addForm.pincode}
                              onChange={e => {
                                const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                                setAddForm(f => ({ ...f, pincode: val }));
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
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Phone *</Label>
                              <input
                                type="tel"
                                inputMode="numeric"
                                maxLength={10}
                                value={addForm.phone}
                                onChange={e => setAddForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                                placeholder="10-digit mobile"
                                className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                                data-testid="input-address-phone"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">Full Name *</Label>
                              <input
                                value={addForm.name}
                                onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                                placeholder="Recipient name"
                                className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                                data-testid="input-address-name"
                              />
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Building / Flat No *</Label>
                            <input
                              value={addForm.building}
                              onChange={e => setAddForm(f => ({ ...f, building: e.target.value }))}
                              placeholder="Wing A, Flat 302, Building Name"
                              className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                              data-testid="input-address-building"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Street / Locality</Label>
                            <input
                              value={addForm.street}
                              onChange={e => setAddForm(f => ({ ...f, street: e.target.value }))}
                              placeholder="Street name or society"
                              className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                              data-testid="input-address-street"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Area / Suburb *</Label>
                            <input
                              value={addForm.area}
                              onChange={e => setAddForm(f => ({ ...f, area: e.target.value }))}
                              placeholder="e.g. Thane West"
                              className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                              data-testid="input-address-area"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-xs text-muted-foreground">Address Type</Label>
                            <div className="flex gap-2">
                              {TYPE_OPTIONS.map(opt => {
                                const selected = addForm.type === opt.value;
                                return (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setAddForm(f => ({
                                      ...f,
                                      type: opt.value,
                                      label: opt.value === "house" ? "Home" : opt.value === "office" ? "Office" : f.label,
                                    }))}
                                    style={{ backgroundColor: selected ? "#364F9F" : "#F05B4E", borderColor: selected ? "#364F9F" : "#F05B4E" }}
                                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border text-white transition-all hover:opacity-90"
                                    data-testid={`button-address-type-${opt.value}`}
                                  >
                                    {opt.iconImg && (
                                      <img src={opt.iconImg} alt="" className="w-3.5 h-3.5 object-contain brightness-0 invert" />
                                    )}
                                    {opt.icon}
                                    {opt.label}
                                  </button>
                                );
                              })}
                            </div>
                            {addForm.type === "other" && (
                              <input
                                value={addForm.label}
                                onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                                placeholder='Custom label (e.g. "Parents Home")'
                                className="w-full bg-transparent border-0 border-b border-border/60 focus:border-[#364F9F] focus:outline-none px-0 py-1.5 text-sm transition-colors"
                                data-testid="input-address-custom-label"
                              />
                            )}
                          </div>
                          <div className="flex gap-2 pt-3">
                            <Button
                              onClick={() => { setShowAddForm(false); setAddForm(emptyForm); }}
                              className="flex-1 rounded-xl text-white font-medium hover:opacity-90"
                              style={{ backgroundColor: "#F05B4E" }}
                              data-testid="button-cancel-address"
                            >
                              Cancel
                            </Button>
                            <Button
                              onClick={saveAddress}
                              disabled={isSavingAddress}
                              className="flex-1 rounded-xl text-white font-medium hover:opacity-90"
                              style={{ backgroundColor: "#364F9F" }}
                              data-testid="button-save-address"
                            >
                              {isSavingAddress ? <><Loader2 className="w-4 h-4 animate-spin mr-2 inline" />Saving...</> : "Save Address"}
                            </Button>
                          </div>
                        </div>
                      )}

                      {!customer ? (
                        <button
                          onClick={() => { setIsCartOpen(false); navigate("/"); }}
                          className="w-full border-2 border-dashed border-border/50 rounded-2xl p-4 text-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
                        >
                          <MapPin className="w-6 h-6 mx-auto mb-1 opacity-40" />
                          <p className="text-sm font-medium">Please log in to use saved addresses</p>
                          <p className="text-xs mt-1 opacity-70">Tap to sign in with your phone</p>
                        </button>
                      ) : savedAddresses.length === 0 ? (
                        <button onClick={openAddForm} className="w-full border-2 border-dashed border-border/50 rounded-2xl p-4 flex flex-col items-center text-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors" data-testid="button-add-first-address">
                          <Lottie animationData={emptyAddressAnim} loop className="w-16 h-16" />
                          <p className="text-sm font-medium">+ Add delivery address</p>
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {savedAddresses.map((addr, addrIdx) => (
                            <button
                              key={addr.id || addr.pincode || addrIdx}
                              type="button"
                              onClick={() => setSelectedAddressId(addr.id)}
                              className={`w-full text-left p-3.5 rounded-2xl border-2 transition-all ${activeAddressId === addr.id ? "border-primary bg-primary/5" : "border-border/40 bg-white hover:border-primary/30"}`}
                              data-testid={`address-option-${addr.id}`}
                            >
                              <div className="flex items-start gap-2.5">
                                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${activeAddressId === addr.id ? "border-primary" : "border-slate-300"}`}>
                                  {activeAddressId === addr.id && <div className="w-2 h-2 rounded-full bg-primary" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <span className="font-semibold text-sm text-foreground">{addr.name || customer?.name}</span>
                                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${addressTypeColors[addr.type] || "bg-slate-100 text-slate-500"}`}>
                                      {addr.label}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground">{addr.phone || customer?.phone}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                                    {[addr.building, addr.street, addr.area, addr.pincode].filter(Boolean).join(", ")}
                                  </p>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Delivery Time Slot */}
                    <div className="px-4 mt-5 mb-2">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="w-4 h-4 inline-block"
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
                          Select Time Slot
                        </h3>
                        {selectedTimeslot?.isInstant && (selectedTimeslot.extraCharge ?? 0) > 0 && (
                          <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">+₹{selectedTimeslot.extraCharge}</span>
                        )}
                      </div>

                         {isPreorderCart ? (
                         <div className="mb-3">
                           <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                              Delivery date for all preorder items
                           </label>
                            <p className="text-[11px] text-muted-foreground mb-1.5">
                              Choose a date available for every item in your cart.
                            </p>
                            {!firstValidPreorderDate && (
                              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 mb-2 text-xs text-amber-800" role="alert">
                                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                <span>No common preorder date is available for these items.</span>
                              </div>
                            )}
                           <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                             <PopoverTrigger asChild>
                               <Button
                                 type="button"
                                 variant="outline"
                                 className="w-full justify-between rounded-xl border-2 border-border/40 bg-white font-semibold text-sm"
                                 data-testid="preorder-delivery-date"
                               >
                                 <span>{format(selectedDeliveryDate, "dd-MM-yyyy")}</span>
                                 <span className="text-xs text-muted-foreground">
                                   {format(selectedDeliveryDate, "EEE, dd MMM")}
                                 </span>
                               </Button>
                             </PopoverTrigger>
                             <PopoverContent align="start" className="w-auto p-0">
                               <Calendar
                                 mode="single"
                                 selected={selectedDeliveryDate}
                                 onSelect={(date) => {
                                   if (!date) return;
                                    if (!isPreorderDateSelectable(date)) return;
                                   date.setHours(0, 0, 0, 0);
                                   setSelectedDeliveryDate(date);
                                   setSelectedTimeslotId(null);
                                   setDatePickerOpen(false);
                                 }}
                                  disabled={(date) => !isPreorderDateSelectable(date)}
                                 initialFocus
                               />
                             </PopoverContent>
                           </Popover>
                         </div>
                       ) : (
                         <div className="flex items-center gap-2 mb-3">
                           <button
                             type="button"
                             onClick={() => { setIsNextDay(false); setSelectedTimeslotId(null); }}
                             className={`flex-1 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${!isNextDay ? "border-[#364F9F] bg-[#364F9F] text-white" : "border-border/40 text-muted-foreground bg-white"}`}
                           >
                             Today
                           </button>
                           <button
                             type="button"
                             onClick={() => { setIsNextDay(true); setSelectedTimeslotId(null); }}
                             className={`flex-1 py-1.5 rounded-full text-xs font-semibold border-2 transition-all ${isNextDay ? "border-[#364F9F] bg-[#364F9F] text-white" : "border-border/40 text-muted-foreground bg-white"}`}
                           >
                             Next Day
                           </button>
                         </div>
                       )}

                      <div className="space-y-2">
                          {timeslotsLoading ? (
                            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                              <Loader2 className="w-4 h-4 animate-spin" /> Loading slots...
                            </div>
                           ) : displayTimeslots.length === 0 ? (
                             <div className="py-4 text-center text-sm text-muted-foreground">
                               {isPreorderCart
                                 ? "No delivery slots available for this date"
                                 : "No slots available"}
                            </div>
                          ) : (
                            displayTimeslots.map((slot, slotIdx) => {
                              const isSelected = selectedTimeslotId === slot.id;
                              const adjustedLabel = getAdjustedSlotLabel(slot);
                              const hasDelay = !slot.isInstant && pincodeTimeDelay > 0;
                              return (
                              <div key={slot.id || slot.label || slotIdx}>
                                <button
                                  type="button"
                                  onClick={() => { setSelectedTimeslotId(slot.id); setTimeslotExpanded(false); }}
                                  className={`w-full text-left px-3 py-2.5 rounded-xl border-2 transition-all ${isSelected ? (slot.isInstant ? "border-amber-500 bg-amber-50" : "border-[#364F9F] bg-[#364F9F]/5") : "border-border/40 bg-white hover:border-[#364F9F]/30"}`}
                                  data-testid={`timeslot-${slot.id}`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? (slot.isInstant ? "border-amber-500" : "border-[#364F9F]") : "border-slate-300"}`}>
                                      {isSelected && <div className={`w-2 h-2 rounded-full ${slot.isInstant ? "bg-amber-500" : "bg-[#364F9F]"}`} />}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <span className={`text-sm font-semibold block truncate ${slot.isInstant ? "text-amber-700" : "text-foreground"}`}>
                                        {adjustedLabel}
                                      </span>
                                    </div>
                                    {slot.isInstant && (slot.extraCharge ?? 0) > 0 && (
                                      <span className="text-xs font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full shrink-0">+₹{slot.extraCharge}</span>
                                    )}
                                  </div>
                                </button>
                              </div>
                            );})
                          )}
                        </div>
                    </div>

                    {/* Payment Method — hidden when wallet covers the full total */}
                    {finalTotal > 0 && (
                    <div className="px-4 mt-5 mb-4 space-y-3">
                      <h3 className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="w-4 h-4 inline-block"
                          style={{
                            backgroundColor: "#364F9F",
                            WebkitMaskImage: `url(${iconWalletImg})`,
                            maskImage: `url(${iconWalletImg})`,
                            WebkitMaskRepeat: "no-repeat",
                            maskRepeat: "no-repeat",
                            WebkitMaskSize: "contain",
                            maskSize: "contain",
                            WebkitMaskPosition: "center",
                            maskPosition: "center",
                          }}
                        />
                        Payment Method
                      </h3>
                      <div className="space-y-2">
                        <button
                            type="button"
                            className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-primary bg-primary/5 transition-all text-left"
                            data-testid="payment-online"
                          >
                            <div className="w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
                              <div className="w-2 h-2 rounded-full bg-primary" />
                            </div>
                            <span className="text-sm font-medium text-foreground">UPI</span>
                          </button>
                      </div>
                    </div>
                    )}
                  </div>

                  <div className="px-4 py-4 border-t border-border/30 bg-white sticky bottom-0 z-10">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        {(discountAmount > 0 || walletDeduction > 0) && (
                          <p className="text-xs text-muted-foreground line-through">₹{rawTotal}</p>
                        )}
                        <p className="text-xl font-bold text-primary">₹{finalTotal}</p>
                        {discountAmount > 0 && (
                          <p className="text-[10px] text-emerald-600 font-semibold">Saved ₹{discountAmount} with {appliedCoupon!.code}</p>
                        )}
                        {walletDeduction > 0 && (
                          <p className="text-[10px] font-semibold" style={{ color: "#364F9F" }}>−₹{walletDeduction} from Wallet</p>
                        )}
                        {pincodeDeliveryCharge > 0 && (
                          <p className="text-[10px] text-amber-600">incl. ₹{pincodeDeliveryCharge} delivery fee</p>
                        )}
                        {selectedTimeslot?.isInstant && (selectedTimeslot.extraCharge ?? 0) > 0 && (
                          <p className="text-[10px] text-amber-600">incl. ₹{selectedTimeslot.extraCharge} instant delivery</p>
                        )}
                      </div>
                      <Button
                        onClick={placeOrder}
                        disabled={isPending || isProcessingPayment || !customer || savedAddresses.length === 0 || !isHubReady}
                        className="h-12 px-8 !rounded-full font-bold bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-500/20 flex items-center gap-2"
                        data-testid="button-place-order"
                      >
                        {!isHubReady
                          ? <><Loader2 className="w-4 h-4 animate-spin" />Loading delivery details...</>
                          : isPending || isProcessingPayment
                          ? <><Loader2 className="w-4 h-4 animate-spin" />{paymentMethod === "online" && isProcessingPayment && finalTotal > 0 ? "Opening UPI..." : "Placing..."}</>
                          : <>{paymentMethod === "online" && finalTotal > 0 ? "Pay via UPI" : "Place Order"} <ChevronRight className="w-4 h-4" /></>
                        }
                      </Button>
                    </div>
                    {!customer && (
                      <p className="text-xs text-center text-muted-foreground mt-2">Please log in to place an order</p>
                    )}
                    {customer && savedAddresses.length === 0 && (
                      <p className="text-xs text-center text-muted-foreground mt-2">Please add a delivery address to proceed</p>
                    )}
                    {customer && savedAddresses.length > 0 && !selectedTimeslot && (
                      <p className="text-xs text-center text-muted-foreground mt-2">Please select a delivery time slot</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Add Address Dialog (deprecated - now inline in drawer) */}
      <Dialog open={false} onOpenChange={setShowAddForm}>
        <DialogContent className="max-w-2xl w-full rounded-2xl p-0 gap-0 flex flex-col max-h-[92vh]">
          <DialogHeader className="px-6 py-5 border-b border-border/30 shrink-0">
            <DialogTitle className="text-xl font-bold text-foreground flex items-center gap-2">
              <MapPin className="w-5 h-5 text-primary" /> Add Delivery Address
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-5">

            {/* Location Search + Current Location */}
            <div className="space-y-3">
              {/* Search input */}
              <div className="relative">
                {locSearching ? (
                  <Loader2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin pointer-events-none" />
                ) : (
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                )}
                <input
                  ref={locInputRef}
                  type="text"
                  value={locSearch}
                  onChange={e => { setLocSearch(e.target.value); setGeoFillStatus("idle"); setGeoFillMessage(""); }}
                  onFocus={() => locSearch.trim().length >= 2 && setShowLocDropdown(true)}
                  placeholder="Search area, locality, landmark or pincode..."
                  className="w-full h-12 pl-10 pr-10 rounded-2xl border-2 border-border/60 focus:border-primary/60 bg-slate-50 focus:bg-white text-sm font-medium placeholder:text-muted-foreground/60 outline-none transition-all"
                  data-testid="input-location-search-address"
                />
                {locSearch && (
                  <button
                    onClick={() => { setLocSearch(""); setLocResults([]); setShowLocDropdown(false); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-muted-foreground/20 flex items-center justify-center hover:bg-muted-foreground/30 transition-colors"
                  >
                    <X className="w-3 h-3 text-muted-foreground" />
                  </button>
                )}

                {/* Search Dropdown */}
                {showLocDropdown && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-2xl border border-border/50 shadow-2xl z-20 overflow-hidden">
                    {/* Use current location — always at top of dropdown */}
                    <button
                      onClick={() => { setShowLocDropdown(false); setLocSearch(""); handleAutoFillLocation(); }}
                      disabled={geoFilling}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-primary/5 transition-colors border-b border-border/30"
                    >
                      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Navigation className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-primary">Use current location</p>
                        <p className="text-xs text-muted-foreground">Auto-detect & fill area & pincode</p>
                      </div>
                    </button>

                    {locSearching ? (
                      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Finding locations...</span>
                      </div>
                    ) : locResults.length === 0 && locSearch.trim().length >= 2 ? (
                      <div className="px-4 py-3 text-sm text-muted-foreground">No results found. Try a different search term.</div>
                    ) : (
                      <div className="max-h-[220px] overflow-y-auto">
                        {locResults.map((feature, i) => {
                          const title = photonTitle(feature);
                          const subtitle = photonSubtitle(feature);
                          const postcode = feature.properties.postcode;
                          return (
                            <button
                              key={`${feature.properties.osm_id ?? i}`}
                              onClick={() => handleLocResultSelect(feature)}
                              className="w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors border-b border-border/10 last:border-0"
                            >
                              <div className="w-9 h-9 rounded-full bg-muted/60 flex items-center justify-center shrink-0 mt-0.5">
                                <MapPin className="w-4 h-4 text-muted-foreground" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-foreground truncate">{title}</p>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
                                {postcode && (
                                  <p className="text-[11px] text-primary/70 font-medium mt-0.5">Pincode: {postcode}</p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Persistent Use Current Location button */}
              <button
                type="button"
                onClick={handleAutoFillLocation}
                disabled={geoFilling}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl border-2 border-primary/20 bg-primary/5 hover:bg-primary/10 hover:border-primary/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                data-testid="button-use-current-location"
              >
                {geoFilling ? (
                  <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                ) : (
                  <Navigation className="w-5 h-5 text-primary shrink-0" />
                )}
                <div className="text-left flex-1">
                  <p className="text-sm font-semibold text-primary leading-tight">
                    {geoFilling ? "Detecting location..." : "Use current location"}
                  </p>
                  <p className="text-xs text-muted-foreground">Auto-fill area & pincode</p>
                </div>
              </button>

              {geoFillStatus === "success" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 border border-green-200 text-green-700 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>{geoFillMessage}</span>
                </div>
              )}
              {geoFillStatus === "error" && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{geoFillMessage}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground font-medium">or enter manually</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            {/* Contact Info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Full Name *</Label>
                <Input
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Recipient name"
                  className="rounded-xl h-11 border-border/60"
                  data-testid="input-address-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Phone *</Label>
                <Input
                  value={addForm.phone}
                  onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="10-digit number"
                  type="tel"
                  className="rounded-xl h-11 border-border/60"
                  data-testid="input-address-phone"
                />
              </div>
            </div>

            {/* Address type */}
            <div className="flex gap-2">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setAddForm(f => ({ ...f, type: opt.value }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                    addForm.type === opt.value
                      ? "bg-foreground text-white border-foreground"
                      : "bg-white text-muted-foreground border-border/50 hover:border-foreground/30"
                  }`}
                >
                  {opt.icon} {opt.label}
                </button>
              ))}
            </div>

            {addForm.type === "other" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Save As *</Label>
                <Input
                  value={addForm.label}
                  onChange={e => setAddForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Parents Home, Gym"
                  className="rounded-xl h-11 border-border/60"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Building / Floor *</Label>
              <Input
                value={addForm.building}
                onChange={e => setAddForm(f => ({ ...f, building: e.target.value }))}
                placeholder="e.g. Wing A, Flat 402"
                className="rounded-xl h-11 border-border/60"
                data-testid="input-address-building"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Street</Label>
              <Input
                value={addForm.street}
                onChange={e => setAddForm(f => ({ ...f, street: e.target.value }))}
                placeholder="e.g. MG Road"
                className="rounded-xl h-11 border-border/60"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Area *</Label>
                <Input
                  value={addForm.area}
                  onChange={e => setAddForm(f => ({ ...f, area: e.target.value }))}
                  placeholder="e.g. Andheri West"
                  className="rounded-xl h-11 border-border/60"
                  data-testid="input-address-area"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pincode</Label>
                <Input
                  value={addForm.pincode}
                  onChange={e => setAddForm(f => ({ ...f, pincode: e.target.value }))}
                  placeholder="400001"
                  type="tel"
                  maxLength={6}
                  className="rounded-xl h-11 border-border/60"
                />
              </div>
            </div>

          </div>

          <div className="px-6 py-5 border-t border-border/30 flex gap-3 shrink-0">
            <Button variant="outline" onClick={() => setShowAddForm(false)} className="flex-1 rounded-xl h-12">
              Cancel
            </Button>
            <Button
              onClick={saveAddress}
              disabled={isSavingAddress}
              className="flex-1 rounded-xl h-12 font-bold bg-primary text-white"
              data-testid="button-save-address"
            >
              {isSavingAddress ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Saving...</> : "Save Address"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unserviceable pincode popup */}
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
              deliver via <span className="font-semibold text-slate-700">Porter</span> right
              to your doorstep.
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
    </>
  );
}

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, ArrowLeft, X } from "lucide-react";
import { useHub, SuperHub, SubHub } from "@/context/HubContext";
import Lottie from "lottie-react";
import deliveryAnim from "@assets/animation-original_(21)_1779949238004.json";
import whatsappIcon from "@assets/logo_(16)_1779950540352.png";
import callIcon from "@assets/call_(2)_1779950579819.png";
import scooterImg from "@assets/animation-original_(51)_1779950354153.png";

const BRAND_BLUE = "#364F9F";
const PHONE = "+919220200100";
const PHONE_DISPLAY = "+91 92202 00100";
const WA_LINK = `https://wa.me/${PHONE.replace("+", "")}?text=${encodeURIComponent("Hi FishTokri! I'd like to place an order for outstation delivery.")}`;

type CheckStatus = "idle" | "checking" | "eligible" | "ineligible";

export function LocationPicker() {
  const { isPickerOpen, isPickerRequired, closePicker, skipPicker, setHub } = useHub();

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [status, setStatus] = useState<CheckStatus>("idle");
  const [areaName, setAreaName] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Lock body scroll when picker is open so the mobile keyboard doesn't shift the page
  useEffect(() => {
    if (isPickerOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollY}px`;
      document.body.style.width = "100%";
    } else {
      const scrollY = document.body.style.top;
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      if (scrollY) window.scrollTo(0, -parseInt(scrollY || "0", 10));
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
    };
  }, [isPickerOpen]);

  const pincode = digits.join("");

  const { data: allSubHubs = [] } = useQuery<SubHub[]>({
    queryKey: ["/api/hubs/sub-all"],
    queryFn: async () => {
      const res = await fetch("/api/hubs/sub", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: isPickerOpen,
  });

  const { data: superHubs = [] } = useQuery<SuperHub[]>({
    queryKey: ["/api/hubs/super"],
    enabled: isPickerOpen,
  });

  const reset = useCallback(() => {
    setDigits(["", "", "", "", "", ""]);
    setStatus("idle");
    setAreaName("");
    setTimeout(() => inputRefs.current[0]?.focus(), 150);
  }, []);

  const handleCheck = useCallback(() => {
    const clean = pincode.replace(/\s/g, "");
    if (clean.length !== 6) return;
    setStatus("checking");

    const matchedSub = allSubHubs.find((sub) =>
      sub.pincodes.some((p) => p.pincode.replace(/\s/g, "") === clean)
    );

    setTimeout(() => {
      if (matchedSub) {
        const matchedSuper = superHubs.find((s) => s.id === matchedSub.superHubId);
        if (matchedSuper) {
          setAreaName(matchedSub.name);
          setStatus("eligible");
          setHub(matchedSuper, matchedSub);
          setTimeout(() => { closePicker(); reset(); window.scrollTo({ top: 0, behavior: "instant" }); }, 2200);
          return;
        }
      }
      setStatus("ineligible");
    }, 600);
  }, [pincode, allSubHubs, superHubs, setHub, closePicker, reset]);

  const handleDigitChange = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newDigits = [...digits];
    newDigits[index] = digit;
    setDigits(newDigits);
    if (status !== "idle") setStatus("idle");
    if (digit && index < 5) inputRefs.current[index + 1]?.focus();
    if (digit && index === 5) {
      const full = newDigits.join("");
      if (full.length === 6) setTimeout(handleCheck, 50);
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (digits[index]) {
        const newDigits = [...digits];
        newDigits[index] = "";
        setDigits(newDigits);
        if (status !== "idle") setStatus("idle");
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    }
    if (e.key === "Enter" && pincode.length === 6) handleCheck();
    if (e.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length > 0) {
      const newDigits = [...pasted.split(""), ...Array(6 - pasted.length).fill("")].slice(0, 6);
      setDigits(newDigits);
      if (status !== "idle") setStatus("idle");
      inputRefs.current[Math.min(pasted.length, 5)]?.focus();
    }
    e.preventDefault();
  };

  const handleClose = () => { skipPicker(); reset(); };

  if (!isPickerOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center px-4"
      style={{ fontFamily: "'Poppins', sans-serif" }}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={isPickerRequired ? undefined : handleClose}
      />

      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        <button
          type="button"
          onClick={handleClose}
          aria-label="Skip pincode and view website"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
          data-testid="button-skip-pincode"
        >
          <X className="w-5 h-5" />
        </button>

        {/* ── INELIGIBLE SCREEN ── */}
        {status === "ineligible" ? (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 flex flex-col items-center px-6 pt-6 pb-7 text-center gap-0">

            {/* Scooter illustration */}
            <img
              src={scooterImg}
              alt="Delivery"
              className="w-36 h-auto object-contain mb-3"
            />

            {/* Headline */}
            <p className="text-base font-semibold text-slate-800 mb-1" style={{ fontWeight: 600 }}>
              We can still reach you! 🚚
            </p>

            {/* Body */}
            <p className="text-sm text-slate-500 leading-relaxed mb-1" style={{ fontWeight: 400 }}>
              Online ordering isn't available for{" "}
              <span className="font-semibold text-slate-700">{pincode}</span> yet, but we
              deliver via <span className="font-semibold text-slate-700">Porter</span> right
              to your doorstep.
            </p>

            {/* Outstation callout */}
            <div
              className="w-full rounded-2xl px-4 py-3 mb-4 text-left"
              style={{ backgroundColor: "#EEF1FA" }}
            >
              <p className="text-xs font-semibold mb-0.5" style={{ color: BRAND_BLUE }}>
                📦 Outstation Delivery Available
              </p>
              <p className="text-xs text-slate-500 leading-relaxed" style={{ fontWeight: 400 }}>
                We ship in insulated cold-store boxes so your seafood &amp; meat arrives
                perfectly fresh, no matter the distance.
              </p>
            </div>

            {/* Contact buttons */}
            <div className="w-full flex flex-col gap-2.5">
              <a
                href={WA_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-opacity hover:opacity-90 active:opacity-75"
                style={{ backgroundColor: "#25D366" }}
                data-testid="link-whatsapp-outstation"
              >
                <img src={whatsappIcon} alt="WhatsApp" className="w-7 h-7 rounded-lg flex-shrink-0" />
                <div className="text-left">
                  <p className="text-white text-xs font-semibold leading-none mb-0.5">Chat on WhatsApp</p>
                  <p className="text-white/90 text-xs font-normal">{PHONE_DISPLAY}</p>
                </div>
              </a>

              <a
                href={`tel:${PHONE}`}
                className="flex items-center gap-3 w-full rounded-2xl px-4 py-3 transition-opacity hover:opacity-90 active:opacity-75"
                style={{ backgroundColor: "#2196F3" }}
                data-testid="link-call-outstation"
              >
                <img src={callIcon} alt="Call" className="w-7 h-7 rounded-full flex-shrink-0" />
                <div className="text-left">
                  <p className="text-white text-xs font-semibold leading-none mb-0.5">Call Us</p>
                  <p className="text-white/90 text-xs font-normal">{PHONE_DISPLAY}</p>
                </div>
              </a>
            </div>

            {/* Try again / skip */}
            <div className="mt-4 flex items-center justify-center gap-4 text-xs font-medium">
              <button
                onClick={reset}
                className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
                style={{ color: BRAND_BLUE }}
                data-testid="button-try-another-pincode"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Try another pincode
              </button>
              <span className="text-slate-300" aria-hidden="true">|</span>
              <button
                onClick={handleClose}
                className="transition-opacity hover:opacity-70"
                style={{ color: BRAND_BLUE }}
                data-testid="button-navigate-website"
              >
                Navigate Website
              </button>
            </div>
          </div>

        ) : (
          /* ── MAIN PINCODE SCREEN ── */
          <>
            {/* Lottie animation */}
            <div className="flex justify-center pt-7 pb-1 px-6">
              <div className="w-44 h-44">
                <Lottie animationData={deliveryAnim} loop autoplay />
              </div>
            </div>

            {/* Text */}
            <div className="px-7 pb-2 text-center">
              <h2 className="text-lg mb-1.5 text-slate-800" style={{ fontWeight: 500 }}>
                Enter Your Pincode
              </h2>
              <p className="text-sm leading-relaxed font-normal text-black">
                Freshly cut seafood &amp; meat, hygienically packed and delivered to your doorstep.
              </p>
            </div>

            {/* 6-box pincode input */}
            <div className="px-7 py-5">
              <div className="flex items-center justify-center gap-2">
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => { inputRefs.current[i] = el; }}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(i, e)}
                    onPaste={i === 0 ? handlePaste : undefined}
                    autoFocus={i === 0}
                    className="w-10 h-10 text-center text-base font-semibold rounded-lg border-2 outline-none transition-all duration-150 text-slate-800"
                    style={{
                      borderColor:
                        status === "eligible" ? "#22c55e" : digit ? BRAND_BLUE : "#e2e8f0",
                      boxShadow: digit ? `0 0 0 2px ${BRAND_BLUE}20` : "none",
                      fontFamily: "'Poppins', sans-serif",
                    }}
                    data-testid={`input-pincode-${i}`}
                  />
                ))}
              </div>

              {/* Success message */}
              {status === "eligible" && (
                <div className="flex items-center justify-center gap-2 mt-3 animate-in fade-in duration-200">
                  <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                  <p className="text-sm font-medium text-green-700" style={{ fontWeight: 500 }}>
                    We deliver to <span className="font-semibold">{areaName}</span>! 🎉
                  </p>
                </div>
              )}
            </div>

            {/* Button */}
            <div className="px-7 pb-7">
              <button
                onClick={handleCheck}
                disabled={pincode.length !== 6 || status === "checking"}
                className="w-full h-12 rounded-full text-white text-sm transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                style={{ backgroundColor: BRAND_BLUE, fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}
                data-testid="button-check-pincode"
              >
                {status === "checking" ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking...
                  </>
                ) : (
                  "Check Availability"
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

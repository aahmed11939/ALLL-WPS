import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth } from "@clerk/react";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";

const API_BASE = import.meta.env.VITE_API_SERVER_URL ?? "";

export default function SubscribePage() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const cancelled = new URLSearchParams(search).get("cancelled") === "true";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubscribe = async () => {
    if (!isSignedIn) {
      setLocation("/sign-up");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/billing/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (err: any) {
      setError(err.message ?? "An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const features = [
    "Full hydraulic system design (Darcy-Weisbach + Hazen-Williams)",
    "Surge/transient analysis using Method of Characteristics",
    "Pump curve overlay and operating-point finder",
    "Wet-well sizing and duty-cycle calculations",
    "Professional PDF / Excel report export",
    "Unlimited saved projects",
    "Priority engineering support",
  ];

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Nav */}
      <header className="border-b border-slate-200 bg-white px-6 py-4 flex items-center gap-4 shadow-sm">
        <button
          type="button"
          onClick={() => setLocation("/")}
          className="flex items-center gap-3"
        >
          <img src={wpsLogo} alt="ALLL WPS Designer" className="h-9 w-auto" />
          <div className="text-left">
            <p className="text-sm font-bold text-slate-900 leading-tight">ALLL WPS Designer</p>
            <p className="text-[10px] text-slate-400 font-mono">Municipal Drinking-Water Pump Station</p>
          </div>
        </button>
        <div className="ml-auto">
          {isSignedIn ? (
            <button
              type="button"
              onClick={() => setLocation("/app")}
              className="text-sm font-medium text-teal-700 hover:text-teal-600 transition-colors"
            >
              Go to app →
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setLocation("/sign-in")}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md">
          {cancelled && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
              <svg className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <p className="text-sm text-amber-800">
                Checkout was cancelled — no payment was made. You can try again whenever you're ready.
              </p>
            </div>
          )}

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Plan header */}
            <div className="bg-teal-700 px-8 py-8 text-white text-center">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal-200 mb-2">
                Annual Plan
              </p>
              <div className="flex items-baseline justify-center gap-1 mb-1">
                <span className="text-4xl font-bold">$4,999</span>
                <span className="text-teal-200 text-sm">/year</span>
              </div>
              <p className="text-teal-100 text-sm">Per seat · Cancel anytime</p>
            </div>

            <div className="px-8 py-6">
              <p className="text-sm font-semibold text-slate-700 mb-4">Everything you need:</p>
              <ul className="space-y-3 mb-8">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-3 text-sm text-slate-700">
                    <svg className="h-4 w-4 text-teal-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>

              {error && (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5">
                  <p className="text-xs text-rose-700">{error}</p>
                </div>
              )}

              <button
                type="button"
                onClick={handleSubscribe}
                disabled={loading}
                className="w-full rounded-xl bg-teal-700 px-4 py-3.5 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Starting checkout…
                  </span>
                ) : isSignedIn ? (
                  "Subscribe — $4,999/year"
                ) : (
                  "Create account & subscribe"
                )}
              </button>

              <p className="mt-3 text-center text-xs text-slate-400">
                Secure payment via Stripe · 30-day refund policy
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

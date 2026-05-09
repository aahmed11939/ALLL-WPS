import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { useAuth, useUser, useClerk } from "@clerk/react";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";
import { useBillingStatus, formatRenewalDate } from "../hooks/useBillingStatus";

const API_BASE = import.meta.env.VITE_API_SERVER_URL ?? "";

export default function SubscribePage() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const cancelled = new URLSearchParams(search).get("cancelled") === "true";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  const { status: billingStatus } = useBillingStatus();

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
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url ?? "/subscribe";
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred. Please try again.");
      setLoading(false);
    }
  };

  const handleBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not open billing portal.");
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal.");
    } finally {
      setPortalLoading(false);
    }
  };

  const features = [
    "Full hydraulic system design (Darcy-Weisbach + Hazen-Williams)",
    "Surge/transient analysis using Method of Characteristics",
    "Pump curve overlay and operating-point finder",
    "Clearwell sizing and duty-cycle calculations",
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
          className="flex items-center gap-3 shrink-0"
        >
          <img src={wpsLogo} alt="ALLL WPS Designer" className="h-9 w-auto" />
          <div className="text-left hidden sm:block">
            <p className="text-sm font-bold text-slate-900 leading-tight">ALLL WPS Designer</p>
            <p className="text-[10px] text-slate-400 font-mono">Municipal Drinking-Water Pump Station</p>
          </div>
        </button>

        <div className="ml-auto flex items-center gap-3">
          {isSignedIn ? (
            <>
              {/* User email */}
              {user?.primaryEmailAddress?.emailAddress && (
                <span className="hidden sm:block text-[11px] text-slate-400 truncate max-w-[160px]">
                  {user.primaryEmailAddress.emailAddress}
                </span>
              )}

              {/* Subscription status pill */}
              {billingStatus && !billingStatus.whitelisted && (
                billingStatus.active ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
                    <span className="hidden sm:inline">
                      Active subscription
                      {billingStatus.renewsAt && (
                        <span className="text-teal-500">
                          {" "}— renews {formatRenewalDate(billingStatus.renewsAt)}
                        </span>
                      )}
                    </span>
                    <span className="sm:hidden">Active</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="hidden sm:inline">No active subscription</span>
                    <span className="sm:hidden">Inactive</span>
                  </span>
                )
              )}

              {/* Manage billing — only for active, non-whitelisted subscribers */}
              {billingStatus?.active && !billingStatus.whitelisted && (
                <button
                  type="button"
                  onClick={handleBillingPortal}
                  disabled={portalLoading}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors disabled:opacity-50"
                >
                  {portalLoading ? "…" : "Manage billing"}
                </button>
              )}

              {/* Go to app if active, or sign out */}
              {billingStatus?.active ? (
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
                  onClick={() => signOut({ redirectUrl: `${window.location.origin}/sign-in` })}
                  className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Sign out
                </button>
              )}
            </>
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

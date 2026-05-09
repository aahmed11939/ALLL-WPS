import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import { invalidateBillingCache } from "../hooks/useBillingStatus";

const API_BASE = import.meta.env.VITE_API_SERVER_URL ?? "";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

interface ToastProps {
  message: string;
  visible: boolean;
}

function Toast({ message, visible }: ToastProps) {
  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none"
      }`}
    >
      <div className="flex items-center gap-3 rounded-xl bg-teal-700 px-5 py-3 shadow-lg text-white text-sm font-semibold">
        <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        {message}
      </div>
    </div>
  );
}

export default function CheckoutSuccess() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [activated, setActivated] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const startedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;

    const poll = async () => {
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        if (timer.current) clearInterval(timer.current);
        setTimedOut(true);
        setTimeout(() => setLocation("/app"), 2000);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/billing/status`, {
          credentials: "include",
        });
        const data = (await res.json()) as { active: boolean };
        if (data.active) {
          if (timer.current) clearInterval(timer.current);
          // Bust the billing cache so SubscriptionGate and all useBillingStatus
          // consumers immediately see the new active state without waiting for TTL.
          // Guard on user.id to avoid accidentally clearing all users' cache entries.
          if (user?.id) invalidateBillingCache(user.id);
          setActivated(true);
          setShowToast(true);
          setTimeout(() => setLocation("/app"), 2500);
        }
      } catch {
        // Retry on next interval
      }
    };

    poll();
    timer.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [isSignedIn, user, setLocation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <div
          className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-6 transition-colors duration-300 ${
            activated ? "bg-teal-100" : "bg-slate-100"
          }`}
        >
          {activated ? (
            <svg
              className="h-8 w-8 text-teal-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M5 13l4 4L19 7"
              />
            </svg>
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
          )}
        </div>

        <h2 className="text-xl font-bold text-slate-900 mb-2">
          {timedOut
            ? "Almost there — entering the app…"
            : activated
              ? "Subscription confirmed!"
              : "Confirming your subscription…"}
        </h2>

        <p className="text-sm text-slate-500">
          {timedOut
            ? "Subscription is processing — you'll have full access shortly."
            : activated
              ? "Redirecting you to the app now."
              : "Hang tight while we confirm your payment with Stripe."}
        </p>
      </div>

      <Toast message="Subscription activated! Welcome aboard." visible={showToast} />
    </div>
  );
}

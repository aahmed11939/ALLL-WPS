import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@clerk/react";

const API_BASE = import.meta.env.VITE_API_SERVER_URL ?? "";
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

export default function CheckoutSuccess() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const [statusMsg, setStatusMsg] = useState("Confirming your subscription…");
  const [activated, setActivated] = useState(false);
  const startedAt = useRef(Date.now());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;

    const poll = async () => {
      if (Date.now() - startedAt.current > POLL_TIMEOUT_MS) {
        if (timer.current) clearInterval(timer.current);
        setStatusMsg("Taking longer than expected — you're all set though! Entering the app…");
        setTimeout(() => setLocation("/app"), 2000);
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/billing/status`, {
          credentials: "include",
        });
        const data = await res.json();
        if (data.active) {
          if (timer.current) clearInterval(timer.current);
          setActivated(true);
          setStatusMsg("Subscription activated! Welcome aboard.");
          setTimeout(() => setLocation("/app"), 2000);
        }
      } catch {
        // Retry on next interval
      }
    };

    poll();
    timer.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [isSignedIn, setLocation]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="text-center max-w-sm">
        <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-6 ${activated ? "bg-teal-100" : "bg-slate-100"}`}>
          {activated ? (
            <svg className="h-8 w-8 text-teal-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
          )}
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">{statusMsg}</h2>
        {!activated && (
          <p className="text-sm text-slate-500">
            Hang tight while we confirm your payment with Stripe.
          </p>
        )}
      </div>
    </div>
  );
}

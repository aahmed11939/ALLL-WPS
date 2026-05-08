import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { useLocation } from "wouter";

const ADMIN_EMAIL = "azizahmed1234@gmail.com";
const API_BASE = import.meta.env.VITE_API_SERVER_URL ?? "";

type GateState = "loading" | "allowed" | "blocked" | "error";

interface Props {
  children: React.ReactNode;
}

export default function SubscriptionGate({ children }: Props) {
  const { user, isLoaded } = useUser();
  const [, setLocation] = useLocation();
  const [gateState, setGateState] = useState<GateState>("loading");

  useEffect(() => {
    if (!isLoaded || !user) return;

    const email = user.primaryEmailAddress?.emailAddress ?? "";

    if (email === ADMIN_EMAIL) {
      setGateState("allowed");
      return;
    }

    let cancelled = false;

    fetch(`${API_BASE}/api/billing/status`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
        return res.json() as Promise<{ active: boolean; whitelisted?: boolean }>;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.active) {
          setGateState("allowed");
        } else {
          setGateState("blocked");
          setLocation("/subscribe");
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Fail-closed: on any network/auth error, block access and send to subscribe
        setGateState("blocked");
        setLocation("/subscribe");
      });

    return () => {
      cancelled = true;
    };
  }, [isLoaded, user, setLocation]);

  if (gateState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
      </div>
    );
  }

  if (gateState === "blocked" || gateState === "error") return null;

  return <>{children}</>;
}

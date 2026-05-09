import { useEffect } from "react";
import { useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useBillingStatus } from "../hooks/useBillingStatus";

interface Props {
  children: React.ReactNode;
}

export default function SubscriptionGate({ children }: Props) {
  const { isLoaded, user } = useUser();
  const [, setLocation] = useLocation();
  const { status, loadState } = useBillingStatus();

  useEffect(() => {
    if (!isLoaded || !user) return;
    if (loadState !== "ready") return;
    if (!status?.active) {
      setLocation("/subscribe");
    }
  }, [isLoaded, user, loadState, status, setLocation]);

  // Not yet signed in or billing check in flight → show spinner
  if (!isLoaded || loadState === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
      </div>
    );
  }

  // Error or inactive → redirect handled above, render nothing while navigating
  if (loadState === "error" || !status?.active) return null;

  return <>{children}</>;
}

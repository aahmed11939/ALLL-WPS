import { useEffect } from "react";
import { useUser } from "@clerk/react";
import { useLocation } from "wouter";
import { useBillingStatus } from "../hooks/useBillingStatus";

const ADMIN_EMAIL = "azizahmed1234@gmail.com";

interface Props {
  children: React.ReactNode;
}

export default function SubscriptionGate({ children }: Props) {
  const { isLoaded, user } = useUser();
  const [, setLocation] = useLocation();

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  // isAdmin is only true once Clerk is loaded and email matches
  const isAdmin = isLoaded && email === ADMIN_EMAIL;

  // Pass skip=true once admin is confirmed to avoid any billing API call
  const { status, loadState } = useBillingStatus({ skip: isAdmin });

  useEffect(() => {
    if (!isLoaded || !user) return;
    if (isAdmin) return; // admin is always allowed — no billing check needed
    if (loadState === "loading") return; // wait for result
    // Fail-closed: redirect on both "error" and inactive "ready" states
    if (loadState === "error" || !status?.active) {
      const hadPriorSubscription = loadState === "ready" && !!status?.renewsAt;
      setLocation(hadPriorSubscription ? "/subscribe?lapsed=true" : "/subscribe");
    }
  }, [isLoaded, user, isAdmin, loadState, status, setLocation]);

  // Show spinner while Clerk or billing status is loading
  if (!isLoaded || (!isAdmin && loadState === "loading")) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-teal-600 border-t-transparent" />
      </div>
    );
  }

  // Non-admin with error or inactive subscription — render nothing while redirect fires
  if (!isAdmin && (loadState === "error" || !status?.active)) return null;

  return <>{children}</>;
}

import { useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_SERVER_URL as string | undefined) ?? "";

export interface BillingStatus {
  active: boolean;
  whitelisted?: boolean;
  renewsAt: string | null;
  reason?: string;
}

type LoadState = "loading" | "ready" | "error";

export interface UseBillingStatusResult {
  status: BillingStatus | null;
  loadState: LoadState;
  refetch: () => void;
}

export function useBillingStatus(): UseBillingStatusResult {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");

    fetch(`${API_BASE}/api/billing/status`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<BillingStatus>;
      })
      .then((data) => {
        if (cancelled) return;
        setStatus(data);
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { status, loadState, refetch: () => setTick((t) => t + 1) };
}

export function formatRenewalDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  try {
    return new Date(isoDate).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";

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

// ---------------------------------------------------------------------------
// Module-level in-memory cache (cleared on page unload, never persisted)
// ---------------------------------------------------------------------------
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_TTL_MS = (() => {
  const raw = (import.meta.env.VITE_BILLING_CACHE_TTL_MS as string | undefined) ?? "";
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_TTL_MS;
})();

interface CacheEntry {
  data: BillingStatus;
  expiresAt: number;
}

const billingCache = new Map<string, CacheEntry>();

function getCached(key: string): BillingStatus | null {
  const entry = billingCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    billingCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: BillingStatus): void {
  billingCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Invalidate one user's entry (pass userId) or clear all entries. */
export function invalidateBillingCache(userId?: string): void {
  if (userId) {
    billingCache.delete(userId);
  } else {
    billingCache.clear();
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useBillingStatus(): UseBillingStatusResult {
  const { user } = useUser();
  const cacheKey = user?.id ?? "";

  const [status, setStatus] = useState<BillingStatus | null>(() =>
    cacheKey ? getCached(cacheKey) : null,
  );
  const [loadState, setLoadState] = useState<LoadState>(() =>
    cacheKey && getCached(cacheKey) ? "ready" : "loading",
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!cacheKey) return;

    // Serve from cache when fresh
    const cached = getCached(cacheKey);
    if (cached) {
      setStatus(cached);
      setLoadState("ready");
      return;
    }

    let cancelled = false;
    setLoadState("loading");

    fetch(`${API_BASE}/api/billing/status`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<BillingStatus>;
      })
      .then((data) => {
        if (cancelled) return;
        setCached(cacheKey, data);
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
  }, [tick, cacheKey]);

  const refetch = () => {
    if (cacheKey) invalidateBillingCache(cacheKey);
    setTick((t) => t + 1);
  };

  return { status, loadState, refetch };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function formatRenewalDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

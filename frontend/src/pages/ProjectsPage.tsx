import { useEffect, useState, useCallback } from "react";
import { useClerk, useUser } from "@clerk/react";
import { useLocation } from "wouter";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";
import {
  listProjects,
  deleteProject,
  fetchProject,
  type ProjectMeta,
  type ProjectLoadResponse,
} from "../utils/api";
import { useBillingStatus, formatRenewalDate } from "../hooks/useBillingStatus";

interface Props {
  onOpenProject: (row: ProjectLoadResponse) => void;
  onNewProject: () => void;
  onImportJSON?: () => void;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
      <div className="h-16 w-16 rounded-2xl bg-teal-50 flex items-center justify-center">
        <svg className="h-8 w-8 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m-9 1V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
        </svg>
      </div>
      <div>
        <p className="text-sm font-semibold text-slate-700">No saved projects yet</p>
        <p className="text-xs text-slate-400 mt-1">Create a new project to get started.</p>
      </div>
      <div className="flex items-center gap-3 mt-2">
        <button
          type="button"
          onClick={onNew}
          className="rounded-lg bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-600 transition-colors shadow-sm"
        >
          New Project
        </button>
      </div>
    </div>
  );
}

const API_BASE = (import.meta.env.VITE_API_SERVER_URL as string | undefined) ?? "";

const ADMIN_EMAIL = "azizahmed1234@gmail.com";

export default function ProjectsPage({ onOpenProject, onNewProject, onImportJSON: _onImportJSON }: Props) {
  const { signOut } = useClerk();
  const { user } = useUser();
  const [, setLocation] = useLocation();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingSlug, setOpeningSlug] = useState<string | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  const { status: billingStatus } = useBillingStatus();

  const handleBillingPortal = async () => {
    setBillingLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not open billing portal.");
      window.open(data.url, "_blank");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal.");
    } finally {
      setBillingLoading(false);
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listProjects();
      setProjects(res.projects);
    } catch {
      setError("Could not load projects — make sure the backend is running.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const handleOpen = async (slug: string) => {
    setOpeningSlug(slug);
    try {
      const row = await fetchProject(slug);
      onOpenProject(row);
    } catch {
      setError(`Failed to load project "${slug}".`);
    } finally {
      setOpeningSlug(null);
    }
  };

  const handleDeleteConfirmed = async (slug: string) => {
    setDeletingSlug(slug);
    setDeleteConfirm(null);
    try {
      await deleteProject(slug);
      setProjects((prev) => prev.filter((p) => p.slug !== slug));
    } catch {
      setError(`Failed to delete project "${slug}".`);
    } finally {
      setDeletingSlug(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center gap-4">
          <img src={wpsLogo} alt="WPS logo" className="h-9 w-auto shrink-0" />
          <div>
            <p className="text-sm font-bold text-slate-900 leading-tight">ALLL WPS Designer</p>
            <p className="text-[10px] text-slate-400 font-mono leading-none">
              Municipal Drinking-Water Pump Station
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            {user?.primaryEmailAddress?.emailAddress && (
              <span className="text-[11px] text-slate-400 hidden sm:block truncate max-w-[180px]">
                {user.primaryEmailAddress.emailAddress}
              </span>
            )}

            {/* Subscription status pill */}
            {billingStatus && !billingStatus.whitelisted && (
              <div className="flex items-center gap-2">
                {billingStatus.active ? (
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
                  <button
                    type="button"
                    onClick={() => setLocation("/subscribe")}
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                    <span className="hidden sm:inline">No active subscription — subscribe</span>
                    <span className="sm:hidden">Subscribe</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={onNewProject}
              className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-600 transition-colors shadow-sm"
            >
              + New Project
            </button>

            {/* Manage billing — only shown when user has a Stripe customer */}
            {billingStatus?.active && !billingStatus.whitelisted && (
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={billingLoading}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors disabled:opacity-50"
                title="Manage subscription"
              >
                {billingLoading ? "…" : "Manage billing"}
              </button>
            )}

            {user?.primaryEmailAddress?.emailAddress?.toLowerCase() === ADMIN_EMAIL.toLowerCase() && (
              <button
                type="button"
                onClick={() => setLocation("/admin")}
                className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-100 transition-colors"
                title="Admin Panel"
              >
                Admin
              </button>
            )}
            <button
              type="button"
              onClick={() => signOut({ redirectUrl: `${window.location.origin}/sign-in` })}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 hover:border-slate-300 transition-colors"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-lg font-bold text-slate-800">Projects</h1>
          {projects.length > 0 && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500 font-mono">
              {projects.length}
            </span>
          )}
          <button
            type="button"
            onClick={refresh}
            className="ml-auto text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState onNew={onNewProject} />
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Project Name
                  </th>
                  <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden sm:table-cell">
                    Created
                  </th>
                  <th className="py-3 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Last Modified
                  </th>
                  <th className="py-3 px-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((p) => (
                  <tr key={p.slug} className="hover:bg-slate-50 transition-colors group">
                    <td className="py-3.5 px-4">
                      <div>
                        <p className="font-semibold text-slate-800">{p.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{p.slug}</p>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 font-mono hidden sm:table-cell">
                      {formatDate(p.created_at)}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-500 font-mono">
                      {formatDate(p.updated_at)}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => handleOpen(p.slug)}
                          disabled={openingSlug === p.slug}
                          className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                        >
                          {openingSlug === p.slug ? (
                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
                          ) : null}
                          Open
                        </button>

                        {deleteConfirm === p.slug ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-rose-600 font-medium">Confirm?</span>
                            <button
                              type="button"
                              onClick={() => handleDeleteConfirmed(p.slug)}
                              disabled={deletingSlug === p.slug}
                              className="rounded border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirm(null)}
                              className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(p.slug)}
                            className="rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600 hover:bg-rose-50 transition-colors opacity-0 group-hover:opacity-100"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 py-4 text-center text-[10px] text-slate-400 font-mono">
        ALLL WPS Designer · Projects are saved server-side. Export JSON for offline backups.
      </footer>
    </div>
  );
}

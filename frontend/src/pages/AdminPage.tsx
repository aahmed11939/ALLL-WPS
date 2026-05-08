import { useState, useEffect, useCallback } from "react";
import { useUser } from "@clerk/react";
import { useLocation } from "wouter";

const ADMIN_EMAIL = "azizahmed1234@gmail.com";
const API_BASE = (import.meta.env.VITE_API_SERVER_URL as string | undefined) ?? "";

function adminFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}/api/admin${path}`, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface WhitelistEntry {
  id: number;
  email: string;
  active: boolean | null;
  createdAt: string | null;
}

interface AdminUser {
  id: string;
  email: string | null;
  clerkUserId: string | null;
  stripeCustomerId: string | null;
  role: string | null;
  active: boolean | null;
  createdAt: string | null;
}

interface Project {
  slug: string;
  name: string;
  owner_email?: string;
  created_at: string;
  updated_at: string;
}

interface AuditLog {
  id: number;
  actorEmail: string | null;
  action: string;
  target: string | null;
  details: unknown;
  createdAt: string | null;
}

// ── Shared ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
    return d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusPill({ active }: { active: boolean | null }) {
  const on = active !== false;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold
      ${on ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600"}`}>
      {on ? "Active" : "Inactive"}
    </span>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700 mb-4">
      {msg}
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-teal-600 border-t-transparent" />
    </div>
  );
}

// ── Tab 1: Whitelist ──────────────────────────────────────────────────────────

function WhitelistTab() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/whitelist");
      const data = (await res.json()) as { entries?: WhitelistEntry[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load whitelist");
      setEntries(data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load whitelist");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAdd = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setAdding(true);
    setError(null);
    try {
      const res = await adminFetch("/whitelist", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { entry?: WhitelistEntry; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to add email");
      if (data.entry) setEntries((prev) => [data.entry!, ...prev]);
      setNewEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add email");
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (entry: WhitelistEntry) => {
    try {
      const res = await adminFetch(`/whitelist/${entry.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !entry.active }),
      });
      const data = (await res.json()) as { entry?: WhitelistEntry; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update");
      if (data.entry) {
        setEntries((prev) => prev.map((e) => e.id === entry.id ? data.entry! : e));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle");
    }
  };

  const handleRemove = async (entry: WhitelistEntry) => {
    try {
      const res = await adminFetch(`/whitelist/${entry.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to remove");
      }
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  return (
    <div>
      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Add email to whitelist</label>
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleAdd(); }}
            placeholder="engineer@company.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleAdd()}
          disabled={adding || !newEmail.trim()}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </div>

      {error && <ErrorBanner msg={error} />}
      {loading ? <Spinner /> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden sm:table-cell">Date Added</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {entries.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-sm text-slate-400">No whitelisted emails</td></tr>
              )}
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-xs text-slate-700">{entry.email}</td>
                  <td className="py-3 px-4"><StatusPill active={entry.active} /></td>
                  <td className="py-3 px-4 text-xs text-slate-500 hidden sm:table-cell">{formatDate(entry.createdAt)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void handleToggle(entry)}
                        className="rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        {entry.active !== false ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRemove(entry)}
                        className="rounded border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Users ──────────────────────────────────────────────────────────────

function UsersTab() {
  const [userList, setUserList] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/users");
      const data = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load users");
      setUserList(data.users ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleInvite = async () => {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;
    setInviting(true);
    setError(null);
    try {
      const res = await adminFetch("/users/invite", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to invite");
      setInviteEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  const handlePatch = async (user: AdminUser, patch: { role?: string; active?: boolean }) => {
    try {
      const res = await adminFetch(`/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      const data = (await res.json()) as { user?: AdminUser; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update user");
      if (data.user) {
        setUserList((prev) => prev.map((u) => u.id === user.id ? data.user! : u));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user");
    }
  };

  return (
    <div>
      <div className="flex items-end gap-2 mb-4">
        <div className="flex-1">
          <label className="block text-xs font-semibold text-slate-600 mb-1">Invite team member by email</label>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleInvite(); }}
            placeholder="engineer@company.com"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
        </div>
        <button
          type="button"
          onClick={() => void handleInvite()}
          disabled={inviting || !inviteEmail.trim()}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 transition-colors"
        >
          {inviting ? "Inviting…" : "Invite"}
        </button>
      </div>

      {error && <ErrorBanner msg={error} />}
      {loading ? <Spinner /> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Email</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden md:table-cell">Stripe ID</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden sm:table-cell">Joined</th>
                <th className="py-2.5 px-4 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {userList.length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-sm text-slate-400">No registered users yet</td></tr>
              )}
              {userList.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 text-xs text-slate-700">
                    <div className="font-medium">{u.email ?? "—"}</div>
                    <div className="font-mono text-slate-400">{u.clerkUserId ?? ""}</div>
                  </td>
                  <td className="py-3 px-4 font-mono text-[10px] text-slate-400 hidden md:table-cell">
                    {u.stripeCustomerId ?? "—"}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold
                      ${u.role === "admin" ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600"}`}>
                      {u.role === "admin" ? "Admin" : "User"}
                    </span>
                  </td>
                  <td className="py-3 px-4"><StatusPill active={u.active} /></td>
                  <td className="py-3 px-4 text-xs text-slate-500 hidden sm:table-cell">{formatDate(u.createdAt)}</td>
                  <td className="py-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handlePatch(u, { role: u.role === "admin" ? "user" : "admin" })}
                        className="rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        {u.role === "admin" ? "Demote" : "Promote"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handlePatch(u, { active: !u.active })}
                        className="rounded border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        {u.active !== false ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Projects ───────────────────────────────────────────────────────────

function ProjectsTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch("/projects");
      const data = (await res.json()) as { projects?: Project[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load projects");
      setProjects(data.projects ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Spinner /> : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Project Name</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden sm:table-cell">Owner</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden md:table-cell">Created</th>
                <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Last Modified</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {projects.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-sm text-slate-400">No projects found</td></tr>
              )}
              {projects.map((p) => (
                <tr key={p.slug} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-800 text-sm">{p.name}</div>
                    <div className="font-mono text-[10px] text-slate-400">{p.slug}</div>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-500 hidden sm:table-cell">{p.owner_email ?? "—"}</td>
                  <td className="py-3 px-4 text-xs text-slate-500 font-mono hidden md:table-cell">{formatDate(p.created_at)}</td>
                  <td className="py-3 px-4 text-xs text-slate-500 font-mono">{formatDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Tab 4: Audit Logs ─────────────────────────────────────────────────────────

function AuditLogsTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminFetch(`/audit-logs?page=${p}`);
      const data = (await res.json()) as { logs?: AuditLog[]; pages?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load audit logs");
      setLogs(data.logs ?? []);
      setTotalPages(data.pages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(page); }, [load, page]);

  return (
    <div>
      {error && <ErrorBanner msg={error} />}
      {loading ? <Spinner /> : (
        <>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Timestamp</th>
                  <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden sm:table-cell">Actor</th>
                  <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                  <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Target</th>
                  <th className="py-2.5 px-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hidden md:table-cell">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.length === 0 && (
                  <tr><td colSpan={5} className="py-12 text-center text-sm text-slate-400">No audit events yet</td></tr>
                )}
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 text-[10px] text-slate-500 font-mono whitespace-nowrap">{formatDate(log.createdAt)}</td>
                    <td className="py-3 px-4 text-xs text-slate-600 hidden sm:table-cell">{log.actorEmail ?? "—"}</td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-mono font-semibold text-slate-700">
                        {log.action}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">{log.target ?? "—"}</td>
                    <td className="py-3 px-4 text-[10px] font-mono text-slate-400 hidden md:table-cell">
                      {log.details ? JSON.stringify(log.details) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ← Prev
              </button>
              <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

type Tab = "whitelist" | "users" | "projects" | "audit";

const TABS: { id: Tab; label: string }[] = [
  { id: "whitelist", label: "Email Whitelist" },
  { id: "users", label: "Registered Users" },
  { id: "projects", label: "Projects" },
  { id: "audit", label: "Audit Logs" },
];

export default function AdminPage() {
  const { user, isLoaded } = useUser();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState<Tab>("whitelist");

  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();

  useEffect(() => {
    if (!isLoaded) return;
    if (isAdmin) {
      // Log admin login event (fire-and-forget)
      void adminFetch("/login-event", { method: "POST" });
      return;
    }
    // Show "Not authorised" briefly then redirect
    const id = setTimeout(() => setLocation("/"), 2500);
    return () => clearTimeout(id);
  }, [isLoaded, isAdmin, setLocation]);

  if (!isLoaded) return null;

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-center max-w-sm px-6">
          <div className="h-12 w-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
            <svg className="h-6 w-6 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mb-2">Not authorised</h2>
          <p className="text-sm text-slate-500">You don't have permission to access the admin panel. Redirecting…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => setLocation("/app")}
            className="text-sm font-medium text-teal-700 hover:text-teal-600 flex items-center gap-1.5 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to App
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <h1 className="text-sm font-bold text-slate-900">Admin Panel</h1>
          <span className="inline-flex items-center rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
            {email}
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-6 flex-1">
        {/* Tabs */}
        <div className="flex gap-1 border-b border-slate-200 mb-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
                ${activeTab === tab.id
                  ? "border-teal-700 text-teal-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "whitelist" && <WhitelistTab />}
        {activeTab === "users" && <UsersTab />}
        {activeTab === "projects" && <ProjectsTab />}
        {activeTab === "audit" && <AuditLogsTab />}
      </div>
    </div>
  );
}

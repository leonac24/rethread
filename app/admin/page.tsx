'use client';

// Bare-bones admin page: pending retailer applications with an approve button.
// Deliberately unauthenticated (MVP) — do not ship to real users as-is.

import { useEffect, useState } from 'react';

type Application = {
  uid: string;
  email: string | null;
  storeName: string | null;
  street1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  appliedAt: number;
};

export default function AdminPage() {
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [approvedUids, setApprovedUids] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/retailers', { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { error?: string; applications?: Application[] };
        if (!res.ok) throw new Error(body.error ?? 'Failed to load applications.');
        if (!cancelled) setApplications(body.applications ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load applications.');
          setApplications([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleApprove(uid: string) {
    setBusyUid(uid);
    setError(null);
    try {
      const res = await fetch(`/api/admin/retailers/${uid}/approve`, { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to approve.');
      setApprovedUids((prev) => new Set(prev).add(uid));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve.');
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width space-y-6">
        <div className="pt-4">
          <h1 className="text-[24px] font-bold text-ink font-display">Retailer Applications</h1>
          <p className="text-[14px] text-ink-muted mt-1">
            Approve stores to give them access to the listings feed.
          </p>
        </div>

        {error && <p className="text-[14px] text-danger">{error}</p>}

        {applications === null ? (
          <p className="text-[14px] text-ink-faint">Loading applications…</p>
        ) : applications.length === 0 ? (
          <p className="text-[14px] text-ink-faint">No pending applications.</p>
        ) : (
          <div className="space-y-3 pb-8">
            {applications.map((app) => {
              const approved = approvedUids.has(app.uid);
              return (
                <div
                  key={app.uid}
                  className="bg-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                  style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] font-bold text-ink truncate">
                      {app.storeName ?? 'Unnamed store'}
                    </p>
                    <p className="text-[13px] text-ink-muted mt-0.5">
                      {[app.street1, app.city, app.state, app.zip].filter(Boolean).join(', ') || 'No address'}
                    </p>
                    <p className="text-[12px] text-ink-faint mt-0.5">
                      {[app.email, app.phone].filter(Boolean).join(' · ')}
                      {app.appliedAt > 0 &&
                        ` · applied ${new Date(app.appliedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </p>
                  </div>
                  {approved ? (
                    <span className="text-[14px] font-semibold flex-shrink-0" style={{ color: '#5E8B6C' }}>
                      ✓ Approved
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleApprove(app.uid)}
                      disabled={busyUid !== null}
                      className="rounded-xl bg-ink text-bg px-6 py-2.5 text-[14px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-50 cursor-pointer disabled:cursor-default flex-shrink-0"
                    >
                      {busyUid === app.uid ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}

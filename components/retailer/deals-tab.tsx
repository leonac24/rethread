'use client';

// Retailer's accepted + completed deals: pickup codes for drop-offs,
// label purchase for shipped deals, and mark-received completion.
// Completed deals are the kickback ledger.

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import type { ListingGarment, ShipFromAddress } from '@/types/marketplace';

type Deal = {
  id: string;
  status: 'accepted' | 'completed';
  garment: ListingGarment | null;
  imageUrls: string[];
  fulfillment: 'dropoff' | 'ship' | null;
  dropoffCode: string | null;
  shipFrom: ShipFromAddress | null;
  shipping: { labelUrl: string; trackingNumber: string; carrier: string } | null;
  acceptedAmountUsd: number | null;
  finalAmountUsd: number | null;
  acceptedAt: number;
};

function DealCard({ deal, onUpdate }: { deal: Deal; onUpdate: (updated: Partial<Deal> & { id: string }) => void }) {
  const { firebaseUser } = useAuth();
  const [busy, setBusy] = useState<'label' | 'received' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function post(path: 'label' | 'received') {
    if (!firebaseUser) return;
    setBusy(path);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${deal.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        shipping?: Deal['shipping'];
        finalAmountUsd?: number;
      };
      if (!res.ok) throw new Error(body.error ?? 'Request failed.');
      if (path === 'label') {
        onUpdate({ id: deal.id, shipping: body.shipping ?? null });
      } else {
        onUpdate({ id: deal.id, status: 'completed', finalAmountUsd: body.finalAmountUsd ?? deal.acceptedAmountUsd });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setBusy(null);
    }
  }

  const title = deal.garment?.category ?? 'Garment';
  const completed = deal.status === 'completed';

  return (
    <div
      className={`bg-surface rounded-2xl p-4 ${completed ? 'opacity-70' : ''}`}
      style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}
    >
      <div className="flex items-center gap-4">
        <div className="w-[64px] h-[72px] rounded-xl bg-bg border border-rule overflow-hidden flex items-center justify-center flex-shrink-0">
          {deal.imageUrls[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={deal.imageUrls[0]} alt={title} className="w-full h-full object-contain" />
          ) : (
            <span className="text-[10px] text-ink-faint px-1 text-center">No photo</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-ink capitalize truncate">{title}</p>
          <p className="text-[13px] text-ink-muted truncate">{deal.garment?.brand ?? 'Unknown brand'}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[12px] font-bold text-ink">
              {completed ? `Completed — $${deal.finalAmountUsd ?? deal.acceptedAmountUsd ?? '—'}` : `Agreed — $${deal.acceptedAmountUsd ?? '—'}`}
            </span>
            {deal.fulfillment && (
              <span className="text-[11px] font-semibold text-ink-muted bg-bg rounded-full px-2 py-0.5">
                {deal.fulfillment === 'dropoff' ? 'In-store drop-off' : 'Shipped'}
              </span>
            )}
          </div>
        </div>
      </div>

      {!completed && (
        <div className="mt-3 pt-3 border-t border-rule space-y-3">
          {deal.fulfillment === 'dropoff' && deal.dropoffCode && (
            <div className="rounded-xl bg-bg px-4 py-3 flex items-center justify-between">
              <p className="text-[12px] text-ink-muted">Customer&apos;s pickup code</p>
              <p className="text-[18px] font-black text-ink tracking-[0.2em]">{deal.dropoffCode}</p>
            </div>
          )}

          {deal.fulfillment === 'ship' && (
            deal.shipping ? (
              <div className="rounded-xl bg-bg px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[12px] text-ink-muted">
                  Label sent · {deal.shipping.carrier} · {deal.shipping.trackingNumber}
                </p>
                <a
                  href={deal.shipping.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[12px] font-semibold text-ink underline underline-offset-2 hover:opacity-80 flex-shrink-0"
                >
                  View label
                </a>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => post('label')}
                disabled={busy !== null || !deal.shipFrom}
                className="w-full rounded-xl py-2.5 text-[14px] font-semibold text-bg bg-ink transition-opacity hover:opacity-85 disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                {busy === 'label'
                  ? 'Buying label…'
                  : deal.shipFrom
                    ? 'Send shipping label'
                    : 'Waiting for customer address'}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => post('received')}
            disabled={busy !== null}
            className="w-full rounded-xl py-2.5 text-[14px] font-semibold text-ink border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            {busy === 'received' ? 'Completing…' : 'Mark received'}
          </button>
          {error && <p className="text-[13px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}

export function DealsTab() {
  const { firebaseUser } = useAuth();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser) return;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/retailer/deals', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; deals?: Deal[] };
        if (!res.ok) throw new Error(body.error ?? 'Failed to load deals.');
        if (!cancelled) setDeals(body.deals ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load deals.');
          setDeals([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  function handleUpdate(updated: Partial<Deal> & { id: string }) {
    setDeals((prev) => prev?.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)) ?? null);
  }

  if (deals === null) {
    return <p className="text-[14px] text-ink-faint py-6">Loading deals…</p>;
  }
  if (error) {
    return <p className="text-[14px] text-danger py-6">{error}</p>;
  }
  if (deals.length === 0) {
    return <p className="text-[14px] text-ink-faint py-6">No deals yet — make an offer on a listing to get started.</p>;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {deals.map((d) => (
        <DealCard key={d.id} deal={d} onUpdate={handleUpdate} />
      ))}
    </div>
  );
}

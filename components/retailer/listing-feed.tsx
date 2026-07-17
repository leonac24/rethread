'use client';

// Retailer-facing feed of active listings, nearest first.
// Never shows the user's estimate — retailers set their own offers.

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/firebase/auth-context';
import type { ListingGarment } from '@/types/marketplace';

type FeedListing = {
  id: string;
  garment: ListingGarment | null;
  imageUrls: string[];
  condition: string | null;
  estimate: {
    low_usd: number;
    high_usd: number;
    confidence: string;
    factors: string[];
  } | null;
  createdAt: number;
  distanceKm: number | null;
};

type OfferState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'sent'; amount: number }
  | { phase: 'error'; message: string };

function fiberString(garment: ListingGarment | null): string {
  const fibers = garment?.fibers ?? [];
  return fibers.length
    ? fibers.map((f) => `${f.percentage}% ${f.material}`).join(' / ')
    : 'Unknown fiber';
}

function ListingCard({ listing }: { listing: FeedListing }) {
  const { firebaseUser } = useAuth();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState<OfferState>({ phase: 'idle' });

  const parsed = Number(amount);
  const amountValid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 10000;

  async function handleOffer() {
    if (!firebaseUser || !amountValid) return;
    setState({ phase: 'sending' });
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${listing.id}/offers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          amountUsd: parsed,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to send offer.');
      setState({ phase: 'sent', amount: parsed });
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Failed to send offer.' });
    }
  }

  const title = listing.garment?.category ?? 'Garment';
  const brand = listing.garment?.brand ?? 'Unknown brand';

  return (
    <div className="bg-surface rounded-2xl p-4" style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}>
      <div className="flex gap-4">
        <div className="w-[96px] h-[110px] rounded-xl bg-bg border border-rule overflow-hidden flex items-center justify-center flex-shrink-0">
          {listing.imageUrls[0] ? (
            // Firebase Storage URLs — plain img avoids next/image domain config churn.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={listing.imageUrls[0]} alt={title} className="w-full h-full object-contain" />
          ) : (
            <span className="text-[11px] text-ink-faint px-2 text-center">No photo</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[16px] font-bold text-ink capitalize truncate">{title}</p>
              <p className="text-[13px] text-ink-muted truncate">{brand}</p>
            </div>
            {listing.distanceKm != null && (
              <span className="text-[11px] font-bold text-ink-muted bg-bg rounded-full px-2 py-0.5 flex-shrink-0">
                {(listing.distanceKm * 0.621371).toFixed(1)} mi
              </span>
            )}
          </div>
          <p className="text-[12px] text-ink-faint mt-1 line-clamp-1">{fiberString(listing.garment)}</p>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {listing.condition && (
              <span className="text-[11px] font-semibold text-ink bg-bg rounded-full px-2 py-0.5 capitalize">
                {listing.condition} condition
              </span>
            )}
            {listing.garment?.color && (
              <span className="text-[11px] font-semibold text-ink bg-bg rounded-full px-2 py-0.5 capitalize">
                {listing.garment.color}
              </span>
            )}
          </div>
          {listing.estimate && (
            <div className="mt-2">
              <p className="text-[13px] font-bold" style={{ color: '#5E8B6C' }}>
                Appraised payout ${listing.estimate.low_usd}–${listing.estimate.high_usd}
                <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-70">
                  {listing.estimate.confidence} confidence
                </span>
              </p>
              {listing.estimate.factors.length > 0 && (
                <p className="text-[12px] text-ink-faint mt-0.5 line-clamp-2">
                  {listing.estimate.factors.join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-rule">
        {state.phase === 'sent' ? (
          <p className="text-[14px] font-semibold" style={{ color: '#5E8B6C' }}>
            ✓ Offer sent — ${state.amount}
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <div className="relative w-[110px] flex-shrink-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-muted">$</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  step={1}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-xl border border-rule bg-bg pl-7 pr-2 py-2.5 text-[14px] font-semibold text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink-muted"
                />
              </div>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 200))}
                placeholder="Note (optional)"
                className="flex-1 min-w-0 rounded-xl border border-rule bg-bg px-3 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink-muted"
              />
              <button
                type="button"
                onClick={handleOffer}
                disabled={!amountValid || state.phase === 'sending'}
                className="rounded-xl bg-ink text-bg px-4 py-2.5 text-[13px] font-semibold transition-opacity hover:opacity-85 disabled:opacity-40 cursor-pointer disabled:cursor-default flex-shrink-0"
              >
                {state.phase === 'sending' ? 'Sending…' : 'Make offer'}
              </button>
            </div>
            {state.phase === 'error' && (
              <p className="text-[13px] text-danger mt-2">{state.message}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ListingFeed() {
  const { firebaseUser } = useAuth();
  const [listings, setListings] = useState<FeedListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser) return;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/retailer/listings', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = (await res.json().catch(() => ({}))) as { error?: string; listings?: FeedListing[] };
        if (!res.ok) throw new Error(body.error ?? 'Failed to load listings.');
        if (!cancelled) setListings(body.listings ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load listings.');
          setListings([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  if (listings === null) {
    return <p className="text-[14px] text-ink-faint py-6">Loading listings…</p>;
  }
  if (error) {
    return <p className="text-[14px] text-danger py-6">{error}</p>;
  }
  if (listings.length === 0) {
    return <p className="text-[14px] text-ink-faint py-6">No items listed nearby yet.</p>;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} />
      ))}
    </div>
  );
}

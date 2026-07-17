'use client';

// Sell-to-a-local-store flow for closet items.
// The resale estimate is computed at scan time but only revealed here, as an
// "instant evaluation" — a short staged reveal that shows the reasoning, then
// an ultraconservative payout range. Retailers never see this number.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '@/lib/firebase/auth-context';
import type { ResaleEstimate, ListingStatus } from '@/types/marketplace';

const EVAL_STEPS = [
  'Assessing condition…',
  'Weighing brand demand…',
  'Comparing category resale strength…',
];
const EVAL_STEP_MS = 850;

type SellSectionProps = {
  scanId: string;
  resale: ResaleEstimate | null;
  listingId: string | null;
  listingStatus: ListingStatus | null;
};

type Phase = 'idle' | 'evaluating' | 'reveal' | 'listing' | 'listed';

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[14px] font-semibold uppercase tracking-[0.1em] text-ink-muted mb-4">
      {children}
    </p>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-2xl p-5" style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)' }}>
      {children}
    </div>
  );
}

function getPosition(lat: number | null, lng: number | null): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
    if (lat != null && lng != null) return resolve({ lat, lng });
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
    const timer = setTimeout(() => resolve({}), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve({});
      },
      { timeout: 2500 },
    );
  });
}

export function SellSection({ scanId, resale, listingId, listingStatus }: SellSectionProps) {
  const { firebaseUser } = useAuth();
  const alreadyLive = listingStatus === 'active' || listingStatus === 'accepted';
  const [phase, setPhase] = useState<Phase>(alreadyLive ? 'listed' : 'idle');
  const [evalStep, setEvalStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveListingId, setLiveListingId] = useState<string | null>(listingId);

  // Staged reveal — real factors follow; this shows the work, not a fake delay.
  useEffect(() => {
    if (phase !== 'evaluating') return;
    if (evalStep >= EVAL_STEPS.length) {
      setPhase('reveal');
      return;
    }
    const t = setTimeout(() => setEvalStep((s) => s + 1), EVAL_STEP_MS);
    return () => clearTimeout(t);
  }, [phase, evalStep]);

  async function handleList() {
    if (!firebaseUser) return;
    setPhase('listing');
    setError(null);
    try {
      const [{ lat, lng }, token] = await Promise.all([
        getPosition(null, null),
        firebaseUser.getIdToken(),
      ]);
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ scanId, ...(lat != null && lng != null ? { lat, lng } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; listing?: { id: string } };
      if (!res.ok) throw new Error(body.error ?? 'Failed to list item.');
      setLiveListingId(body.listing?.id ?? null);
      setPhase('listed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list item.');
      setPhase('reveal');
    }
  }

  if (!firebaseUser) return null;

  if (listingStatus === 'completed') {
    return (
      <Card>
        <SectionLabel>Sell It</SectionLabel>
        <div className="flex items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
            style={{ backgroundColor: '#5E8B6C18', color: '#5E8B6C' }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#5E8B6C' }} />
            Sold
          </span>
          <p className="text-[15px] text-ink-muted">This garment found a new home.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <SectionLabel>Sell It</SectionLabel>

      {phase === 'idle' && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-[15px] text-ink-muted">
            Local stores like Uptown Cheapskate can make offers on this garment.
          </p>
          <button
            type="button"
            onClick={() => {
              setEvalStep(0);
              setPhase('evaluating');
            }}
            className="rounded-xl bg-ink text-bg px-6 py-3 text-[14px] font-semibold transition-opacity hover:opacity-85 cursor-pointer"
          >
            Sell to a local store
          </button>
        </div>
      )}

      {phase === 'evaluating' && (
        <div className="py-3 space-y-2.5" aria-live="polite">
          {EVAL_STEPS.slice(0, evalStep + 1).map((step, i) => (
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="flex items-center gap-2.5"
            >
              {i < evalStep ? (
                <span className="text-[14px]" style={{ color: '#5E8B6C' }}>✓</span>
              ) : (
                <svg className="animate-spin w-3.5 h-3.5 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
              <p className="text-[14px] text-ink-muted">{step}</p>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {(phase === 'reveal' || phase === 'listing') && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            {resale ? (
              <div className="rounded-xl bg-bg p-4 mb-4">
                <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">
                  Estimated payout
                </p>
                <p className="mt-1 leading-none">
                  <span className="text-[34px] font-black text-ink">${resale.low_usd}</span>
                  <span className="text-[20px] font-semibold text-ink-muted">–${resale.high_usd}</span>
                </p>
                {resale.factors.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {resale.factors.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-ink-muted">
                        <span className="mt-[2px] inline-block w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#C9983E' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[12px] text-ink-faint leading-relaxed">
                  Stores make their own offers — this is a floor, not a promise.
                </p>
              </div>
            ) : (
              <p className="text-[14px] text-ink-muted mb-4">
                We couldn&apos;t estimate a payout for this garment, but local stores can still make offers.
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPhase('idle')}
                disabled={phase === 'listing'}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handleList}
                disabled={phase === 'listing'}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-bg bg-ink transition-opacity hover:opacity-85 disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                {phase === 'listing' ? 'Listing…' : 'List it'}
              </button>
            </div>
            {error && <p className="text-[13px] text-danger mt-3">{error}</p>}
          </motion.div>
        )}
      </AnimatePresence>

      {phase === 'listed' && (
        <ListedView
          listingId={liveListingId}
          initialStatus={alreadyLive ? listingStatus : 'active'}
          onCancelled={() => setPhase('idle')}
        />
      )}
    </Card>
  );
}

// Live-listing view. Task 9 extends this with the offers list + accept flow;
// for now it shows the live state and lets the owner pull the listing.
function ListedView({
  listingId,
  initialStatus,
  onCancelled,
}: {
  listingId: string | null;
  initialStatus: ListingStatus | null;
  onCancelled: () => void;
}) {
  const { firebaseUser } = useAuth();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel() {
    if (!firebaseUser || !listingId) return;
    setCancelling(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to remove listing.');
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove listing.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
          style={{ backgroundColor: '#C9983E18', color: '#C9983E' }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#C9983E' }} />
          {initialStatus === 'accepted' ? 'Sale Pending' : 'For Sale'}
        </span>
        <p className="text-[15px] text-ink-muted">
          {initialStatus === 'accepted'
            ? 'You accepted an offer on this garment.'
            : 'Your item is live. Local stores can now make offers.'}
        </p>
      </div>
      {initialStatus === 'active' && listingId && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-3 text-[13px] font-semibold text-danger underline underline-offset-2 hover:opacity-80 disabled:opacity-50 cursor-pointer"
        >
          {cancelling ? 'Removing…' : 'Remove listing'}
        </button>
      )}
      {error && <p className="text-[13px] text-danger mt-2">{error}</p>}
    </div>
  );
}

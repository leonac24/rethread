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
  'Reading brand labels from your photos…',
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
  // True when an image-based appraisal is already stored on the scan —
  // the price shows immediately instead of re-running the evaluation.
  evaluated?: boolean;
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

export function SellSection({ scanId, resale, listingId, listingStatus, evaluated = false }: SellSectionProps) {
  const { firebaseUser } = useAuth();
  const alreadyLive = listingStatus === 'active' || listingStatus === 'accepted';
  // Already-appraised items open straight on their stored price.
  const [phase, setPhase] = useState<Phase>(alreadyLive ? 'listed' : evaluated ? 'reveal' : 'idle');
  const [evalStep, setEvalStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveListingId, setLiveListingId] = useState<string | null>(listingId);
  const [hasEvaluated, setHasEvaluated] = useState(evaluated);
  // undefined = appraisal in flight; null = failed (fall back to scan-time estimate)
  const [freshResale, setFreshResale] = useState<ResaleEstimate | null | undefined>(
    evaluated ? null : undefined,
  );

  // The staged reveal covers a real Gemini appraisal of the stored photos —
  // it shows genuine work, not a fake delay.
  useEffect(() => {
    if (phase !== 'evaluating') return;
    if (evalStep >= EVAL_STEPS.length) {
      // Hold on the last step until the appraisal settles.
      if (freshResale !== undefined) setPhase('reveal');
      return;
    }
    const t = setTimeout(() => setEvalStep((s) => s + 1), EVAL_STEP_MS);
    return () => clearTimeout(t);
  }, [phase, evalStep, freshResale]);

  async function startEvaluation() {
    // The appraisal is persisted server-side — never re-pay for it.
    if (hasEvaluated) {
      setPhase('reveal');
      return;
    }
    setEvalStep(0);
    setFreshResale(undefined);
    setPhase('evaluating');
    try {
      if (!firebaseUser) throw new Error('Not signed in.');
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/user/scans/${scanId}/evaluate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { resale?: ResaleEstimate | null };
      if (!res.ok) throw new Error('evaluation unavailable');
      setFreshResale(body.resale ?? null);
      setHasEvaluated(true);
    } catch {
      // Image appraisal is best-effort — the scan-time estimate still works.
      setFreshResale(null);
    }
  }

  const effectiveResale = freshResale ?? resale;

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
            onClick={() => void startEvaluation()}
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
            {effectiveResale ? (
              <div className="rounded-xl bg-bg p-4 mb-4">
                <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">
                  Estimated payout
                </p>
                <p className="mt-1 leading-none">
                  <span className="text-[34px] font-black" style={{ color: '#5E8B6C' }}>${effectiveResale.low_usd}</span>
                  <span className="text-[20px] font-semibold" style={{ color: '#5E8B6C', opacity: 0.75 }}>–${effectiveResale.high_usd}</span>
                </p>
                {effectiveResale.factors.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {effectiveResale.factors.map((f) => (
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
                <p className="mt-1.5 text-[12px] text-ink-faint leading-relaxed">
                  Listing adds this garment&apos;s photos, details, and approximate area to the
                  marketplace, where approved resale partners near you can see it and make offers.
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

type OfferItem = {
  id: string;
  storeName: string;
  amountUsd: number;
  note?: string;
  status: string;
};

type ListingDetail = {
  status: ListingStatus;
  fulfillment: 'dropoff' | 'ship' | null;
  dropoffCode: string | null;
  shipping: { labelUrl: string; trackingNumber: string; carrier: string } | null;
};

// Live-listing view: offers list, accept flow (drop-off vs ship), and
// post-acceptance state (pickup code / shipping label).
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
  const [offers, setOffers] = useState<OfferItem[]>([]);
  const [detail, setDetail] = useState<ListingDetail | null>(null);
  const [acceptTarget, setAcceptTarget] = useState<OfferItem | null>(null);
  const [busyOfferId, setBusyOfferId] = useState<string | null>(null);
  const [dropoffCode, setDropoffCode] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const status = detail?.status ?? initialStatus ?? 'active';

  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser || !listingId) return;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/listings/${listingId}`, {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { listing: ListingDetail; offers: OfferItem[] };
        if (cancelled) return;
        setDetail(body.listing);
        setOffers(body.offers);
        if (body.listing.dropoffCode) setDropoffCode(body.listing.dropoffCode);
      } catch {
        // Listing detail is progressive enhancement — the tag view still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, listingId, refreshKey]);

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

  async function handleDecline(offer: OfferItem) {
    if (!firebaseUser || !listingId) return;
    setBusyOfferId(offer.id);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${listingId}/offers/${offer.id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to decline offer.');
      setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'declined' } : o)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decline offer.');
    } finally {
      setBusyOfferId(null);
    }
  }

  async function handleAccept(offer: OfferItem, fulfillment: 'dropoff' | 'ship', shipFrom?: Record<string, string>) {
    if (!firebaseUser || !listingId) return;
    setBusyOfferId(offer.id);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${listingId}/offers/${offer.id}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fulfillment, ...(shipFrom ? { shipFrom } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; dropoffCode?: string };
      if (!res.ok) throw new Error(body.error ?? 'Failed to accept offer.');
      if (body.dropoffCode) setDropoffCode(body.dropoffCode);
      setAcceptTarget(null);
      setRefreshKey((k) => k + 1);
      setDetail((d) => (d ? { ...d, status: 'accepted', fulfillment } : d));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept offer.');
    } finally {
      setBusyOfferId(null);
    }
  }

  const openOffers = offers.filter((o) => o.status === 'open');
  const acceptedOffer = offers.find((o) => o.status === 'accepted');

  if (status === 'accepted') {
    return (
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
            style={{ backgroundColor: '#B07D2E18', color: '#B07D2E' }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#B07D2E' }} />
            Sale Pending
          </span>
          <p className="text-[15px] text-ink-muted">
            {acceptedOffer
              ? `You accepted ${acceptedOffer.storeName}'s offer of $${acceptedOffer.amountUsd}.`
              : 'You accepted an offer on this garment.'}
          </p>
        </div>

        {detail?.fulfillment === 'dropoff' && dropoffCode && (
          <div className="mt-4 rounded-xl bg-bg p-4 text-center">
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted mb-1">
              Your pickup code
            </p>
            <p className="text-[28px] font-black text-ink tracking-[0.3em]">{dropoffCode}</p>
            <p className="text-[12px] text-ink-faint mt-1">
              Show this code at the store when you drop off the garment.
            </p>
          </div>
        )}

        {detail?.fulfillment === 'ship' && (
          <div className="mt-4 rounded-xl bg-bg p-4">
            {detail.shipping ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-[14px] font-semibold text-ink">Shipping label ready</p>
                  <p className="text-[12px] text-ink-muted mt-0.5">
                    {detail.shipping.carrier} · Tracking {detail.shipping.trackingNumber}
                  </p>
                </div>
                <a
                  href={detail.shipping.labelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-xl bg-ink text-bg px-5 py-2.5 text-[13px] font-semibold text-center transition-opacity hover:opacity-85"
                >
                  Download label
                </a>
              </div>
            ) : (
              <p className="text-[14px] text-ink-muted">
                Waiting for the store to send your shipping label — check back soon.
              </p>
            )}
          </div>
        )}
        {error && <p className="text-[13px] text-danger mt-2">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
          style={{ backgroundColor: '#C9983E18', color: '#C9983E' }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#C9983E' }} />
          For Sale
        </span>
        <p className="text-[15px] text-ink-muted">
          {openOffers.length > 0
            ? `${openOffers.length} offer${openOffers.length > 1 ? 's' : ''} waiting for you.`
            : 'Your item is live. Local stores can now make offers.'}
        </p>
      </div>

      {openOffers.length > 0 && (
        <div className="mt-4 space-y-2.5">
          {openOffers.map((offer) => (
            <div key={offer.id} className="rounded-xl bg-bg p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[15px] font-semibold text-ink truncate">{offer.storeName}</p>
                  {offer.note && (
                    <p className="text-[13px] text-ink-muted mt-0.5 line-clamp-2">{offer.note}</p>
                  )}
                </div>
                <p className="text-[24px] font-black text-ink flex-shrink-0">${offer.amountUsd}</p>
              </div>
              <div className="flex gap-2.5 mt-3">
                <button
                  type="button"
                  onClick={() => handleDecline(offer)}
                  disabled={busyOfferId !== null}
                  className="flex-1 rounded-xl py-2.5 text-[14px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => setAcceptTarget(offer)}
                  disabled={busyOfferId !== null}
                  className="flex-1 rounded-xl py-2.5 text-[14px] font-semibold text-bg bg-ink transition-opacity hover:opacity-85 disabled:opacity-50 cursor-pointer disabled:cursor-default"
                >
                  Accept
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {listingId && (
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

      {acceptTarget && (
        <AcceptModal
          offer={acceptTarget}
          busy={busyOfferId !== null}
          onClose={() => setAcceptTarget(null)}
          onAccept={handleAccept}
        />
      )}
    </div>
  );
}

function AcceptModal({
  offer,
  busy,
  onClose,
  onAccept,
}: {
  offer: OfferItem;
  busy: boolean;
  onClose: () => void;
  onAccept: (offer: OfferItem, fulfillment: 'dropoff' | 'ship', shipFrom?: Record<string, string>) => void;
}) {
  const [method, setMethod] = useState<'dropoff' | 'ship' | null>(null);
  const [addr, setAddr] = useState({ name: '', street1: '', city: '', state: '', zip: '' });
  const addrValid =
    addr.name.trim() !== '' &&
    addr.street1.trim() !== '' &&
    addr.city.trim() !== '' &&
    addr.state.trim() !== '' &&
    /^\d{5}(-\d{4})?$/.test(addr.zip.trim());

  function input(field: keyof typeof addr, placeholder: string, className = '') {
    return (
      <input
        type="text"
        value={addr[field]}
        onChange={(e) => setAddr((a) => ({ ...a, [field]: e.target.value }))}
        placeholder={placeholder}
        className={`w-full rounded-xl border border-rule bg-bg px-3.5 py-2.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink-muted ${className}`}
      />
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Accept offer"
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="bg-surface rounded-2xl p-5 max-w-sm w-full"
        style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}
      >
        <p className="text-[16px] font-semibold text-ink mb-1">
          Accept ${offer.amountUsd} from {offer.storeName}?
        </p>
        <p className="text-[14px] text-ink-muted mb-4">
          Choose how the garment gets to the store. Other open offers will be declined.
        </p>

        <div className="grid grid-cols-2 gap-2.5 mb-4">
          <button
            type="button"
            onClick={() => setMethod('dropoff')}
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${method === 'dropoff' ? 'border-ink bg-surface-sunk' : 'border-rule hover:bg-surface-sunk'}`}
          >
            <p className="text-[14px] font-semibold text-ink">Drop it off</p>
            <p className="text-[12px] text-ink-muted mt-0.5">You&apos;ll get a pickup code to show in store.</p>
          </button>
          <button
            type="button"
            onClick={() => setMethod('ship')}
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${method === 'ship' ? 'border-ink bg-surface-sunk' : 'border-rule hover:bg-surface-sunk'}`}
          >
            <p className="text-[14px] font-semibold text-ink">Ship it</p>
            <p className="text-[12px] text-ink-muted mt-0.5">The store sends you a prepaid label.</p>
          </button>
        </div>

        {method === 'ship' && (
          <div className="space-y-2 mb-4">
            {input('name', 'Full name')}
            {input('street1', 'Street address')}
            <div className="flex gap-2">
              {input('city', 'City', 'flex-[2]')}
              {input('state', 'State', 'flex-1')}
              {input('zip', 'ZIP', 'flex-1')}
            </div>
            <p className="text-[11px] text-ink-faint">
              Your address is only shared with {offer.storeName} for the shipping label.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (method === 'dropoff') onAccept(offer, 'dropoff');
              else if (method === 'ship' && addrValid) onAccept(offer, 'ship', addr);
            }}
            disabled={busy || method === null || (method === 'ship' && !addrValid)}
            className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-bg bg-ink transition-opacity hover:opacity-85 disabled:opacity-50 cursor-pointer disabled:cursor-default"
          >
            {busy ? 'Accepting…' : 'Accept offer'}
          </button>
        </div>
      </div>
    </div>
  );
}

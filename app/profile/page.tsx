'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { useLiveRefresh } from '@/lib/use-live-refresh';
import { LoadingScreen } from '@/components/loading-screen';
import type { OutcomeAction, ScanResult } from '@/types/garment';
import type { ResaleEstimate } from '@/types/marketplace';

type SavedScan = {
  scanId: string;
  action: OutcomeAction;
  result: ScanResult;
  createdAt: number;
  imageUrls?: string[];
  listingId?: string | null;
  listingStatus?: string | null;
  listingOfferCount?: number;
  resaleEvaluatedAt?: number | null;
};

type SellPin = {
  resale: ResaleEstimate | null;
  evaluated: boolean;
  listingId: string | null;
  listingStatus: string | null;
};

type ClosetTile = {
  id: string;
  label: string;
  fiber: string;
  action: OutcomeAction;
  date: string;
  imageUrls: string[];
  saleTag: { label: string; color: string } | null;
  sellPin: SellPin | null;
};

// Small pill on the tile when the item is in the marketplace.
function getSaleTag(status: string | null | undefined, offerCount: number): { label: string; color: string } | null {
  if (status === 'active') {
    return offerCount > 0
      ? { label: 'Offer', color: '#5E8B6C' }
      : { label: 'For Sale', color: '#C9983E' };
  }
  if (status === 'accepted') return { label: 'Sale Pending', color: '#B07D2E' };
  if (status === 'completed') return { label: 'Sold', color: '#5E8B6C' };
  return null;
}

const ACTION_BADGE: Record<OutcomeAction, { label: string; color: string }> = {
  donate: { label: 'Donated', color: '#5E8B6C' },      // green — best
  list: { label: 'Listed', color: '#C9983E' },         // lighter yellow
  repair: { label: 'Repaired', color: '#8B6A1E' },     // darker yellow
  throw_away: { label: 'Thrown Away', color: '#B23A2B' }, // red — worst
};

const TIERS = [
  { name: 'Thread Rookie', min: 0 },
  { name: 'Label Reader', min: 5 },
  { name: 'Fiber Scout', min: 10 },
  { name: 'Eco Advocate', min: 20 },
  { name: 'Rethread Pro', min: 40 },
];

function getTier(scans: number) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (scans >= t.min) tier = t;
  }
  return tier;
}

function ActionBadge({ action }: { action: OutcomeAction }) {
  const { label, color } = ACTION_BADGE[action];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
      {label}
    </span>
  );
}

// Best-effort browser location for the listing's approximate area.
function getPosition(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((resolve) => {
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
      { timeout: 3000 },
    );
  });
}

const LISTING_DISCLOSURE =
  "Listing shares this garment's photos, details, and approximate area with approved resale partners near you.";

// Pushpin-tacked "Sell It" tag on the tile corner. The full sell loop lives
// here: Sell It → appraise → "$lo–$hi · List It" → listed (with a small ✕ to
// unlist). Listing state is lifted to the page so the For Sale pill stays in
// sync without a refetch.
function SellPinTag({
  scanId,
  pin,
  onListingChange,
}: {
  scanId: string;
  pin: SellPin;
  onListingChange: (listingId: string | null, status: 'active' | 'cancelled') => void;
}) {
  const { firebaseUser } = useAuth();
  const [busy, setBusy] = useState<null | 'appraising' | 'listing' | 'unlisting'>(null);
  const [freshResale, setFreshResale] = useState<ResaleEstimate | null>(null);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  const resale = freshResale ?? pin.resale;
  const listed = pin.listingStatus === 'active';
  const priced = !listed && !!resale && (pin.evaluated || freshResale !== null);

  async function handleAppraise(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !firebaseUser) return;
    setBusy('appraising');
    setFailed(false);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/user/scans/${scanId}/evaluate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = (await res.json().catch(() => ({}))) as { resale?: ResaleEstimate | null };
      if (res.ok && body.resale) {
        setFreshResale(body.resale);
      } else if (pin.resale) {
        // Fall back to the scan-time estimate; failing that, open the sell flow.
        setFreshResale(pin.resale);
      } else {
        router.push(`/closet/${scanId}`);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function handleList(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !firebaseUser) return;
    setBusy('listing');
    setFailed(false);
    try {
      const [{ lat, lng }, token] = await Promise.all([getPosition(), firebaseUser.getIdToken()]);
      const res = await fetch('/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ scanId, ...(lat != null && lng != null ? { lat, lng } : {}) }),
      });
      const body = (await res.json().catch(() => ({}))) as { listing?: { id: string } };
      if (!res.ok || !body.listing?.id) throw new Error('Failed to list.');
      onListingChange(body.listing.id, 'active');
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function handleUnlist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !firebaseUser || !pin.listingId) return;
    setBusy('unlisting');
    setFailed(false);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/listings/${pin.listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (!res.ok) throw new Error('Failed to unlist.');
      onListingChange(pin.listingId, 'cancelled');
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const pinhead = (
    <span
      aria-hidden
      className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-[13px] h-[13px] rounded-full"
      style={{
        background: 'radial-gradient(circle at 32% 30%, #8FBA9C 0%, #5E8B6C 45%, #35543F 100%)',
        boxShadow: '0 2px 3px rgba(0,0,0,0.35), inset 0 -1px 2px rgba(0,0,0,0.25)',
      }}
    />
  );

  const tagClass =
    'relative block rounded-md px-2.5 pb-1 pt-[7px] text-[11px] font-bold text-white leading-none whitespace-nowrap';
  const tagStyle: React.CSSProperties = {
    backgroundColor: '#5E8B6C',
    boxShadow: '0 4px 8px rgba(20,22,26,0.3)',
  };

  const range = resale ? `$${resale.low_usd}–$${resale.high_usd}` : null;

  return (
    <div className="absolute -bottom-2 -right-1.5 z-20" style={{ transform: 'rotate(7deg)' }}>
      {listed ? (
        <span className="relative block">
          <span
            className={`${tagClass} cursor-pointer transition-transform hover:scale-105`}
            style={tagStyle}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              router.push(`/closet/${scanId}`);
            }}
            role="link"
            aria-label={`Listed${range ? ` at ${range}` : ''} — view offers`}
          >
            {pinhead}
            {busy === 'unlisting' ? 'Unlisting…' : range ?? 'Listed'}
          </span>
          <button
            type="button"
            onClick={handleUnlist}
            disabled={busy !== null}
            aria-label="Unlist from marketplace"
            title="Unlist from marketplace"
            className="absolute -top-2.5 -right-2.5 z-30 w-[18px] h-[18px] rounded-full bg-white flex items-center justify-center text-[12px] leading-none font-bold text-ink-muted hover:text-white cursor-pointer disabled:cursor-default transition-colors"
            style={{ boxShadow: '0 1px 4px rgba(20,22,26,0.3)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#B23A2B'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#ffffff'; }}
          >
            ×
          </button>
        </span>
      ) : priced ? (
        <button
          type="button"
          onClick={handleList}
          disabled={busy !== null}
          aria-label={`List on the marketplace — estimated payout ${range}`}
          title={LISTING_DISCLOSURE}
          className={`${tagClass} cursor-pointer transition-transform hover:scale-105 disabled:cursor-default`}
          style={tagStyle}
        >
          {pinhead}
          {busy === 'listing' ? 'Listing…' : failed ? 'Retry listing' : `${range} · List It`}
        </button>
      ) : (
        <button
          type="button"
          onClick={handleAppraise}
          disabled={busy !== null}
          aria-label="Evaluate resale payout"
          className={`${tagClass} cursor-pointer transition-transform hover:scale-105 disabled:cursor-default`}
          style={tagStyle}
        >
          {pinhead}
          {busy === 'appraising' ? 'Appraising…' : failed ? 'Retry' : 'Sell It'}
        </button>
      )}
    </div>
  );
}

function ClosetItem({
  id,
  label,
  fiber,
  action,
  date,
  imageUrls,
  saleTag,
  sellPin,
  onRequestDelete,
  onListingChange,
}: ClosetTile & {
  onRequestDelete: () => void;
  onListingChange: (listingId: string | null, status: 'active' | 'cancelled') => void;
}) {
  const imgSrc = imageUrls[0] ?? '/images/garment.webp';
  return (
    <Link href={`/closet/${id}`} className="flex flex-col items-center w-full">
      {/* hanger on top */}
      <Image
        src="/images/hanger.webp"
        alt=""
        width={140}
        height={80}
        className="w-[135px] h-auto object-contain relative z-10 mb-[-27px]"
      />

      {/* garment card — outer wrapper stays unclipped so the sell pin can overhang */}
      <div className="relative w-full">
        <div
          className="relative w-full rounded-xl overflow-hidden bg-surface border border-rule"
          style={{ paddingTop: '110%' }}
        >
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Image
              src={imgSrc}
              alt={label}
              width={200}
              height={200}
              className="w-full h-full object-contain"
            />
          </div>
          {saleTag && (
            <span
              className="absolute top-1.5 left-1.5 z-20 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: saleTag.color }}
            >
              {saleTag.label}
            </span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRequestDelete();
            }}
            aria-label={`Remove ${label} from closet`}
            className="absolute top-1.5 right-1.5 z-20 w-6 h-6 rounded-full bg-white/90 flex items-center justify-center text-[16px] leading-none text-ink-muted hover:text-danger cursor-pointer transition-colors"
          >
            ×
          </button>
        </div>
        {sellPin && <SellPinTag scanId={id} pin={sellPin} onListingChange={onListingChange} />}
      </div>

      {/* metadata below */}
      <div className="mt-2 w-full text-center px-1">
        <p className="text-[13px] font-bold text-ink leading-tight truncate">{label}</p>
        <p className="text-[11px] text-ink-muted mt-0.5 leading-tight line-clamp-2">{fiber}</p>
        <div className="mt-1">
          <ActionBadge action={action} />
        </div>
        <p className="text-[10px] text-ink-faint mt-0.5 font-medium">{date}</p>
      </div>
    </Link>
  );
}

function AddClosetTile() {
  return (
    <Link
      href="/scan"
      className="flex flex-col items-center w-full group"
      aria-label="Add to Closet"
    >
      {/* hanger on top — matches ClosetItem structure exactly */}
      <Image
        src="/images/hanger.webp"
        alt=""
        width={140}
        height={80}
        className="w-[135px] h-auto object-contain relative z-10 mb-[-27px] opacity-60"
      />

      {/* card area — dashed "empty slot" with + and label */}
      <div
        className="relative w-full rounded-xl overflow-hidden bg-ink/5 border-2 border-dashed border-rule transition-colors group-hover:bg-ink/10"
        style={{ paddingTop: '110%' }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="text-[52px] leading-none font-light text-ink-muted">+</span>
          <span className="text-[12px] font-bold tracking-[0.08em] uppercase text-ink-muted">
            Add to Closet
          </span>
        </div>
      </div>

      {/* invisible metadata placeholder so total tile height matches ClosetItem */}
      <div className="mt-2 w-full text-center px-1 invisible" aria-hidden>
        <p className="text-[13px] font-bold leading-tight">&nbsp;</p>
        <p className="text-[11px] mt-0.5 leading-tight">
          &nbsp;
          <br />
          &nbsp;
        </p>
        <p className="text-[11px] mt-1">&nbsp;</p>
        <p className="text-[10px] mt-0.5">&nbsp;</p>
      </div>
    </Link>
  );
}

// Ordered best → worst for the environment (top of badge = best)
const ACTION_TIER_ORDER: OutcomeAction[] = ['donate', 'list', 'repair'];

function RankBadge({
  currentTier,
  counts,
}: {
  currentTier: (typeof TIERS)[number];
  counts: Record<OutcomeAction, number>;
}) {
  return (
    <div className="relative w-full max-w-[145px] md:max-w-[185px]">
      <Image
        src="/images/rankingframe.webp"
        alt="Ranking frame"
        width={332}
        height={330}
        className="w-full h-auto"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-[6%]">
        <p className="text-[7px] md:text-[9px] font-bold tracking-[0.16em] uppercase text-ink-muted">Current Tier</p>
        <p className="text-[11px] md:text-[14px] font-black text-ink leading-tight mt-0.5 mb-1.5 md:mb-2">{currentTier.name}</p>
        <div className="flex flex-col items-start gap-0.5 md:gap-1">
          {ACTION_TIER_ORDER.map((action) => {
            const { label, color } = ACTION_BADGE[action];
            return (
              <div key={action} className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full inline-block"
                  style={{ background: color }}
                />
                <span className="text-[9px] md:text-[11px] font-bold text-ink leading-tight">
                  {counts[action]} <span className="font-medium text-ink-muted">{label}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, firebaseUser, loading } = useAuth();
  const router = useRouter();
  const [scans, setScans] = useState<SavedScan[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleConfirmDelete() {
    if (!deleteTarget || !firebaseUser) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/user/scans/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Failed to delete.');
      }
      setScans((prev) => prev?.filter((s) => s.scanId !== deleteTarget.id) ?? null);
      setDeleteTarget(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete.');
    } finally {
      setDeleting(false);
    }
  }

  // Retailers belong on their partner dashboard, not the closet profile.
  useEffect(() => {
    if (!loading && user?.role === 'retailer') {
      router.replace('/retailer');
    }
  }, [loading, user, router]);

  // Live activity (new offers, sales) shows up without a manual reload —
  // the closet re-fetches every 20s while visible and on tab focus.
  const liveTick = useLiveRefresh(20_000, !!firebaseUser);

  useEffect(() => {
    let cancelled = false;
    if (!firebaseUser) {
      setScans(null);
      return;
    }
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/user/scans', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          // Only fall back to empty on the initial load — a failed background
          // refresh must not wipe an already-rendered closet.
          if (!cancelled) setScans((prev) => prev ?? []);
          return;
        }
        const data = (await res.json()) as { scans: SavedScan[] };
        if (!cancelled) setScans(data.scans ?? []);
      } catch {
        if (!cancelled) setScans((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, liveTick]);

  const scanCount = user?.actionCount ?? 12;
  const currentTier = getTier(scanCount);

  const actionCounts = (scans ?? []).reduce<Record<OutcomeAction, number>>(
    (acc, s) => {
      acc[s.action] = (acc[s.action] ?? 0) + 1;
      return acc;
    },
    { repair: 0, list: 0, donate: 0, throw_away: 0 },
  );

  const closetTiles: ClosetTile[] = (scans ?? []).map((scan) => {
    const fibers = scan.result.garment.fibers ?? [];
    const fiberStr =
      fibers.length > 0
        ? `${scan.result.garment.fibers_estimated ? 'Est. ' : ''}${fibers
            .map((f) => `${f.percentage}% ${f.material}`)
            .join(' / ')}`
        : 'Unknown fiber';
    const label =
      scan.result.garment.category ?? scan.result.garment.brand ?? 'Garment';
    const date = new Date(scan.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    // The pinned Sell It tag carries the full sell loop (appraise → list →
    // unlist), so it stays visible while a listing is active. It only drops
    // off once a sale is locked in (accepted/completed) or the item was
    // trashed — those states are managed from the garment detail page.
    const pinnable =
      scan.action !== 'throw_away' &&
      (!scan.listingStatus || scan.listingStatus === 'cancelled' || scan.listingStatus === 'active');
    const sellPin: SellPin | null = pinnable
      ? {
          resale: scan.result.cost.resale ?? null,
          evaluated: !!scan.resaleEvaluatedAt,
          listingId: scan.listingId ?? null,
          listingStatus: scan.listingStatus ?? null,
        }
      : null;

    return {
      id: scan.scanId,
      label,
      fiber: fiberStr,
      action: scan.action,
      date,
      imageUrls: scan.imageUrls ?? [],
      saleTag: getSaleTag(scan.listingStatus, scan.listingOfferCount ?? 0),
      sellPin,
    };
  });

  const co2Lbs = user ? ((user.totalCO2SavedKg ?? 0) * 2.205).toFixed(1) : '34';
  const waterGal = user ? Math.round((user.totalWaterSavedLiters ?? 0) * 0.264).toLocaleString() : '2,400';

  const STATS = [
    { label: 'Garments Scanned', value: user ? String(scanCount) : '12' },
    { label: 'Items Rerouted', value: user ? String(user.actionCount ?? 0) : '7' },
    { label: 'CO₂ Saved (lbs)', value: co2Lbs },
    { label: 'Water Saved (gal)', value: waterGal },
  ];

  if (loading) {
    return <LoadingScreen blurbs={['Loading your closet', 'Fetching your impact']} />;
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 px-4">
        <p className="text-[16px] text-ink-muted text-center">Sign in to see your impact profile.</p>
        <a
          href="/login"
          className="inline-flex items-center justify-center h-11 px-8 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
        >
          Sign in
        </a>
      </main>
    );
  }

  if (scans === null) {
    return <LoadingScreen blurbs={['Loading your closet', 'Fetching your impact']} />;
  }

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width space-y-6">

        {/* ── Profile hero ── */}
        <div className="pt-4">
          {/* Row: pfp + badge — mobile pushes to edges, desktop splits in half and centers each */}
          <div className="grid grid-cols-2 items-center">
            <div className="flex justify-start md:justify-center">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-[90px] h-[90px] md:w-[120px] md:h-[120px] rounded-full overflow-hidden border-2 border-rule">
                  {user.photoURL ? (
                    <Image
                      src={user.photoURL}
                      alt={user.displayName ?? 'Profile'}
                      width={200}
                      height={200}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-full h-full bg-accent-200 flex items-center justify-center text-[40px] font-bold text-accent-700">
                      {(user.displayName ?? user.email ?? '?')[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
                <h1 className="mt-2 md:mt-3 text-[18px] md:text-[22px] font-bold text-ink">
                  {user.displayName ?? 'Anonymous'}
                </h1>
                <p className="text-[12px] md:text-[13px] text-ink-muted mt-0.5">
                  {user.email}
                </p>
              </div>
            </div>

            <div className="flex justify-end md:justify-center">
              <RankBadge currentTier={currentTier} counts={actionCounts} />
            </div>
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div
          className="grid grid-cols-2 gap-3 rounded-2xl overflow-hidden p-3"
          style={{
            backgroundImage: 'url(/images/lace.webp)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-xl bg-bg/80 backdrop-blur-sm p-4 flex flex-col gap-1"
            >
              <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">{s.label}</p>
              <p className="text-[28px] font-black text-ink leading-none">{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── My Closet ── */}
        <div className="pb-8">
          <h2 className="text-[13px] font-bold tracking-[0.12em] uppercase text-ink-muted mb-4">My Closet</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6">
            <AddClosetTile />
            {closetTiles.map((tile) => (
              <ClosetItem
                key={tile.id}
                {...tile}
                onRequestDelete={() => {
                  setDeleteError(null);
                  setDeleteTarget({ id: tile.id, label: tile.label });
                }}
                onListingChange={(listingId, status) => {
                  setScans((prev) =>
                    prev?.map((s) =>
                      s.scanId === tile.id
                        ? { ...s, listingId, listingStatus: status, listingOfferCount: 0 }
                        : s,
                    ) ?? null,
                  );
                }}
              />
            ))}
          </div>
        </div>

      </div>

      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Remove from closet"
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !deleting) setDeleteTarget(null);
          }}
        >
          <div
            className="bg-surface rounded-2xl p-5 max-w-sm w-full"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.2)' }}
          >
            <p className="text-[16px] font-semibold text-ink mb-1">Remove from closet?</p>
            <p className="text-[14px] text-ink-muted mb-4">
              {deleteTarget.label} will be removed and your environmental credit reversed.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk disabled:opacity-50 cursor-pointer disabled:cursor-default"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer disabled:cursor-default"
                style={{ backgroundColor: '#B23A2B' }}
              >
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
            {deleteError && <p className="text-[13px] text-danger mt-3">{deleteError}</p>}
          </div>
        </div>
      )}
    </main>
  );
}

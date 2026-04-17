'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth-context';
import type { OutcomeAction, ScanResult } from '@/types/garment';

type SavedScan = {
  scanId: string;
  action: OutcomeAction;
  result: ScanResult;
  createdAt: number;
  imageUrls?: string[];
};

type ClosetTile = {
  id: string;
  label: string;
  fiber: string;
  action: OutcomeAction;
  date: string;
  imageUrls: string[];
};

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

function ClosetItem({
  id,
  label,
  fiber,
  action,
  date,
  imageUrls,
  onRequestDelete,
}: ClosetTile & { onRequestDelete: () => void }) {
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

      {/* garment card */}
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
const ACTION_TIER_ORDER: OutcomeAction[] = ['donate', 'list', 'repair', 'throw_away'];

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
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setScans([]);
          return;
        }
        const data = (await res.json()) as { scans: SavedScan[] };
        if (!cancelled) setScans(data.scans ?? []);
      } catch {
        if (!cancelled) setScans([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

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
        ? fibers.map((f) => `${f.percentage}% ${f.material}`).join(' / ')
        : 'Unknown fiber';
    const label =
      scan.result.garment.category ?? scan.result.garment.brand ?? 'Garment';
    const date = new Date(scan.createdAt).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    return {
      id: scan.scanId,
      label,
      fiber: fiberStr,
      action: scan.action,
      date,
      imageUrls: scan.imageUrls ?? [],
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
    return (
      <main className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-ink-faint border-t-ink animate-spin" />
      </main>
    );
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
              />
            ))}
          </div>
          {scans === null && (
            <p className="text-[11px] text-ink-faint mt-4">Loading your closet…</p>
          )}
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

'use client';

import { useState } from 'react';
import type { EnvironmentalCost, GarmentCondition, OutcomeAction } from '@/types/garment';

type Status = 'idle' | 'confirming' | 'loading' | 'done' | 'conflict' | 'error';

type OutcomeSectionProps = {
  id: string;
  cost: EnvironmentalCost;
  condition?: GarmentCondition;
};

// ─── Icons ────────────────────────────────────────────────────────────────────

function TrashIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4h6v2" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ─── Card meta ────────────────────────────────────────────────────────────────

type ActionMeta = {
  bg: string;
  ringColor: string;
  iconColor: string;
  label: string;
  sublabel: string;
  icon: React.ReactNode;
};

const ACTION_META: Record<OutcomeAction, ActionMeta> = {
  throw_away: {
    bg: '#FDECEA',
    ringColor: '#B23A2B',
    iconColor: '#B23A2B',
    label: 'Throw Away',
    sublabel: 'Sends to landfill',
    icon: <TrashIcon />,
  },
  repair: {
    bg: '#ECE8DF',
    ringColor: '#5C6470',
    iconColor: '#5C6470',
    label: 'Repair',
    sublabel: 'Extend its life',
    icon: <WrenchIcon />,
  },
  list: {
    bg: '#EAF4FB',
    ringColor: '#2E5F83',
    iconColor: '#2E5F83',
    label: 'List / Swap',
    sublabel: 'Sell or trade',
    icon: <TagIcon />,
  },
  donate: {
    bg: '#F5EEF8',
    ringColor: '#8E6BAD',
    iconColor: '#8E6BAD',
    label: 'Donate',
    sublabel: 'Give it away',
    icon: <HeartIcon />,
  },
};

const ACTION_ORDER: OutcomeAction[] = ['repair', 'list', 'donate', 'throw_away'];

function recommendedAction(condition?: GarmentCondition): OutcomeAction | null {
  if (!condition) return null;
  if (condition === 'poor' || condition === 'fair') return 'repair';
  if (condition === 'good' || condition === 'excellent') return 'list';
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OutcomeSection({ id, cost, condition }: OutcomeSectionProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [pendingAction, setPendingAction] = useState<OutcomeAction | null>(null);
  const [doneAction, setDoneAction] = useState<OutcomeAction | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recommended = recommendedAction(condition);

  async function submit(action: OutcomeAction) {
    setStatus('loading');
    setPendingAction(action);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/scan/${id}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (res.status === 409) {
        setStatus('conflict');
        return;
      }
      if (res.status === 429) {
        setErrorMsg('Too many requests — please wait a moment and try again.');
        setStatus('error');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setErrorMsg(body.error ?? 'Something went wrong. Please try again.');
        setStatus('error');
        return;
      }

      setDoneAction(action);
      setStatus('done');
    } catch {
      setErrorMsg('Network error — please check your connection and try again.');
      setStatus('error');
    }
  }

  function handleCardTap(action: OutcomeAction) {
    if (status !== 'idle') return;
    if (action === 'throw_away') {
      setPendingAction(action);
      setStatus('confirming');
    } else {
      void submit(action);
    }
  }

  // ── Success banner ─────────────────────────────────────────────────────────
  if (status === 'done' && doneAction) {
    const co2Lbs = (cost.co2_kg * 2.205).toFixed(1);
    const waterGal = Math.round(cost.water_liters * 0.264).toLocaleString();
    const isSaved = doneAction !== 'throw_away';

    return (
      <div
        className="rounded-2xl p-5"
        style={{
          boxShadow: '0 2px 16px rgba(20,22,26,0.07)',
          backgroundColor: isSaved ? 'rgba(94,139,108,0.08)' : '#FBF9F4',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center mt-0.5"
            style={{ backgroundColor: isSaved ? 'rgba(94,139,108,0.15)' : 'rgba(20,22,26,0.07)', color: isSaved ? '#5E8B6C' : '#5C6470' }}
          >
            <CheckIcon />
          </div>
          <div>
            {isSaved ? (
              <>
                <p className="text-[16px] font-semibold text-ink leading-snug">
                  You saved <span style={{ color: '#5E8B6C' }}>{co2Lbs} lbs CO₂</span> and <span style={{ color: '#5E8B6C' }}>{waterGal} gallons</span> of water.
                </p>
                <p className="text-[14px] text-ink-muted mt-1">
                  Logged to your impact.{' '}
                  <a href="/profile" className="underline underline-offset-2 text-ink hover:text-accent-700">
                    View your profile →
                  </a>
                </p>
              </>
            ) : (
              <>
                <p className="text-[16px] font-semibold text-ink leading-snug">Thanks for logging your impact honestly.</p>
                <p className="text-[14px] text-ink-muted mt-1">
                  Every scan helps track real textile waste.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Conflict banner ────────────────────────────────────────────────────────
  if (status === 'conflict') {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)', backgroundColor: '#FBF9F4' }}
      >
        <p className="text-[15px] text-ink-muted text-center">You&apos;ve already recorded an action for this garment.</p>
      </div>
    );
  }

  // ── Confirm step (throw_away only) ─────────────────────────────────────────
  if (status === 'confirming') {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)', backgroundColor: '#FBF9F4' }}
      >
        <p className="text-[15px] font-semibold text-ink mb-1">Send to landfill?</p>
        <p className="text-[14px] text-ink-muted mb-4">
          This garment will produce <span className="font-medium text-ink">{(cost.disposal_co2_kg * 2.205).toFixed(1)} lbs CO₂</span> and take{' '}
          <span className="font-medium text-ink">{cost.disposal_landfill_years} years</span> to break down.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { setStatus('idle'); setPendingAction(null); }}
            className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-ink-muted border border-rule transition-colors hover:bg-surface-sunk"
          >
            Go back
          </button>
          <button
            onClick={() => void submit('throw_away')}
            className="flex-1 rounded-xl py-3 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#B23A2B' }}
          >
            Yes, log it
          </button>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <div
        className="rounded-2xl p-5"
        style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)', backgroundColor: '#FBF9F4' }}
      >
        <p className="text-[15px] text-ink-muted mb-3">{errorMsg}</p>
        <button
          onClick={() => { setStatus('idle'); setPendingAction(null); setErrorMsg(null); }}
          className="text-[14px] font-semibold text-ink underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    );
  }

  // ── Idle / Loading: 4 action cards ────────────────────────────────────────
  const isLoading = status === 'loading';

  return (
    <div
      className="rounded-2xl p-5"
      style={{ boxShadow: '0 2px 16px rgba(20,22,26,0.07)', backgroundColor: '#FBF9F4' }}
    >
      <p className="text-[14px] font-semibold uppercase tracking-[0.1em] text-ink-muted mb-4">
        What will you do with it?
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {ACTION_ORDER.map((action) => {
          const meta = ACTION_META[action];
          const isActive = pendingAction === action && isLoading;
          const isFaded = isLoading && pendingAction !== action;
          const isRecommended = recommended === action;

          return (
            <button
              key={action}
              onClick={() => handleCardTap(action)}
              disabled={isLoading}
              className="relative flex flex-col items-center justify-center gap-2 rounded-xl px-3 py-4 text-center transition-all duration-150 active:scale-95 disabled:cursor-default"
              style={{
                backgroundColor: meta.bg,
                opacity: isFaded ? 0.4 : 1,
                outline: isActive ? `2px solid ${meta.ringColor}` : undefined,
                outlineOffset: isActive ? '2px' : undefined,
                minHeight: 88,
              }}
            >
              {/* Recommended badge */}
              {isRecommended && !isLoading && (
                <span
                  className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-white whitespace-nowrap"
                  style={{ backgroundColor: meta.ringColor }}
                >
                  Best pick
                </span>
              )}

              {/* Icon */}
              <span style={{ color: meta.iconColor }}>
                {isActive ? <SpinnerIcon /> : meta.icon}
              </span>

              {/* Label */}
              <span className="text-[14px] font-semibold text-ink leading-tight">{meta.label}</span>
              <span className="text-[12px] text-ink-muted leading-tight">{meta.sublabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

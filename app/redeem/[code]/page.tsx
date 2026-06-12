'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import type { PartnerRecord } from '@/types/partner';

type ReferralStatus = 'issued' | 'redeemed' | 'expired';

type ReferralInfo = {
  businessName: string;
  discountPct: number;
  status: ReferralStatus;
  expiresAt: number | null;
};

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'invalid_code' }
  | { kind: 'redeemed' }
  | { kind: 'expired' }
  | { kind: 'issued'; info: ReferralInfo };

type RedeemState =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'success' }
  | { kind: 'error'; message: string };

export default function RedeemPage() {
  const { code } = useParams<{ code: string }>();
  const { user, firebaseUser, loading: authLoading } = useAuth();

  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' });
  const [partnerRecord, setPartnerRecord] = useState<PartnerRecord | null | 'loading'>('loading');
  const [redeemState, setRedeemState] = useState<RedeemState>({ kind: 'idle' });

  // Validate code format client-side first.
  const CODE_RE = /^[A-Za-z0-9_-]{8}$/;

  // Fetch referral info on mount.
  useEffect(() => {
    if (!code) {
      setPageState({ kind: 'invalid_code' });
      return;
    }
    if (!CODE_RE.test(code)) {
      setPageState({ kind: 'invalid_code' });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/referrals/${code}`);
        if (cancelled) return;
        if (res.status === 400) {
          setPageState({ kind: 'invalid_code' });
          return;
        }
        if (res.status === 404) {
          setPageState({ kind: 'not_found' });
          return;
        }
        if (!res.ok) {
          setPageState({ kind: 'not_found' });
          return;
        }
        const info = (await res.json()) as ReferralInfo;
        if (info.status === 'redeemed') {
          setPageState({ kind: 'redeemed' });
        } else if (info.status === 'expired') {
          setPageState({ kind: 'expired' });
        } else {
          setPageState({ kind: 'issued', info });
        }
      } catch {
        if (!cancelled) setPageState({ kind: 'not_found' });
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Fetch partner record when signed in.
  useEffect(() => {
    if (authLoading) return;
    if (!firebaseUser) {
      setPartnerRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/partners/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.ok) {
          setPartnerRecord((await res.json()) as PartnerRecord);
        } else {
          setPartnerRecord(null);
        }
      } catch {
        if (!cancelled) setPartnerRecord(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser, authLoading]);

  async function handleConfirm() {
    if (!firebaseUser) return;
    setRedeemState({ kind: 'confirming' });

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`/api/referrals/${code}/redeem`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        setRedeemState({ kind: 'success' });
        return;
      }

      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const fallback = 'Redemption failed. Please try again.';

      if (res.status === 403) {
        setRedeemState({ kind: 'error', message: body.error ?? 'This code belongs to a different business.' });
      } else if (res.status === 409) {
        setRedeemState({ kind: 'error', message: body.error ?? 'This code has already been redeemed.' });
      } else if (res.status === 410) {
        setRedeemState({ kind: 'error', message: body.error ?? 'This referral code has expired.' });
      } else {
        setRedeemState({ kind: 'error', message: body.error ?? fallback });
      }
    } catch {
      setRedeemState({ kind: 'error', message: 'Network error. Please try again.' });
    }
  }

  // ─── Full-screen success state ─────────────────────────────────────────────

  if (redeemState.kind === 'success') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <div
            className="mx-auto w-20 h-20 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--success)', opacity: 0.15 }}
          />
          <div
            className="mx-auto w-20 h-20 rounded-full flex items-center justify-center -mt-20"
            style={{ backgroundColor: 'color-mix(in srgb, var(--success) 12%, transparent)' }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--success)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <div className="space-y-2">
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono" style={{ color: 'var(--success)' }}>
              Confirmed
            </p>
            <h1 className="text-[28px] font-semibold text-ink font-display">
              Redemption confirmed
            </h1>
            <p className="text-[16px] text-ink-muted">
              The discount has been applied. Thank you.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (pageState.kind === 'loading') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <p className="text-[15px] text-ink-muted">Loading...</p>
      </main>
    );
  }

  // ─── Invalid code ──────────────────────────────────────────────────────────

  if (pageState.kind === 'invalid_code') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono" style={{ color: 'var(--danger)' }}>
            Invalid code
          </p>
          <h1 className="text-[28px] font-semibold text-ink font-display">
            This link isn&apos;t valid
          </h1>
          <p className="text-[16px] text-ink-muted">
            Check that you have the full link and try again.
          </p>
        </div>
      </main>
    );
  }

  // ─── Not found ─────────────────────────────────────────────────────────────

  if (pageState.kind === 'not_found') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono" style={{ color: 'var(--danger)' }}>
            Not found
          </p>
          <h1 className="text-[28px] font-semibold text-ink font-display">
            Referral code not found
          </h1>
          <p className="text-[16px] text-ink-muted">
            This code doesn&apos;t exist or may have been removed.
          </p>
        </div>
      </main>
    );
  }

  // ─── Already redeemed ──────────────────────────────────────────────────────

  if (pageState.kind === 'redeemed') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono text-ink-faint">
            Already used
          </p>
          <h1 className="text-[28px] font-semibold text-ink font-display">
            Already redeemed
          </h1>
          <p className="text-[16px] text-ink-muted">
            This referral code has already been used.
          </p>
        </div>
      </main>
    );
  }

  // ─── Expired ───────────────────────────────────────────────────────────────

  if (pageState.kind === 'expired') {
    return (
      <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono" style={{ color: 'var(--warning)' }}>
            Expired
          </p>
          <h1 className="text-[28px] font-semibold text-ink font-display">
            Code expired
          </h1>
          <p className="text-[16px] text-ink-muted">
            This referral code is no longer valid.
          </p>
        </div>
      </main>
    );
  }

  // ─── Issued — main panel ───────────────────────────────────────────────────

  const { info } = pageState;
  const isVerifiedPartner = partnerRecord !== null && partnerRecord !== 'loading' && partnerRecord.status === 'verified';
  const partnerLoading = partnerRecord === 'loading' || authLoading;

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-8">

        {/* Header chip */}
        <div className="text-center">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase font-mono text-ink-faint">
            Rethread referral
          </p>
        </div>

        {/* Discount headline */}
        <div className="text-center space-y-2 py-8 border-y border-rule">
          <p
            className="font-display font-semibold leading-none"
            style={{ fontSize: '72px', letterSpacing: '-0.02em', color: 'var(--ink)' }}
          >
            {info.discountPct}%
          </p>
          <p className="text-[18px] font-semibold text-ink">off</p>
          <p className="text-[14px] text-ink-muted tracking-wide">honor at checkout</p>
        </div>

        {/* Business info */}
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase font-mono text-ink-faint">
              Business
            </p>
            <p className="text-[15px] text-ink font-medium">{info.businessName}</p>
          </div>
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-bold tracking-[0.12em] uppercase font-mono text-ink-faint">
              Code
            </p>
            <p
              className="text-[14px] font-mono tracking-widest text-ink"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {code}
            </p>
          </div>
        </div>

        {/* Confirm redemption section */}
        <div className="pt-4 space-y-3">
          {!authLoading && !partnerLoading && (
            <>
              {/* Case 1: signed in and verified partner */}
              {user && isVerifiedPartner && (
                <>
                  {redeemState.kind === 'error' && (
                    <p className="text-[14px] text-center" style={{ color: 'var(--danger)' }}>
                      {redeemState.message}
                    </p>
                  )}
                  <button
                    onClick={handleConfirm}
                    disabled={redeemState.kind === 'confirming'}
                    className="w-full h-14 rounded-md text-bg text-[16px] font-semibold transition-opacity hover:opacity-80 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--ink)', minHeight: '56px' }}
                  >
                    {redeemState.kind === 'confirming' ? 'Confirming…' : 'Confirm redemption'}
                  </button>
                </>
              )}

              {/* Case 2: signed in but not a verified partner */}
              {user && !isVerifiedPartner && (
                <p className="text-[13px] text-center text-ink-faint">
                  Only the verified business account can confirm this code.
                </p>
              )}

              {/* Case 3: signed out */}
              {!user && (
                <div className="space-y-3 text-center">
                  <p className="text-[14px] text-ink-muted">
                    Staff: sign in to confirm this referral.
                  </p>
                  {/* Login page does not support a ?next= redirect param — linking /login directly */}
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center w-full h-14 rounded-md border border-rule text-ink text-[15px] font-medium transition-opacity hover:opacity-80 active:scale-[0.98]"
                    style={{ minHeight: '56px' }}
                  >
                    Sign in to confirm
                  </Link>
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </main>
  );
}

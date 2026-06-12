'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { useAuth } from '@/lib/firebase/auth-context';

type Props = {
  scanId: string;
  partnerId: string;
  partnerName: string;
  discountPct: number;
};

type IdleState = { phase: 'idle' };
type LoadingState = { phase: 'loading' };
type ReadyState = {
  phase: 'ready';
  code: string;
  url: string;
  qrDataUrl: string;
  discountPct: number;
  expiresAt: number;
};
type ErrorState = { phase: 'error'; message: string };

type State = IdleState | LoadingState | ReadyState | ErrorState;

export function ReferralQr({ scanId, partnerId, partnerName, discountPct }: Props) {
  const { firebaseUser } = useAuth();
  const [state, setState] = useState<State>({ phase: 'idle' });

  async function handleClick() {
    setState({ phase: 'loading' });

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (firebaseUser) {
        const token = await firebaseUser.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }

      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers,
        body: JSON.stringify({ scanId, partnerId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState({
          phase: 'error',
          message: (body as { error?: string }).error ?? 'Something went wrong. Please try again.',
        });
        return;
      }

      const data = (await res.json()) as {
        code: string;
        url: string;
        discountPct: number;
        expiresAt: number;
      };

      const qrDataUrl = await QRCode.toDataURL(data.url, { width: 280, margin: 1 });

      setState({
        phase: 'ready',
        code: data.code,
        url: data.url,
        qrDataUrl,
        discountPct: data.discountPct,
        expiresAt: data.expiresAt,
      });
    } catch {
      setState({ phase: 'error', message: 'Network error. Please try again.' });
    }
  }

  if (state.phase === 'idle' || state.phase === 'loading') {
    return (
      <button
        onClick={handleClick}
        disabled={state.phase === 'loading'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 20px',
          background: 'var(--ink)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          fontFamily: 'var(--font-ui)',
          fontSize: '14px',
          fontWeight: 600,
          letterSpacing: '0.01em',
          cursor: state.phase === 'loading' ? 'wait' : 'pointer',
          opacity: state.phase === 'loading' ? 0.65 : 1,
          transition: 'transform var(--duration-fast) var(--ease-out), opacity var(--duration-fast) var(--ease-out)',
          minHeight: '44px',
        }}
      >
        {state.phase === 'loading' ? (
          <>
            <SpinnerIcon />
            Generating code…
          </>
        ) : (
          <>
            <QrIcon />
            Get {discountPct}% off — show this at checkout
          </>
        )}
      </button>
    );
  }

  if (state.phase === 'error') {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
          maxWidth: '320px',
        }}
      >
        <p
          style={{
            margin: 0,
            fontFamily: 'var(--font-ui)',
            fontSize: '14px',
            color: 'var(--danger)',
          }}
        >
          {state.message}
        </p>
        <button
          onClick={() => setState({ phase: 'idle' })}
          style={{
            alignSelf: 'flex-start',
            padding: '8px 16px',
            background: 'transparent',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-md)',
            fontFamily: 'var(--font-ui)',
            fontSize: '13px',
            fontWeight: 500,
            color: 'var(--ink)',
            cursor: 'pointer',
            minHeight: '36px',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // phase === 'ready'
  const expiry = new Date(state.expiresAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        padding: '24px',
        background: 'var(--surface)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-md)',
        maxWidth: '320px',
      }}
    >
      {/* Partner name */}
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-ui)',
          fontSize: '11px',
          fontWeight: 500,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-muted)',
        }}
      >
        {partnerName}
      </p>

      {/* QR image */}
      <img
        src={state.qrDataUrl}
        alt="referral qr code"
        width={280}
        height={280}
        style={{ display: 'block', borderRadius: 'var(--radius-sm)' }}
      />

      {/* Discount badge */}
      <div
        style={{
          padding: '4px 12px',
          background: 'var(--accent-50)',
          border: '1px solid var(--accent-200)',
          borderRadius: 'var(--radius-sm)',
          fontFamily: 'var(--font-ui)',
          fontSize: '18px',
          fontWeight: 600,
          color: 'var(--accent-700)',
        }}
      >
        {state.discountPct}% off
      </div>

      {/* Short code fallback */}
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          letterSpacing: '0.12em',
          color: 'var(--ink)',
          userSelect: 'all',
        }}
      >
        {state.code}
      </p>

      {/* Expiry */}
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          letterSpacing: '0.06em',
          color: 'var(--ink-faint)',
        }}
      >
        VALID UNTIL {expiry.toUpperCase()}
      </p>
    </div>
  );
}

// ─── Inline SVG icons ─────────────────────────────────────────────────────────

function QrIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="3" height="3" />
      <line x1="18" y1="14" x2="21" y2="14" />
      <line x1="18" y1="17" x2="21" y2="17" />
      <line x1="18" y1="20" x2="21" y2="20" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

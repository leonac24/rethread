'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup } from 'firebase/auth';
import Image from 'next/image';
import { clientAuth, googleProvider } from '@/lib/firebase/client';

const ZIP_RE = /^\d{5}(-\d{4})?$/;

type StoreForm = {
  storeName: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
};

const EMPTY_STORE: StoreForm = {
  storeName: '',
  street1: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
};

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin w-5 h-5 text-ink-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'user' | 'retailer'>('user');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState<StoreForm>(EMPTY_STORE);

  const storeValid =
    store.storeName.trim() !== '' &&
    store.street1.trim() !== '' &&
    store.city.trim() !== '' &&
    store.state.trim() !== '' &&
    ZIP_RE.test(store.zip.trim()) &&
    store.phone.trim() !== '';

  async function handleGoogleSignIn() {
    setLoading(true);
    setError(null);

    try {
      const result = await signInWithPopup(clientAuth(), googleProvider);
      const token = await result.user.getIdToken();

      // Register / update user in Firestore via our backend
      const res = await fetch('/api/auth/callback', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(mode === 'retailer' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(mode === 'retailer'
          ? {
              body: JSON.stringify({
                retailer: {
                  storeName: store.storeName.trim(),
                  street1: store.street1.trim(),
                  city: store.city.trim(),
                  state: store.state.trim(),
                  zip: store.zip.trim(),
                  phone: store.phone.trim(),
                },
              }),
            }
          : {}),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Failed to set up your account.');
      }

      router.push(mode === 'retailer' ? '/retailer' : '/profile');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed.';
      // User closed the popup — don't show as an error
      if (msg.includes('popup-closed') || msg.includes('cancelled')) {
        setLoading(false);
        return;
      }
      setError(msg);
      setLoading(false);
    }
  }

  function storeInput(
    field: keyof StoreForm,
    placeholder: string,
    extra?: { className?: string; inputMode?: 'numeric' | 'tel' },
  ) {
    return (
      <input
        type="text"
        value={store[field]}
        onChange={(e) => setStore((s) => ({ ...s, [field]: e.target.value }))}
        placeholder={placeholder}
        inputMode={extra?.inputMode}
        className={`w-full rounded-xl border border-rule bg-bg px-4 py-3 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-ink-muted ${extra?.className ?? ''}`}
      />
    );
  }

  const isRetailer = mode === 'retailer';

  return (
    <main className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8">
      <div
        className="w-full max-w-sm rounded-2xl p-8 space-y-6"
        style={{ boxShadow: '0 2px 24px rgba(20,22,26,0.09)', backgroundColor: '#FBF9F4' }}
      >
        {/* Logo */}
        <div className="flex justify-center">
          <Image
            src="/images/hero.webp"
            alt="Rethread"
            width={90}
            height={90}
            className="w-[90px] h-auto object-contain"
          />
        </div>

        {/* Heading */}
        <div className="text-center space-y-1">
          <h1 className="text-[24px] font-bold text-ink font-display">
            {isRetailer ? 'Partner with Rethread' : 'Welcome back'}
          </h1>
          <p className="text-[14px] text-ink-muted">
            {isRetailer
              ? 'Make offers on locally listed clothing by joining as a resale partner.'
              : 'Sign in to track your environmental impact and earn badges.'}
          </p>
        </div>

        {/* Retailer store details */}
        {isRetailer && (
          <div className="space-y-2.5">
            {storeInput('storeName', 'Store name')}
            {storeInput('street1', 'Street address')}
            <div className="flex gap-2.5">
              {storeInput('city', 'City', { className: 'flex-[2]' })}
              {storeInput('state', 'State', { className: 'flex-1' })}
            </div>
            <div className="flex gap-2.5">
              {storeInput('zip', 'ZIP', { className: 'flex-1', inputMode: 'numeric' })}
              {storeInput('phone', 'Phone', { className: 'flex-[2]', inputMode: 'tel' })}
            </div>
            <p className="text-[12px] text-ink-faint leading-relaxed pt-1">
              Applications are reviewed by hand — you&apos;ll get access once approved.
            </p>
          </div>
        )}

        {/* Google Sign-In button */}
        <button
          onClick={handleGoogleSignIn}
          disabled={loading || (isRetailer && !storeValid)}
          className="w-full flex items-center justify-center gap-3 rounded-xl border border-rule bg-bg px-5 py-3.5 text-[15px] font-semibold text-ink transition-all hover:bg-surface-sunk active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ boxShadow: '0 1px 4px rgba(20,22,26,0.06)' }}
        >
          {loading ? <Spinner /> : <GoogleIcon />}
          {loading
            ? 'Signing in…'
            : isRetailer
              ? 'Apply with Google'
              : 'Continue with Google'}
        </button>

        {/* Error */}
        {error && (
          <p className="text-center text-[13px] text-danger">{error}</p>
        )}

        {/* Divider + guest path */}
        {!isRetailer && (
          <>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-rule" />
              <span className="text-[12px] text-ink-faint">or</span>
              <div className="flex-1 h-px bg-rule" />
            </div>

            <a
              href="/scan"
              className="block w-full text-center rounded-xl border border-rule px-5 py-3 text-[14px] font-medium text-ink-muted transition-colors hover:bg-surface-sunk"
            >
              Continue without signing in
            </a>
          </>
        )}

        <p className="text-center text-[12px] text-ink-faint leading-relaxed">
          By signing in you agree to our terms. Your scan data is stored locally and never sold.
        </p>

        {/* Mode toggle */}
        <button
          type="button"
          onClick={() => {
            setMode(isRetailer ? 'user' : 'retailer');
            setError(null);
          }}
          className="block w-full text-center text-[12px] text-ink-faint underline underline-offset-2 hover:text-ink-muted transition-colors cursor-pointer"
        >
          {isRetailer ? '← Back to user sign-in' : 'Sign up as a retailer'}
        </button>
      </div>
    </main>
  );
}

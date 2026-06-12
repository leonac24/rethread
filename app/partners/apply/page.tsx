'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth-context';
import { LoadingScreen } from '@/components/loading-screen';
import Header from '@/components/header';
import Footer from '@/components/footer';
import type { PartnerRecord, PartnerType } from '@/types/partner';

type Kind = 'partner' | 'brand_claim';

function StatusPanel({ record }: { record: PartnerRecord }) {
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Header />
      <main className="flex-1 content-width py-16 flex flex-col items-center justify-center">
        <div className="w-full max-w-md bg-surface border border-rule rounded-lg p-8 space-y-4">
          <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-ink-faint font-mono">
            Application status
          </p>
          {record.status === 'pending' && (
            <>
              <h1 className="text-[22px] font-semibold text-ink font-display">
                Application received
              </h1>
              <p className="text-[16px] text-ink-muted">
                We review applications within a few days. You&apos;ll hear from us by email.
              </p>
            </>
          )}
          {record.status === 'verified' && (
            <>
              <h1 className="text-[22px] font-semibold text-ink font-display">
                You&apos;re verified.
              </h1>
              <p className="text-[16px] text-ink-muted">
                Your partner account is active.
              </p>
              <Link
                href="/partners/dashboard"
                className="inline-flex items-center h-11 px-6 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
              >
                Go to dashboard
              </Link>
            </>
          )}
          {record.status === 'rejected' && (
            <>
              <h1 className="text-[22px] font-semibold text-ink font-display">
                Application not approved
              </h1>
              <p className="text-[16px] text-ink-muted">
                Your application wasn&apos;t approved. Contact us if you have questions.
              </p>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function ApplyForm() {
  const { user, firebaseUser, loading } = useAuth();
  const searchParams = useSearchParams();
  const brandParam = searchParams.get('brand') ?? '';

  const [existingRecord, setExistingRecord] = useState<PartnerRecord | null | 'loading'>('loading');
  const [kind, setKind] = useState<Kind>(brandParam ? 'brand_claim' : 'partner');

  // Form fields
  const [businessName, setBusinessName] = useState('');
  const [partnerType, setPartnerType] = useState<PartnerType>('repair');
  const [address, setAddress] = useState('');
  const [discountPct, setDiscountPct] = useState(5);
  const [brandSlug, setBrandSlug] = useState(brandParam);
  const [evidenceLinks, setEvidenceLinks] = useState('');
  const [evidenceText, setEvidenceText] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Check for existing application on mount
  useEffect(() => {
    if (!firebaseUser) {
      setExistingRecord(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/partners/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.status === 404) {
          if (!cancelled) setExistingRecord(null);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as PartnerRecord;
          if (!cancelled) setExistingRecord(data);
          return;
        }
        if (!cancelled) setExistingRecord(null);
      } catch {
        if (!cancelled) setExistingRecord(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firebaseUser) return;

    setSubmitting(true);
    setSubmitError(null);

    // Parse evidence links — one per line, filter blanks
    const links = evidenceLinks
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const payload: Record<string, unknown> = {
      kind,
      businessName,
      evidence: { links, text: evidenceText },
      discountPct,
    };

    if (kind === 'partner') {
      payload.type = partnerType;
      if (address.trim()) payload.address = address.trim();
    } else {
      payload.brandSlug = brandSlug;
    }

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch('/api/partners/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = (await res.json().catch(() => ({}))) as { error?: string; status?: string };

      if (!res.ok) {
        setSubmitError(body.error ?? 'Submission failed. Please try again.');
        return;
      }

      setSubmitted(true);
    } catch {
      setSubmitError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  // Auth loading
  if (loading || existingRecord === 'loading') {
    return <LoadingScreen blurbs={['Loading partner portal']} />;
  }

  // Not signed in
  if (!user) {
    return (
      <div className="min-h-screen bg-bg flex flex-col">
        <Header />
        <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
          <p className="text-[16px] text-ink-muted text-center">
            Sign in to apply as a partner.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-8 rounded-md bg-ink text-bg text-[14px] font-medium transition-opacity hover:opacity-80"
          >
            Sign in
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  // Show status for existing application or post-submit
  if (submitted) {
    const pendingRecord: PartnerRecord = {
      kind,
      businessName,
      evidence: { links: [], text: evidenceText },
      discountPct,
      status: 'pending',
      appliedAt: Date.now(),
    };
    return <StatusPanel record={pendingRecord} />;
  }

  if (existingRecord) {
    return <StatusPanel record={existingRecord} />;
  }

  // Application form
  return (
    <div className="min-h-screen bg-bg flex flex-col">
      <Header />

      <main className="flex-1 content-width py-12">
        <div className="max-w-xl mx-auto space-y-8">

          {/* Page header */}
          <div className="space-y-1">
            <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-ink-faint font-mono">
              Partner programme
            </p>
            <h1 className="text-[28px] font-semibold text-ink font-display">
              Apply to partner with Rethread
            </h1>
            <p className="text-[16px] text-ink-muted">
              List your repair shop, resale store, or brand — and offer Rethread members a discount.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">

            {/* Kind toggle */}
            <fieldset className="space-y-2">
              <legend className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">
                Application type
              </legend>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setKind('partner')}
                  className={[
                    'flex-1 py-3 rounded-md text-[14px] font-medium border transition-colors',
                    kind === 'partner'
                      ? 'border-ink bg-ink text-bg'
                      : 'border-rule bg-surface text-ink-muted hover:bg-surface-sunk',
                  ].join(' ')}
                >
                  Local business
                </button>
                <button
                  type="button"
                  onClick={() => setKind('brand_claim')}
                  className={[
                    'flex-1 py-3 rounded-md text-[14px] font-medium border transition-colors',
                    kind === 'brand_claim'
                      ? 'border-ink bg-ink text-bg'
                      : 'border-rule bg-surface text-ink-muted hover:bg-surface-sunk',
                  ].join(' ')}
                >
                  Claim a brand
                </button>
              </div>
            </fieldset>

            {/* Business name */}
            <div className="space-y-1.5">
              <label
                htmlFor="businessName"
                className="block text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted"
              >
                Business name
              </label>
              <input
                id="businessName"
                type="text"
                required
                minLength={2}
                maxLength={100}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Your business name"
                className="w-full h-11 px-3 rounded-sm border border-rule bg-surface text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500 focus:ring-0 transition-colors"
                style={{ borderWidth: '1px' }}
              />
            </div>

            {/* Partner-specific fields */}
            {kind === 'partner' && (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="type"
                    className="block text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted"
                  >
                    Business type
                  </label>
                  <select
                    id="type"
                    required
                    value={partnerType}
                    onChange={(e) => setPartnerType(e.target.value as PartnerType)}
                    className="w-full h-11 px-3 rounded-sm border border-rule bg-surface text-[15px] text-ink focus:outline-none focus:border-accent-500 transition-colors appearance-none"
                    style={{ borderWidth: '1px' }}
                  >
                    <option value="repair">Repair</option>
                    <option value="resale">Resale</option>
                    <option value="donation">Donation</option>
                    <option value="recycler">Recycler</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="address"
                    className="block text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted"
                  >
                    Address{' '}
                    <span className="text-ink-faint font-normal normal-case tracking-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="address"
                    type="text"
                    maxLength={200}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="123 Main St, City, State"
                    className="w-full h-11 px-3 rounded-sm border border-rule bg-surface text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500 transition-colors"
                    style={{ borderWidth: '1px' }}
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="discountPct"
                    className="block text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted"
                  >
                    Referral discount (%)
                  </label>
                  <input
                    id="discountPct"
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    required
                    value={discountPct}
                    onChange={(e) => setDiscountPct(Number(e.target.value))}
                    className="w-full h-11 px-3 rounded-sm border border-rule bg-surface text-[15px] text-ink focus:outline-none focus:border-accent-500 transition-colors"
                    style={{ borderWidth: '1px' }}
                  />
                  <p className="text-[12px] text-ink-faint">
                    Discount you&apos;ll honor for Rethread referrals (0–20%).
                  </p>
                </div>
              </>
            )}

            {/* Brand-claim-specific fields */}
            {kind === 'brand_claim' && (
              <div className="space-y-1.5">
                <label
                  htmlFor="brandSlug"
                  className="block text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted"
                >
                  Brand slug
                </label>
                <input
                  id="brandSlug"
                  type="text"
                  required
                  pattern="[a-z0-9\-]{1,80}"
                  maxLength={80}
                  value={brandSlug}
                  onChange={(e) => setBrandSlug(e.target.value)}
                  readOnly={Boolean(brandParam)}
                  placeholder="e.g. patagonia"
                  className={[
                    'w-full h-11 px-3 rounded-sm border border-rule bg-surface text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500 transition-colors font-mono',
                    brandParam ? 'opacity-60 cursor-default' : '',
                  ].join(' ')}
                  style={{ borderWidth: '1px' }}
                />
                <p className="text-[12px] text-ink-faint">
                  The URL slug for your brand as it appears on Rethread.
                </p>
              </div>
            )}

            {/* Evidence */}
            <div className="space-y-4">
              <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">
                Evidence
              </p>

              <div className="space-y-1.5">
                <label
                  htmlFor="evidenceLinks"
                  className="block text-[13px] text-ink-muted"
                >
                  Supporting links{' '}
                  <span className="text-ink-faint">(one per line, https only, max 5)</span>
                </label>
                <textarea
                  id="evidenceLinks"
                  rows={4}
                  value={evidenceLinks}
                  onChange={(e) => setEvidenceLinks(e.target.value)}
                  placeholder={'https://example.com/about\nhttps://yelp.com/biz/...'}
                  className="w-full px-3 py-2.5 rounded-sm border border-rule bg-surface text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500 transition-colors resize-none font-mono"
                  style={{ borderWidth: '1px' }}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="evidenceText"
                  className="block text-[13px] text-ink-muted"
                >
                  Description{' '}
                  <span className="text-ink-faint">(max 2000 characters)</span>
                </label>
                <textarea
                  id="evidenceText"
                  rows={5}
                  maxLength={2000}
                  value={evidenceText}
                  onChange={(e) => setEvidenceText(e.target.value)}
                  placeholder="Tell us about your business, your sustainability practices, and why you want to partner with Rethread."
                  className="w-full px-3 py-2.5 rounded-sm border border-rule bg-surface text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500 transition-colors resize-none"
                  style={{ borderWidth: '1px' }}
                />
                <p className="text-[12px] text-ink-faint text-right">
                  {evidenceText.length} / 2000
                </p>
              </div>
            </div>

            {/* Submit */}
            {submitError && (
              <p className="text-[14px] text-danger">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-11 rounded-md bg-ink text-bg text-[15px] font-medium transition-opacity hover:opacity-80 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Submitting…' : 'Submit application'}
            </button>

          </form>
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function PartnersApplyPage() {
  return (
    <Suspense fallback={<LoadingScreen blurbs={['Loading partner portal']} />}>
      <ApplyForm />
    </Suspense>
  );
}

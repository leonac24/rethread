export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getBrand } from '@/lib/brands';
import { GradeBadge } from '@/components/grade-badge';
import type { BrandStatus } from '@/types/brand';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]{1,80}$/;

const STATUS_LABEL: Record<BrandStatus, string> = {
  unclaimed: 'AI-researched',
  claimed: 'Claimed',
  verified: 'Verified',
};

const STATUS_EXPLAINER: Record<BrandStatus, string> = {
  unclaimed: 'This page was researched by AI and has not been claimed by the brand.',
  claimed: 'Claimed by the brand.',
  verified: 'Verified by rethread.',
};

const STATUS_STYLE: Record<BrandStatus, { color: string; bg: string }> = {
  unclaimed: { color: 'var(--ink-faint)', bg: 'transparent' },
  claimed: { color: 'var(--accent-700)', bg: 'color-mix(in srgb, var(--accent-500) 9%, transparent)' },
  verified: { color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 9%, transparent)' },
};

function barColor(value: number): string {
  if (value >= 65) return 'var(--success)';
  if (value >= 50) return 'var(--accent-500)';
  if (value >= 35) return 'var(--warning)';
  if (value >= 20) return 'color-mix(in srgb, var(--warning) 60%, var(--danger) 40%)';
  return 'var(--danger)';
}

function DimBar({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption?: string;
}) {
  const color = barColor(value);
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
          {label}
        </span>
        <span
          className="font-mono text-[14px] font-bold tabular-nums"
          style={{ color }}
        >
          {Math.round(value)}
        </span>
      </div>
      <div
        className="relative w-full h-2 rounded-sm overflow-hidden"
        style={{ backgroundColor: 'var(--rule)' }}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-label={`${label} score`}
      >
        <div
          className="absolute top-0 left-0 h-full rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      {caption && (
        <p className="font-mono text-[10px] text-ink-faint mt-1 tracking-[0.04em]">
          {caption}
        </p>
      )}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  return {
    title: `${slug} brand report — Rethread`,
  };
}

export default async function BrandDetailPage({ params }: Props) {
  const { slug } = await params;

  if (!SLUG_RE.test(slug)) notFound();

  let brand;
  try {
    brand = await getBrand(slug);
  } catch {
    notFound();
  }

  if (!brand) notFound();

  const pi = brand.dims.productImpact;
  const productCaption =
    pi.n === 0
      ? 'no scans yet — research baseline'
      : `based on ${pi.n} scanned garment${pi.n !== 1 ? 's' : ''}`;

  const statusStyle = STATUS_STYLE[brand.status];

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width max-w-2xl">

        {/* Back */}
        <Link
          href="/brands"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink transition-colors mb-6"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          All brands
        </Link>

        {/* ── Hero ── */}
        <div className="flex items-start gap-5 mb-6">
          <GradeBadge grade={brand.grade} score={brand.score} size="lg" />
          <div className="pt-1">
            <h1 className="text-[28px] md:text-[34px] font-bold text-ink leading-tight">
              {brand.name}
            </h1>
            <span
              className="inline-flex items-center gap-1 font-mono text-[11px] font-medium tracking-[0.06em] uppercase px-2 py-0.5 rounded-sm border mt-2"
              style={{
                color: statusStyle.color,
                backgroundColor: statusStyle.bg,
                borderColor: 'var(--rule)',
              }}
            >
              {brand.status === 'verified'
                ? `${STATUS_LABEL[brand.status]} ✓`
                : STATUS_LABEL[brand.status]}
            </span>
          </div>
        </div>

        {/* ── Dimension Bars ── */}
        <section className="bg-surface border border-rule rounded-md p-5 mb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted mb-1">
            Sustainability dimensions
          </p>
          <div className="divide-y divide-rule">
            <DimBar
              label="Product Impact"
              value={pi.current}
              caption={productCaption}
            />
            <DimBar label="Transparency" value={brand.dims.transparency} />
            <DimBar
              label="Labor & Supply Chain"
              value={brand.dims.laborSupplyChain}
            />
          </div>
        </section>

        {/* ── FTI ── */}
        {brand.fti && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-[13px] text-ink-muted">
              Fashion Transparency Index:{' '}
              <span className="font-semibold text-ink">
                {brand.fti.score}/100 ({brand.fti.year})
              </span>
            </span>
            <a
              href={brand.fti.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] text-accent-500 hover:underline underline-offset-2"
            >
              ↗ source
            </a>
          </div>
        )}

        {/* ── Dossier Summary ── */}
        {brand.dossier.summary && (
          <section className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted mb-2">
              Summary
            </p>
            <p className="text-[15px] leading-[22px] text-ink">
              {brand.dossier.summary}
            </p>
          </section>
        )}

        {/* ── Certifications ── */}
        {brand.dossier.certifications.length > 0 && (
          <section className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted mb-2">
              Certifications
            </p>
            <div className="flex flex-wrap gap-2">
              {brand.dossier.certifications.map((cert) => (
                <span
                  key={cert}
                  className="font-mono text-[11px] uppercase tracking-[0.06em] px-2 py-1 rounded-sm border text-ink-muted"
                  style={{ borderColor: 'var(--rule)', backgroundColor: 'var(--surface)' }}
                >
                  {cert}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* ── Citations ── */}
        {brand.dossier.citations.length > 0 && (
          <section className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted mb-2">
              Sources
            </p>
            <ul className="space-y-1">
              {brand.dossier.citations.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <span className="text-ink-faint mt-[2px] flex-shrink-0">·</span>
                  <span>
                    <span className="text-ink-muted">{c.claim} — </span>
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-500 hover:underline underline-offset-2"
                    >
                      {hostname(c.url)}
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Status explainer ── */}
        <div className="border-t border-rule pt-4 mb-4">
          <p className="text-[13px] text-ink-muted italic">
            {STATUS_EXPLAINER[brand.status]}
          </p>
        </div>

        {/* ── Claim CTA ── */}
        <div className="py-4 border border-rule rounded-md px-5 bg-surface flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <p className="text-[14px] text-ink-muted">
            Is this your brand?
          </p>
          <Link
            href={`/partners/apply?brand=${brand.slug}`}
            className="inline-flex items-center justify-center h-10 px-5 rounded-md bg-ink text-bg text-[13px] font-medium transition-transform duration-[120ms] ease-out active:scale-[0.96] hover:opacity-90 whitespace-nowrap"
          >
            Claim it
          </Link>
        </div>

      </div>
    </main>
  );
}

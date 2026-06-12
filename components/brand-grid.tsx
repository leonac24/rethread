'use client';

import Link from 'next/link';
import { useState } from 'react';
import { GradeBadge } from '@/components/grade-badge';
import type { BrandStatus } from '@/types/brand';
import type { Grade } from '@/lib/score/garment';

export type BrandGridItem = {
  name: string;
  slug: string;
  grade: Grade;
  score: number;
  status: BrandStatus;
  n: number;
};

const STATUS_LABEL: Record<BrandStatus, string> = {
  unclaimed: 'AI-researched',
  claimed: 'Claimed',
  verified: 'Verified',
};

const STATUS_STYLE: Record<BrandStatus, { color: string; bg: string }> = {
  unclaimed: { color: 'var(--ink-faint)', bg: 'transparent' },
  claimed: { color: 'var(--accent-700)', bg: 'color-mix(in srgb, var(--accent-500) 9%, transparent)' },
  verified: { color: 'var(--success)', bg: 'color-mix(in srgb, var(--success) 9%, transparent)' },
};

function StatusChip({ status }: { status: BrandStatus }) {
  const { color, bg } = STATUS_STYLE[status];
  const label = STATUS_LABEL[status];
  const showCheck = status === 'verified';
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[10px] font-medium tracking-[0.06em] uppercase px-2 py-0.5 rounded-sm border"
      style={{ color, backgroundColor: bg, borderColor: 'var(--rule)' }}
    >
      {showCheck ? `${label} ✓` : label}
    </span>
  );
}

export function BrandGrid({ brands }: { brands: BrandGridItem[] }) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? brands.filter((b) =>
        b.name.toLowerCase().includes(query.toLowerCase()),
      )
    : brands;

  return (
    <div>
      {/* Search */}
      <div className="mb-6">
        <label htmlFor="brand-search" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted mb-1.5">
          Search brands
        </label>
        <input
          id="brand-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. Patagonia, H&M…"
          className="w-full max-w-sm h-10 px-3 rounded-sm bg-surface border border-rule text-[14px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-500"
          style={{ borderWidth: 1 }}
        />
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-display text-[22px] text-ink">No brands found.</p>
          <p className="text-[14px] text-ink-muted mt-1">Try a different search term.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filtered.map((brand) => (
            <Link
              key={brand.slug}
              href={`/brands/${brand.slug}`}
              className="group bg-surface border border-rule rounded-md p-4 flex flex-col gap-3 hover:border-accent-500 transition-colors duration-[120ms]"
            >
              <div className="flex items-start justify-between gap-2">
                <GradeBadge grade={brand.grade} score={brand.score} size="sm" />
                <StatusChip status={brand.status} />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-ink leading-snug group-hover:text-accent-700 transition-colors">
                  {brand.name}
                </p>
                {brand.n > 0 && (
                  <p className="font-mono text-[10px] text-ink-faint mt-1 tracking-[0.04em]">
                    {brand.n} scan{brand.n !== 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

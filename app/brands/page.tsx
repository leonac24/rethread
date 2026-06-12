export const dynamic = 'force-dynamic';

import { listBrands } from '@/lib/brands';
import { BrandGrid, type BrandGridItem } from '@/components/brand-grid';

export const metadata = {
  title: 'Brand report cards — Rethread',
  description: 'See sustainability grades for fashion brands, researched by rethread.',
};

export default async function BrandsPage() {
  let brands: BrandGridItem[] = [];

  try {
    const records = await listBrands();
    brands = records.map((b) => ({
      name: b.name,
      slug: b.slug,
      grade: b.grade,
      score: b.score,
      status: b.status,
      n: b.dims.productImpact.n,
    }));
  } catch {
    // no credentials at build time or runtime error — render empty state
  }

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width">
        <div className="mb-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted mb-3">
            Platform
          </p>
          <h1 className="font-display text-[32px] leading-[36px] md:text-[40px] md:leading-[44px] tracking-[-0.015em] text-ink" style={{ fontWeight: 400 }}>
            Brand report cards
          </h1>
          <p className="mt-3 text-[16px] leading-[24px] text-ink-muted max-w-[52ch]">
            Every grade is backed by AI research, real scan data, and public
            transparency indices. Find a brand to see the full dossier.
          </p>
        </div>

        <div className="border-t border-rule pt-6">
          <BrandGrid brands={brands} />
        </div>
      </div>
    </main>
  );
}

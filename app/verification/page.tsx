import Link from 'next/link';

export const metadata = {
  title: 'Verification standard — Rethread',
  description: 'How rethread verified works: criteria for local businesses and brands, the status ladder, and what verification means.',
};

export default function VerificationPage() {
  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width">

        {/* Page header */}
        <div className="mb-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-muted mb-3">
            Trust &amp; Evidence
          </p>
          <h1
            className="font-display text-[32px] leading-[36px] md:text-[40px] md:leading-[44px] tracking-[-0.015em] text-ink"
            style={{ fontWeight: 400 }}
          >
            What &ldquo;rethread verified&rdquo; means
          </h1>
          <p className="mt-3 text-[16px] leading-[24px] text-ink-muted max-w-[52ch]">
            The verified badge is not granted automatically. It marks entities whose
            evidence has been reviewed by a human on the rethread team.
          </p>
        </div>

        <div className="border-t border-rule pt-8 space-y-12">

          {/* For local businesses */}
          <section>
            <h2
              className="font-display text-[22px] leading-[28px] tracking-[-0.01em] text-ink mb-4"
              style={{ fontWeight: 500 }}
            >
              For local businesses
            </h2>
            <p className="text-[16px] leading-[24px] text-ink-muted mb-5 max-w-[62ch]">
              A local business can apply for verification if it operates as a
              legitimate resale, repair, donation, or recycling service. Before the
              badge is granted, we check:
            </p>
            <ul className="space-y-3 max-w-[62ch]">
              {[
                'Legitimate resale, repair, donation, or recycling operation with a physical or registered presence.',
                'Donated or collected garments are not landfilled or illegally exported.',
                'Transparent pricing for repair and resale services is publicly available.',
                'Evidence is reviewed manually by the rethread team before the badge is granted.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-[7px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-500" />
                  <p className="text-[16px] leading-[24px] text-ink-muted">{item}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* For brands */}
          <section>
            <h2
              className="font-display text-[22px] leading-[28px] tracking-[-0.01em] text-ink mb-4"
              style={{ fontWeight: 500 }}
            >
              For brands
            </h2>
            <p className="text-[16px] leading-[24px] text-ink-muted mb-5 max-w-[62ch]">
              Brand verification confirms that the entity managing a brand page is
              affiliated with that brand, and that public claims are accurate.
            </p>
            <ul className="space-y-3 max-w-[62ch]">
              {[
                'Proof of affiliation with the brand — a business email domain, official letterhead, or equivalent.',
                'Disclosure review covering materials, supply chain, and any stated certifications.',
                'Claims cross-checked against public sources before the badge is applied.',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-[7px] flex-shrink-0 w-1.5 h-1.5 rounded-full bg-accent-500" />
                  <p className="text-[16px] leading-[24px] text-ink-muted">{item}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Status ladder */}
          <section>
            <h2
              className="font-display text-[22px] leading-[28px] tracking-[-0.01em] text-ink mb-4"
              style={{ fontWeight: 500 }}
            >
              The status ladder
            </h2>
            <p className="text-[16px] leading-[24px] text-ink-muted mb-6 max-w-[62ch]">
              Every brand and partner page moves through three tiers.
            </p>
            <div className="space-y-4 max-w-[62ch]">
              {[
                {
                  step: '01',
                  label: 'AI-researched',
                  body: 'The baseline profile is built by our research pipeline from public sources. All citations are shown inline so you can follow the chain.',
                },
                {
                  step: '02',
                  label: 'Claimed',
                  body: 'The business or brand has signed in and taken ownership of the page. Information can be supplemented, but evidence has not yet been manually reviewed.',
                },
                {
                  step: '03',
                  label: 'Verified',
                  body: 'Evidence has been reviewed manually by the rethread team. Verification raises the weight the brand\'s established record carries in live impact scoring (κ). Grades become harder to shift by self-reported data alone.',
                },
              ].map(({ step, label, body }) => (
                <div
                  key={step}
                  className="flex gap-5 p-5 bg-surface border border-rule rounded-md"
                >
                  <p
                    className="flex-shrink-0 text-[11px] font-medium tracking-[0.15em] text-ink-faint mt-0.5"
                    style={{ fontFamily: 'var(--font-mono, monospace)' }}
                  >
                    {step}
                  </p>
                  <div>
                    <p className="text-[15px] font-semibold text-ink mb-1">{label}</p>
                    <p className="text-[15px] leading-[22px] text-ink-muted">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Disclaimer */}
          <section className="border-t border-rule pt-8">
            <p className="text-[15px] leading-[23px] text-ink-muted max-w-[62ch]">
              Verification reflects evidence reviewed at a specific point in time. It
              is not an endorsement by a certification body and does not constitute a
              legal guarantee of any claim. Business practices change; if you believe
              a verified listing is inaccurate or misleading, please use the contact
              link in the footer.
            </p>
          </section>

          {/* CTA */}
          <div className="pt-2 pb-4">
            <Link
              href="/partners/apply"
              className="inline-flex items-center justify-center h-12 px-8 rounded-md bg-ink text-bg text-[15px] font-medium transition-transform duration-[120ms] ease-out active:scale-[0.96]"
            >
              Apply for verification
            </Link>
          </div>

        </div>
      </div>
    </main>
  );
}

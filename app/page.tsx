import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-6 py-6 md:px-12 md:py-8 border-b border-rule">
        <span className="font-mono text-[11px] tracking-[0.15em] uppercase text-ink">
          Rethread
        </span>
        <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-ink-muted">
          NO.001 &nbsp;·&nbsp; WAVE&nbsp;INDEX
        </span>
      </header>

      <section className="flex-1 flex items-center">
        <div className="w-full max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-24 grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-8 md:col-start-2">
            <div className="text-[12px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-8">
              Garment&nbsp;·&nbsp;Footprint&nbsp;·&nbsp;Route
            </div>

            <h1
              className="font-display text-[40px] leading-[44px] md:text-[56px] md:leading-[60px] tracking-[-0.02em] text-ink"
              style={{ fontWeight: 400 }}
            >
              Scan a tag.
              <br />
              See the true cost.
              <br />
              <span className="text-accent-700">Give the garment</span>
              <br />
              <span className="text-accent-700">another life.</span>
            </h1>

            <p className="mt-10 max-w-[52ch] text-[16px] leading-[24px] text-ink-muted">
              One photo of a care label becomes a complete environmental
              footprint and three concrete next steps — one repair, one resale,
              one donation — all within walking distance.
            </p>

            <div className="mt-12 flex items-center gap-6">
              <Link
                href="/scan"
                className="inline-flex items-center justify-center h-11 px-6 rounded-md bg-ink text-bg text-[14px] font-medium transition-transform duration-[120ms] ease-out active:scale-[0.96]"
              >
                Begin scan
              </Link>
              <Link
                href="#how"
                className="text-[14px] text-ink-muted hover:text-ink hover:underline underline-offset-4"
              >
                How it works
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how"
        className="border-t border-rule"
      >
        <div className="w-full max-w-[1200px] mx-auto px-6 md:px-12 py-16 md:py-24 grid grid-cols-12 gap-6">
          {[
            {
              n: '01',
              label: 'Ingest',
              title: 'What is this garment?',
              body: 'Cloud Vision reads the care label. Fibers, origin, category — normalized in a second.',
            },
            {
              n: '02',
              label: 'Cost',
              title: 'What did it really take?',
              body: 'Gemini computes water, CO₂, and dye pollution, grounded by a brand-level sustainability row.',
            },
            {
              n: '03',
              label: 'Route',
              title: 'Where does it go next?',
              body: 'Maps returns exactly one repair, one resale, one donation — the nearest of each.',
            },
          ].map((step) => (
            <article
              key={step.n}
              className="col-span-12 md:col-span-4 border border-rule bg-surface p-6 relative"
            >
              <span className="absolute top-4 right-4 inline-block border border-rule rounded-sm px-2 py-[2px] font-mono text-[11px] tracking-[0.1em] uppercase text-ink-muted">
                NO.0{step.n.slice(-1)}
              </span>
              <div className="text-[12px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-4">
                {step.label}
              </div>
              <h2 className="font-display text-[22px] leading-[28px] text-ink mb-3" style={{ fontWeight: 500 }}>
                {step.title}
              </h2>
              <p className="text-[14px] leading-[20px] text-ink-muted">
                {step.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="w-full max-w-[1200px] mx-auto px-6 md:px-12 py-8 flex items-center justify-between">
          <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-ink-muted">
            平和 &nbsp;·&nbsp; ONE&nbsp;PHOTO &nbsp;·&nbsp; ONE&nbsp;ANSWER
          </span>
          <span className="font-mono text-[11px] tracking-[0.1em] uppercase text-ink-muted">
            © 2026
          </span>
        </div>
      </footer>
    </main>
  );
}

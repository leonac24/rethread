import Image from 'next/image';
import Link from 'next/link';

const CONTENT_WIDTH = 'w-full max-w-4xl mx-auto px-6 md:px-12';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <section className="flex items-center" style={{ minHeight: 'calc(100vh - 80px)' }}>
        <div className={`${CONTENT_WIDTH} py-16 md:py-24 relative`}>
          <div className="relative z-10">
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

          <div className="hidden md:block absolute -right-12 top-1/2 -translate-y-1/2">
            <Image
              src="/images/Flower.webp"
              alt="Care label with flower"
              width={540}
              height={675}
              priority
              className="w-[448px] h-auto rotate-6"
            />
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-rule">
        <div className={`${CONTENT_WIDTH} py-16 md:py-24`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                n: '01',
                label: 'Ingest',
                title: 'What is this garment?',
                body: 'Cloud Vision reads the care label. Fibers, origin, category, pulled out in about a second.',
              },
              {
                n: '02',
                label: 'Cost',
                title: 'What did it really take?',
                body: 'Gemini estimates water, CO₂, and dye pollution using brand-level sustainability data.',
              },
              {
                n: '03',
                label: 'Route',
                title: 'Where does it go next?',
                body: 'Maps finds one repair shop, one resale option, one donation center, all close to you.',
              },
            ].map((step) => (
              <article
                key={step.n}
                className="border border-rule bg-surface p-6 relative"
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
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className={`${CONTENT_WIDTH} py-8 flex items-center justify-between`}>
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

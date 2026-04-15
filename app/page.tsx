import Image from 'next/image';
import Link from 'next/link';

const CONTENT_WIDTH = 'content-width';

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col">
      <section className="relative flex items-start overflow-hidden" style={{ minHeight: 'calc((100vh - 80px) * 2 / 3)' }}>
        <div className="hidden xl:block absolute top-1/2 -translate-y-1/2" style={{ left: '-44px' }}>
          <Image src="/images/shoelace.png" alt="Shoelace" width={312} height={390} className="object-contain opacity-80" />
        </div>
        <div className={`${CONTENT_WIDTH} pb-5 md:pb-8 relative flex items-center justify-between gap-8`}>
          <div className="relative z-10 flex-1">
            <div className="text-[14px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-8">
              Garment&nbsp;·&nbsp;Footprint&nbsp;·&nbsp;Route
            </div>

            <h1
              className="font-display text-[34px] leading-[36px] md:text-[48px] md:leading-[52px] tracking-[-0.02em] text-ink"
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

            <p className="mt-10 max-w-[52ch] text-[19px] leading-[28px] text-ink-muted">
              One photo of a care label becomes a complete environmental
              footprint and three concrete next steps — one repair, one resale,
              one donation — all within walking distance.
            </p>

            <div className="mt-12 flex items-center gap-6">
              <Link
                href="/scan"
                className="inline-flex items-center justify-center h-12 px-8 rounded-md bg-ink text-bg text-[16px] font-medium transition-transform duration-[120ms] ease-out active:scale-[0.96]"
              >
                Begin scan
              </Link>
              <Link
                href="#how"
                className="text-[16px] text-ink-muted hover:text-ink hover:underline underline-offset-4"
              >
                How it works
              </Link>
            </div>
          </div>

          <div className="hidden md:flex flex-shrink-0 items-center justify-center">
            <Image
              src="/images/Flower.webp"
              alt="Care label with flower"
              width={600}
              height={750}
              priority
              className="w-[520px] h-auto rotate-6"
            />
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-rule">
        <div className={`${CONTENT_WIDTH} py-5 md:py-8`}>
          <div className="flex flex-col gap-8">

            {/* Row 1: Card left, image right */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="aspect-square">
                <article
                  className="h-full p-[15%] relative flex flex-col items-center justify-center text-center"
                  style={{ backgroundImage: 'url(/images/paper.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
                    <span className="text-[10px] sm:text-[13px] md:text-[16px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-4">Ingest</span>
                    <h2 className="font-display text-[16px] leading-[20px] sm:text-[24px] sm:leading-[30px] md:text-[34px] md:leading-[40px] text-ink mb-4" style={{ fontWeight: 500 }}>What is this garment?</h2>
                    <p className="text-[11px] leading-[16px] sm:text-[15px] sm:leading-[22px] md:text-[19px] md:leading-[28px] text-ink-muted">Cloud Vision reads the care label. Fibers, origin, category, pulled out in about a second.</p>
                  </div>
                </article>
              </div>
              <div className="aspect-square flex items-center justify-center">
                <Image src="/images/clothing pile.png" alt="Clothing pile" width={300} height={300} className="w-full h-full object-contain scale-[1.3]" />
              </div>
            </div>

            {/* Row 2: Image left, card right (card first on mobile) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="aspect-square order-1 md:order-2">
                <article
                  className="h-full p-[15%] relative flex flex-col items-center justify-center text-center"
                  style={{ backgroundImage: 'url(/images/paper.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
                    <span className="text-[10px] sm:text-[13px] md:text-[16px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-4">Cost</span>
                    <h2 className="font-display text-[16px] leading-[20px] sm:text-[24px] sm:leading-[30px] md:text-[34px] md:leading-[40px] text-ink mb-4" style={{ fontWeight: 500 }}>What did it really take?</h2>
                    <p className="text-[11px] leading-[16px] sm:text-[15px] sm:leading-[22px] md:text-[19px] md:leading-[28px] text-ink-muted">Gemini estimates water, CO₂, and dye pollution using brand-level sustainability data.</p>
                  </div>
                </article>
              </div>
              <div className="aspect-square flex items-center justify-center order-2 md:order-1">
                <Image src="/images/recycle.png" alt="Recycling symbol made of jeans" width={300} height={300} className="w-full h-full object-contain" />
              </div>
            </div>

            {/* Row 3: Card left, image right */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div className="aspect-square">
                <article
                  className="h-full p-[15%] relative flex flex-col items-center justify-center text-center"
                  style={{ backgroundImage: 'url(/images/paper.png)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <div className="w-full h-full flex flex-col items-center justify-center text-center p-6">
                    <span className="text-[10px] sm:text-[13px] md:text-[16px] font-medium tracking-[0.2em] uppercase text-ink-muted mb-4">Route</span>
                    <h2 className="font-display text-[16px] leading-[20px] sm:text-[24px] sm:leading-[30px] md:text-[34px] md:leading-[40px] text-ink mb-4" style={{ fontWeight: 500 }}>Where does it go next?</h2>
                    <p className="text-[11px] leading-[16px] sm:text-[15px] sm:leading-[22px] md:text-[19px] md:leading-[28px] text-ink-muted">Maps finds one repair shop, one resale option, one donation center, all close to you.</p>
                  </div>
                </article>
              </div>
              <div className="aspect-square flex items-center justify-center">
                <Image src="/images/folded clothes.png" alt="Folded clothes" width={300} height={300} className="w-full h-full object-contain" />
              </div>
            </div>

          </div>
        </div>
      </section>

    </main>
  );
}

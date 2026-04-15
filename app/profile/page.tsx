import Image from 'next/image';
import Link from 'next/link';

const MOCK_SCANS = [
  { id: '1', label: "Levi's 501 Jeans", fiber: '100% Cotton', score: 6, date: 'Apr 9', img: '/images/garment.webp' },
  { id: '2', label: 'Patagonia Fleece', fiber: '100% Recycled Polyester', score: 8, date: 'Apr 7', img: '/images/garment.webp' },
  { id: '3', label: 'H&M Basic Tee', fiber: '60% Cotton / 40% Polyester', score: 4, date: 'Apr 3', img: '/images/garment.webp' },
  { id: '4', label: 'Zara Blazer', fiber: '80% Viscose / 20% Polyester', score: 3, date: 'Mar 28', img: '/images/garment.webp' },
  { id: '5', label: 'Nike Hoodie', fiber: '80% Cotton / 20% Polyester', score: 5, date: 'Mar 20', img: '/images/garment.webp' },
];

const STATS = [
  { label: 'Garments Scanned', value: '12' },
  { label: 'Items Rerouted', value: '7' },
  { label: 'CO₂ Offset (lbs)', value: '34' },
  { label: 'Water Saved (gal)', value: '2,400' },
];

const TIERS = [
  { name: 'Thread Rookie', min: 0 },
  { name: 'Label Reader', min: 5 },
  { name: 'Fiber Scout', min: 10 },
  { name: 'Eco Advocate', min: 20 },
  { name: 'Rethread Pro', min: 40 },
];

function getTier(scans: number) {
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (scans >= t.min) tier = t;
  }
  return tier;
}

function getNextTier(scans: number) {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (scans < TIERS[i].min) return TIERS[i];
  }
  return null;
}

function ClosetItem({ label, date, img }: (typeof MOCK_SCANS)[number]) {
  return (
    <div className="relative w-full">
      {/* Garment photo in upper area */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          paddingTop: '8%',
          paddingBottom: '28%',
          paddingLeft: '10%',
          paddingRight: '10%',
        }}
      >
        <Image
          src={img}
          alt={label}
          width={200}
          height={200}
          className="w-full h-full object-contain"
        />
      </div>

      {/* Polaroid frame */}
      <Image
        src="/images/frame.webp"
        alt=""
        width={300}
        height={350}
        className="relative z-10 w-full h-auto"
      />

      {/* Caption — label + date, handwritten feel */}
      <div
        className="absolute left-0 right-0 z-20 text-center"
        style={{ bottom: '6%', paddingLeft: '12%', paddingRight: '12%' }}
      >
        <p
          className="text-[11px] md:text-[12px] font-bold text-ink truncate leading-tight"
          style={{ fontFamily: 'var(--font-handwriting)' }}
        >
          {label}
        </p>
        <p
          className="text-[9px] md:text-[10px] text-ink-muted mt-0.5 leading-tight"
          style={{ fontFamily: 'var(--font-handwriting)' }}
        >
          {date}
        </p>
      </div>
    </div>
  );
}

function AddClosetTile() {
  return (
    <Link
      href="/scan"
      className="relative block w-full group"
      aria-label="Add to Closet"
    >
      {/* Empty slot with dashed + in upper area */}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          paddingTop: '8%',
          paddingBottom: '28%',
          paddingLeft: '10%',
          paddingRight: '10%',
        }}
      >
        <div className="w-full h-full border-2 border-dashed border-ink/25 flex items-center justify-center bg-ink/[0.03] transition-colors group-hover:bg-ink/[0.07]">
          <span className="text-[44px] leading-none font-light text-ink-muted">
            +
          </span>
        </div>
      </div>

      {/* Polaroid frame */}
      <Image
        src="/images/frame.webp"
        alt=""
        width={300}
        height={350}
        className="relative z-10 w-full h-auto"
      />

      {/* Caption */}
      <div
        className="absolute left-0 right-0 z-20 text-center"
        style={{ bottom: '6%', paddingLeft: '12%', paddingRight: '12%' }}
      >
        <p
          className="text-[11px] md:text-[12px] font-bold text-ink truncate leading-tight"
          style={{ fontFamily: 'var(--font-handwriting)' }}
        >
          Add to Closet
        </p>
      </div>
    </Link>
  );
}

function RankBadge({
  currentTier,
  nextTier,
  scanCount,
  progressToNext,
}: {
  currentTier: (typeof TIERS)[number];
  nextTier: (typeof TIERS)[number] | null;
  scanCount: number;
  progressToNext: number;
}) {
  return (
    <div className="relative w-full max-w-[145px] md:max-w-[185px]">
      <Image
        src="/images/rankingframe.webp"
        alt="Ranking frame"
        width={332}
        height={330}
        className="w-full h-auto"
      />
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-[6%]">
        <p className="text-[7px] md:text-[9px] font-bold tracking-[0.16em] uppercase text-ink-muted">Current Tier</p>
        <p className="text-[12px] md:text-[16px] font-black text-ink leading-tight mt-0.5">{currentTier.name}</p>
        {nextTier && (
          <>
            <div className="mt-1 md:mt-1.5 w-[55%] h-0.5 md:h-1 rounded-full bg-black/10">
              <div
                className="h-full rounded-full bg-accent-700"
                style={{ width: `${progressToNext}%` }}
              />
            </div>
            <p className="mt-0.5 md:mt-1 text-[7px] md:text-[8px] text-ink-muted font-medium">
              {scanCount} / {nextTier.min} → {nextTier.name}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const scanCount = 12;
  const currentTier = getTier(scanCount);
  const nextTier = getNextTier(scanCount);
  const progressToNext = nextTier
    ? ((scanCount - currentTier.min) / (nextTier.min - currentTier.min)) * 100
    : 100;

  return (
    <main className="min-h-screen bg-bg py-8">
      <div className="content-width space-y-6">

        {/* ── Profile hero ── */}
        <div className="pt-4">
          {/* Row: pfp + badge — mobile pushes to edges, desktop splits in half and centers each */}
          <div className="grid grid-cols-2 items-center">
            <div className="flex justify-start md:justify-center">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-[90px] h-[90px] md:w-[120px] md:h-[120px] rounded-full overflow-hidden">
                  <Image
                    src="/images/pfphead.webp"
                    alt="Profile photo"
                    width={200}
                    height={200}
                    className="w-full h-full object-cover"
                  />
                </div>
                <h1 className="mt-2 md:mt-3 text-[18px] md:text-[22px] font-bold text-ink">Leona Chen</h1>
                <p className="text-[12px] md:text-[13px] text-ink-muted mt-0.5">
                  @leonac<span className="hidden md:inline"> · Since Apr 2025</span>
                </p>
              </div>
            </div>

            <div className="flex justify-end md:justify-center">
              <RankBadge
                currentTier={currentTier}
                nextTier={nextTier}
                scanCount={scanCount}
                progressToNext={progressToNext}
              />
            </div>
          </div>

          {/* Since — mobile only, below both pfp block and badge */}
          <p className="md:hidden mt-4 text-center text-[12px] text-ink-muted">
            Since Apr 2025
          </p>
        </div>

        {/* ── Stats grid ── */}
        <div
          className="grid grid-cols-2 gap-3 rounded-2xl overflow-hidden p-3"
          style={{
            backgroundImage: 'url(/images/lace.webp)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {STATS.map((s) => (
            <div
              key={s.label}
              className="rounded-xl bg-bg/80 backdrop-blur-sm p-4 flex flex-col gap-1"
            >
              <p className="text-[11px] font-bold tracking-[0.12em] uppercase text-ink-muted">{s.label}</p>
              <p className="text-[28px] font-black text-ink leading-none">{s.value}</p>
            </div>
          ))}
        </div>

        {/* ── My Closet ── */}
        <div>
          <h2 className="text-[13px] font-bold tracking-[0.12em] uppercase text-ink-muted mb-4">My Closet</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6 pb-8">
            <AddClosetTile />
            {MOCK_SCANS.map((scan) => (
              <ClosetItem key={scan.id} {...scan} />
            ))}
          </div>
        </div>

      </div>
    </main>
  );
}

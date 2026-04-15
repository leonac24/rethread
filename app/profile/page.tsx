import Image from 'next/image';
import Link from 'next/link';

const MOCK_SCANS = [
  { id: '1', label: "Levi's 501 Jeans", fiber: '100% Cotton', score: 6, date: 'Apr 9', img: '/images/garment.png' },
  { id: '2', label: 'Patagonia Fleece', fiber: '100% Recycled Polyester', score: 8, date: 'Apr 7', img: '/images/garment.png' },
  { id: '3', label: 'H&M Basic Tee', fiber: '60% Cotton / 40% Polyester', score: 4, date: 'Apr 3', img: '/images/garment.png' },
  { id: '4', label: 'Zara Blazer', fiber: '80% Viscose / 20% Polyester', score: 3, date: 'Mar 28', img: '/images/garment.png' },
  { id: '5', label: 'Nike Hoodie', fiber: '80% Cotton / 20% Polyester', score: 5, date: 'Mar 20', img: '/images/garment.png' },
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

function ScoreDot({ score }: { score: number }) {
  const color = score >= 7 ? '#3f5338' : score >= 4 ? '#b07d2e' : '#a83232';
  const label = score >= 7 ? 'Good' : score >= 4 ? 'Fair' : 'Poor';
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-bold"
      style={{ color }}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: color }} />
      {score}/10 · {label}
    </span>
  );
}

function ClosetItem({ label, fiber, score, date, img }: (typeof MOCK_SCANS)[number]) {
  return (
    <div className="flex flex-col items-center w-full">
      {/* hanger on top */}
      <Image
        src="/images/hanger.png"
        alt=""
        width={140}
        height={80}
        className="w-[135px] h-auto object-contain relative z-10 mb-[-27px]"
      />

      {/* garment card */}
      <div
        className="relative w-full rounded-xl overflow-hidden bg-surface border border-rule"
        style={{ paddingTop: '110%' }}
      >
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <Image
            src={img}
            alt={label}
            width={200}
            height={200}
            className="w-full h-full object-contain"
          />
        </div>
      </div>

      {/* metadata below */}
      <div className="mt-2 w-full text-center px-1">
        <p className="text-[13px] font-bold text-ink leading-tight truncate">{label}</p>
        <p className="text-[11px] text-ink-muted mt-0.5 leading-tight line-clamp-2">{fiber}</p>
        <div className="mt-1">
          <ScoreDot score={score} />
        </div>
        <p className="text-[10px] text-ink-faint mt-0.5 font-medium">{date}</p>
      </div>
    </div>
  );
}

function AddClosetTile() {
  return (
    <Link
      href="/scan"
      className="flex flex-col items-center w-full group"
      aria-label="Add to Closet"
    >
      {/* hanger on top — matches ClosetItem structure exactly */}
      <Image
        src="/images/hanger.png"
        alt=""
        width={140}
        height={80}
        className="w-[135px] h-auto object-contain relative z-10 mb-[-27px] opacity-60"
      />

      {/* card area — dashed "empty slot" with + and label */}
      <div
        className="relative w-full rounded-xl overflow-hidden bg-ink/5 border-2 border-dashed border-rule transition-colors group-hover:bg-ink/10"
        style={{ paddingTop: '110%' }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="text-[52px] leading-none font-light text-ink-muted">+</span>
          <span className="text-[12px] font-bold tracking-[0.08em] uppercase text-ink-muted">
            Add to Closet
          </span>
        </div>
      </div>

      {/* invisible metadata placeholder so total tile height matches ClosetItem */}
      <div className="mt-2 w-full text-center px-1 invisible" aria-hidden>
        <p className="text-[13px] font-bold leading-tight">&nbsp;</p>
        <p className="text-[11px] mt-0.5 leading-tight">
          &nbsp;
          <br />
          &nbsp;
        </p>
        <p className="text-[11px] mt-1">&nbsp;</p>
        <p className="text-[10px] mt-0.5">&nbsp;</p>
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
        src="/images/rankingframe.png"
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
                    src="/images/pfphead.jpg"
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
            backgroundImage: 'url(/images/lace.jpg)',
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

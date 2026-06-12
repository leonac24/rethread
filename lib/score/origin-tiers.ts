// Manufacturing-origin tiers by grid carbon intensity of textile-producing
// countries (proxy for production energy mix). Tier 1 = cleanest.
export type OriginTier = 1 | 2 | 3;

const TIER_1 = ['portugal', 'france', 'italy', 'spain', 'united kingdom', 'uk', 'sweden', 'canada', 'brazil', 'germany', 'austria', 'switzerland'];
const TIER_2 = ['turkey', 'usa', 'united states', 'mexico', 'japan', 'south korea', 'taiwan', 'thailand', 'sri lanka', 'tunisia', 'morocco', 'romania', 'egypt', 'jordan', 'peru', 'colombia', 'guatemala', 'honduras', 'dominican republic', 'madagascar', 'kenya', 'ethiopia'];
const TIER_3 = ['china', 'india', 'bangladesh', 'vietnam', 'pakistan', 'indonesia', 'cambodia', 'myanmar', 'south africa', 'philippines', 'laos'];

export function originTier(origin: string | null | undefined): OriginTier | null {
  if (!origin) return null;
  const o = origin.toLowerCase().trim();
  if (TIER_1.some((c) => o.includes(c))) return 1;
  if (TIER_2.some((c) => o.includes(c))) return 2;
  if (TIER_3.some((c) => o.includes(c))) return 3;
  return null; // unknown country — don't guess
}

export function originScore(origin: string | null | undefined): number | null {
  const tier = originTier(origin);
  if (tier === null) return null;
  return tier === 1 ? 85 : tier === 2 ? 60 : 35;
}

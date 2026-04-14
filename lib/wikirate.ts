// WikiRate — Fashion Transparency Index lookup
// Fetches a brand's annual FTI score (0–100) from WikiRate's open ESG database.
// Requires WIKIRATE_API_KEY env var (free registration at wikirate.org).

import { log } from '@/lib/logger';

export type WikiRateResult = {
  score: number;        // 0–100
  year: number;
  brand: string;
};

type WikiRateAnswer = {
  value?: number | string;
  answer?: number | string;
  numeric?: number | string;
  year?: number;
  company?: string;
  company_name?: string;
};


// Normalize brand name for WikiRate lookup:
// strip common suffixes, handle known aliases
const BRAND_ALIASES: Record<string, string> = {
  'h&m': 'H&M Group',
  'hm': 'H&M Group',
  'zara': 'Inditex',
  'inditex': 'Inditex',
  'pull&bear': 'Inditex',
  'massimo dutti': 'Inditex',
  'bershka': 'Inditex',
  'nike': 'Nike',
  'adidas': 'Adidas',
  'gap': 'Gap Inc.',
  'old navy': 'Gap Inc.',
  'banana republic': 'Gap Inc.',
  'puma': 'Puma',
  'levi\'s': 'Levi Strauss & Co.',
  'levis': 'Levi Strauss & Co.',
  'levi strauss': 'Levi Strauss & Co.',
  'patagonia': 'Patagonia',
  'uniqlo': 'Fast Retailing',
  'fast retailing': 'Fast Retailing',
  'primark': 'Primark',
  'marks & spencer': 'Marks and Spencer Group plc',
  'm&s': 'Marks and Spencer Group plc',
  'burberry': 'Burberry',
  'ralph lauren': 'Ralph Lauren',
  'tommy hilfiger': 'PVH Corp.',
  'calvin klein': 'PVH Corp.',
  'pvh': 'PVH Corp.',
  'under armour': 'Under Armour',
  'guess': 'Guess',
  'vf corporation': 'VF Corporation',
  'timberland': 'VF Corporation',
  'the north face': 'VF Corporation',
  'dickies': 'VF Corporation',
  'wrangler': 'Kontoor Brands',
  'lee': 'Kontoor Brands',
  'columbia': 'Columbia Sportswear',
  'hugo boss': 'Hugo Boss',
  'boss': 'Hugo Boss',
  'esprit': 'Esprit',
  'next': 'Next plc',
  'boohoo': 'Boohoo Group',
  'asos': 'ASOS',
  'shein': 'SHEIN',
  'mango': 'Mango',
  'c&a': 'C&A',
  'reserved': 'LPP',
  'lpp': 'LPP',
};

function resolveCompanyName(brand: string): string {
  const lower = brand.trim().toLowerCase();
  return BRAND_ALIASES[lower] ?? brand.trim();
}

// In-memory cache — avoid redundant API calls within a process lifetime
const cache = new Map<string, { result: WikiRateResult | null; cachedAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function getFashionTransparencyScore(
  brand: string,
): Promise<WikiRateResult | null> {
  if (!brand?.trim()) return null;

  const apiKey = process.env.WIKIRATE_API_KEY;
  if (!apiKey) {
    log.warn('WIKIRATE_API_KEY not set — skipping FTI lookup', { stage: 'cost' });
    return null;
  }

  const companyName = resolveCompanyName(brand);
  const cacheKey = companyName.toLowerCase();

  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.result;
  }

  // Try the current year first, fall back one year
  const currentYear = new Date().getFullYear();
  const years = [currentYear - 1, currentYear - 2];

  for (const year of years) {
    try {
      const url = new URL('https://wikirate.org/answers.json');
      url.searchParams.set('metric_designer', 'Fashion_Revolution');
      url.searchParams.set('metric_name', 'Fashion_Transparency_Index');
      url.searchParams.set('company_name', companyName);
      url.searchParams.set('year', String(year));
      url.searchParams.set('limit', '1');

      const response = await fetch(url.toString(), {
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        log.warn('WikiRate request failed', { stage: 'cost', status: response.status, year });
        continue;
      }

      const raw = await response.json();
      log.info('WikiRate raw response', { stage: 'cost', brand: companyName, year, raw: JSON.stringify(raw).slice(0, 500) });

      // API may return an array directly or { items: [...] }
      const items: WikiRateAnswer[] = Array.isArray(raw)
        ? (raw as WikiRateAnswer[])
        : Array.isArray((raw as { items?: WikiRateAnswer[] }).items)
          ? ((raw as { items: WikiRateAnswer[] }).items)
          : [];

      const item = items[0];
      if (!item) continue;

      const rawValue = item.value ?? item.answer ?? item.numeric;
      const score = typeof rawValue === 'number'
        ? rawValue
        : parseFloat(String(rawValue ?? ''));

      if (isNaN(score)) continue;

      const result: WikiRateResult = {
        score: Math.round(score),
        year: item.year ?? year,
        brand: companyName,
      };

      cache.set(cacheKey, { result, cachedAt: Date.now() });
      log.info('WikiRate FTI score fetched', { stage: 'cost', brand: companyName, score, year });
      return result;
    } catch (err) {
      log.warn('WikiRate fetch error', { stage: 'cost', brand: companyName, year, err: String(err) });
    }
  }

  // Cache negative result so we don't hammer the API for unknown brands
  cache.set(cacheKey, { result: null, cachedAt: Date.now() });
  return null;
}

// Format the FTI result as a human-readable context string for Gemini
export function formatFtiContext(fti: WikiRateResult): string {
  const tier =
    fti.score >= 61 ? 'high transparency'
    : fti.score >= 41 ? 'moderate transparency'
    : fti.score >= 21 ? 'low transparency'
    : 'very low transparency';

  return `Fashion Transparency Index ${fti.year}: ${fti.brand} scored ${fti.score}/100 (${tier}). ` +
    `This score reflects public disclosure of supply chain, environmental policies, and labor practices.`;
}

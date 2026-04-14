// WikiRate — Fashion Transparency Index lookup
// Fetches a brand's annual FTI score (0–100) from WikiRate's open ESG database.
// Requires WIKIRATE_API_KEY env var (free registration at wikirate.org).

import { log } from '@/lib/logger';

export type WikiRateResult = {
  score: number;        // 0–100
  year: number;
  brand: string;
  url: string;
};

type WikiRateAnswer = {
  value?: number | string;
  answer?: number | string;
  numeric?: number | string;
  year?: number;
  company?: string;
  html_url?: string;
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
  'new balance': 'New Balance',
  'bnew balance': 'New Balance',
  'hollister': 'Abercrombie & Fitch Co.',
  'abercrombie': 'Abercrombie & Fitch Co.',
  'abercrombie & fitch': 'Abercrombie & Fitch Co.',
  'american eagle': 'American Eagle Outfitters',
  'forever 21': 'Forever 21',
  'urban outfitters': 'Urban Outfitters',
  'free people': 'Urban Outfitters',
  'anthropologie': 'Urban Outfitters',
  'j.crew': 'J.Crew',
  'j crew': 'J.Crew',
  'target': 'Target Corporation',
  'walmart': 'Walmart',
  'george': 'Walmart',
  'champion': 'HanesBrands',
  'hanes': 'HanesBrands',
  'fruit of the loom': 'Fruit of the Loom',
  'reebok': 'Reebok',
  'fila': 'Fila',
  'asics': 'ASICS',
  'skechers': 'Skechers',
  'converse': 'Nike',
  'jordan': 'Nike',
  'vans': 'VF Corporation',
  'supreme': 'Supreme',
  'north face': 'VF Corporation',
  'carhartt': 'Carhartt',
  'dockers': 'Levi Strauss & Co.',
  'tommy': 'PVH Corp.',
  'versace': 'Capri Holdings',
  'michael kors': 'Capri Holdings',
  'jimmy choo': 'Capri Holdings',
  'coach': 'Tapestry',
  'kate spade': 'Tapestry',
  'lacoste': 'Lacoste',
  'fred perry': 'Fred Perry',
  'superdry': 'Superdry',
  'jack & jones': 'Bestseller',
  'vero moda': 'Bestseller',
  'only': 'Bestseller',
  'bestseller': 'Bestseller',
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

  // Encode company name for URL: spaces → underscores, & → %26
  const companySlug = companyName.replace(/\s+/g, '_').replace(/&/g, '%26');

  for (const year of years) {
    try {
      // Direct card endpoint — fetches exactly this company+metric+year, no filter ambiguity
      const endpointUrl = `https://wikirate.org/Fashion_Revolution+Fashion_Transparency_Index+${companySlug}+${year}.json`;

      const response = await fetch(endpointUrl, {
        headers: {
          'X-API-Key': apiKey,
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (response.status === 404) {
        // This company/year combo isn't in WikiRate — try next year
        log.info('WikiRate: no FTI record', { stage: 'cost', brand: companyName, year });
        continue;
      }

      if (!response.ok) {
        log.warn('WikiRate request failed', { stage: 'cost', status: response.status, year });
        continue;
      }

      const raw = await response.json() as WikiRateAnswer;
      log.info('WikiRate raw response', { stage: 'cost', brand: companyName, year, raw: JSON.stringify(raw).slice(0, 500) });

      const rawValue = raw.value ?? raw.answer ?? raw.numeric;
      const score = typeof rawValue === 'number'
        ? rawValue
        : parseFloat(String(rawValue ?? ''));

      if (isNaN(score)) continue;

      const resolvedYear = raw.year ?? year;
      const html_url = typeof raw.html_url === 'string' && raw.html_url.startsWith('http')
        ? raw.html_url
        : `https://wikirate.org/Fashion_Revolution+Fashion_Transparency_Index+${companySlug}+${resolvedYear}`;

      const result: WikiRateResult = {
        score: Math.round(score),
        year: resolvedYear,
        brand: companyName,
        url: html_url,
      };

      cache.set(cacheKey, { result, cachedAt: Date.now() });
      log.info('WikiRate FTI score fetched', { stage: 'cost', brand: companyName, score, year, url: result.url });
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

import type { EnvironmentalCost, Garment, GarmentCondition, LandfillImpact, ResaleEstimate } from '@/types/garment';
import { log } from '@/lib/logger';
import { GEMINI_TIMEOUT_MS } from '@/lib/config';
import { withRetry, HttpError } from '@/lib/retry';
import { computeFiberImpact } from '@/lib/fiber-impact';

// Gemini — structured environmental-cost reasoning + garment image analysis.
// Enforce responseSchema so output always matches expected types.

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

// Sanitize user-controlled strings before embedding in prompts.
// Strips newlines and characters that could be used for prompt injection.
function sanitizeForPrompt(s: string | undefined, max = 100): string {
  if (!s) return '';
  return s
    .replace(/[\n\r]/g, ' ')
    .replace(/[^\w\s\-.,()]/g, '')
    .slice(0, max)
    .trim();
}

// Sanitize Gemini-generated text before storing or displaying.
function sanitizeResponseText(s: string, maxLen = 200): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, maxLen)
    .trim();
}

function buildPrompt(garment: Garment, brandContext?: string) {
  const safeGarment = {
    fibers: garment.fibers.map((f) => ({
      material: sanitizeForPrompt(f.material),
      percentage: f.percentage,
    })),
    origin: sanitizeForPrompt(garment.origin ?? undefined),
    category: sanitizeForPrompt(garment.category ?? undefined),
    brand: sanitizeForPrompt(garment.brand),
    color: sanitizeForPrompt(garment.color),
  };

  return [
    'You are a textile dye and pollution analyst.',
    'Water and CO2 figures have already been calculated from a lookup table — do NOT estimate them.',
    'Your job is to assess dye pollution risk and write a brief environmental summary.',
    'Focus on: fiber blend + color + origin country + brand transparency.',
    'Keep reasoning under 80 words. Return only valid JSON matching schema.',
    '',
    '--- GARMENT DATA (user-provided) ---',
    JSON.stringify(safeGarment),
    '--- END GARMENT DATA ---',
    '',
    brandContext ? `Brand context: ${sanitizeForPrompt(brandContext, 500)}` : 'Brand context: none',
    '',
    'Scoring guidance for dye_pollution_score (1–10):',
    '- Synthetic dyes (reactive, disperse, acid) on synthetic or blended fibers: higher risk (6–9)',
    '- Natural or low-impact dyes on natural fibers: lower risk (1–4)',
    '- Mixed fibers often require multiple dye types: moderate–high risk',
    '- Weak wastewater controls in origin country increase risk',
    '- High brand transparency score (>60) may indicate better dye practices',
    '',
    'If a color is present in the garment data, identify the most likely dye family used to achieve it',
    '(e.g. "synthetic reactive dye", "vat dye", "acid dye", "natural indigo", "disperse dye") and',
    'include reasoning about its environmental impact in dye_type and dye_reasoning.',
    'If no color is present, omit dye_type and dye_reasoning.',
    '',
    'Also estimate the environmental impact if this garment is discarded:',
    '- disposal_co2_kg: CO2 released via landfill decomposition or incineration (number)',
    '- disposal_landfill_years: estimated years to decompose in landfill (integer)',
    '- disposal_note: one sentence summarising disposal impact, max 40 words',
    '',
    'Also estimate the resale payout a thrift/consignment store would PAY THE OWNER for this garment, in USD:',
    '- Thrift stores pay roughly 20-30% of what they can resell the item for.',
    '- BE ULTRACONSERVATIVE: round DOWN, and when brand, condition, or category is uncertain, go lower.',
    '- A disappointing-low estimate is fine; an optimistic-high estimate is a failure.',
    '- resale_low_usd / resale_high_usd: integers, low >= 1. Keep the range tight (high <= 2x low).',
    '- resale_factors: 2-4 short phrases (max 8 words each) a shopper would understand,',
    '  e.g. "denim resells strongly", "fast-fashion brand limits payout", "good condition".',
    '',
    'Set confidence based on how much information is available:',
    '- high: fiber blend + color + origin all known',
    '- medium: some fields missing',
    '- low: most fields unknown',
  ].join('\n');
}

type DyeAnalysis = {
  dye_pollution_score: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  dye_type?: string;
  dye_reasoning?: string;
  disposal_co2_kg: number;
  disposal_landfill_years: number;
  disposal_note: string;
};

function normalizeDyeAnalysis(value: unknown): DyeAnalysis {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini response is not an object.');
  }

  const candidate = value as Partial<DyeAnalysis>;
  const confidence = candidate.confidence;

  if (
    typeof candidate.dye_pollution_score !== 'number' ||
    typeof candidate.reasoning !== 'string' ||
    !confidence ||
    !['high', 'medium', 'low'].includes(confidence) ||
    typeof candidate.disposal_co2_kg !== 'number' ||
    typeof candidate.disposal_landfill_years !== 'number' ||
    typeof candidate.disposal_note !== 'string'
  ) {
    throw new Error('Gemini response does not match dye analysis schema.');
  }

  return {
    dye_pollution_score: Math.max(1, Math.min(10, Math.round(candidate.dye_pollution_score))),
    confidence,
    reasoning: sanitizeResponseText(candidate.reasoning.trim(), 600),
    ...(candidate.dye_type ? { dye_type: sanitizeResponseText(candidate.dye_type.trim(), 100) } : {}),
    ...(candidate.dye_reasoning ? { dye_reasoning: sanitizeResponseText(candidate.dye_reasoning.trim(), 600) } : {}),
    disposal_co2_kg: Math.max(0, Number(candidate.disposal_co2_kg.toFixed(2))),
    disposal_landfill_years: Math.max(0, Math.round(candidate.disposal_landfill_years)),
    disposal_note: sanitizeResponseText(candidate.disposal_note.trim(), 200),
  };
}

// Normalize the resale payout estimate from a Gemini response.
// Returns null rather than throwing — resale is an optional enrichment,
// never a reason to fail the whole cost computation.
export function normalizeResaleEstimate(value: unknown): ResaleEstimate | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.low_usd !== 'number' || typeof candidate.high_usd !== 'number') return null;

  const low = Math.max(1, Math.floor(candidate.low_usd));
  const high = Math.max(low, Math.floor(candidate.high_usd));

  const confidence =
    typeof candidate.confidence === 'string' && ['high', 'medium', 'low'].includes(candidate.confidence)
      ? (candidate.confidence as ResaleEstimate['confidence'])
      : 'low';

  const factors = (Array.isArray(candidate.factors) ? candidate.factors : [])
    .filter((f): f is string => typeof f === 'string')
    .map((f) => sanitizeResponseText(f, 80))
    .filter((f) => f.length > 0)
    .slice(0, 4);

  return { low_usd: low, high_usd: high, confidence, factors };
}

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  return apiKey;
}

function geminiHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

export async function computeCost(
  garment: Garment,
  brandContext?: string,
): Promise<EnvironmentalCost> {
  // Water and CO2 come from the fiber lookup table — real LCA data, not AI estimates.
  const { water_liters, co2_kg, coverage } = computeFiberImpact(garment.fibers, garment.category);
  log.info('Fiber impact calculated', {
    stage: 'cost',
    fibers: garment.fibers.map((f) => `${f.percentage}% ${f.material}`).join(', '),
    category: garment.category ?? 'unknown',
    water_liters,
    co2_kg,
    coverage_pct: Math.round(coverage * 100),
  });

  // Gemini handles only dye pollution scoring and reasoning.
  const apiKey = getApiKey();
  const prompt = buildPrompt(garment, brandContext);
  const hasDyeFields = !!garment.color;

  const data = await withRetry(async () => {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['dye_pollution_score', 'confidence', 'reasoning', 'disposal_co2_kg', 'disposal_landfill_years', 'disposal_note', 'resale_low_usd', 'resale_high_usd', 'resale_factors'],
            properties: {
              dye_pollution_score: { type: 'NUMBER' },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              reasoning: { type: 'STRING' },
              disposal_co2_kg: { type: 'NUMBER' },
              disposal_landfill_years: { type: 'NUMBER' },
              disposal_note: { type: 'STRING' },
              resale_low_usd: { type: 'NUMBER' },
              resale_high_usd: { type: 'NUMBER' },
              resale_factors: { type: 'ARRAY', items: { type: 'STRING' } },
              ...(hasDyeFields
                ? {
                    dye_type: { type: 'STRING' },
                    dye_reasoning: { type: 'STRING' },
                  }
                : {}),
            },
          },
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      log.error('Gemini cost request failed', undefined, { stage: 'cost', status: response.status });
      throw new HttpError(response.status, `Gemini request failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<GeminiResponse>;
  }, { retries: 3, label: 'Gemini' });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON content: ${rawText}`);
  }

  const dye = normalizeDyeAnalysis(parsed);

  // Resale estimate is schema-required, but normalize defensively — a bad
  // resale block should never sink the rest of the cost result.
  const raw = parsed as Record<string, unknown>;
  const resale = normalizeResaleEstimate({
    low_usd: raw.resale_low_usd,
    high_usd: raw.resale_high_usd,
    confidence: dye.confidence,
    factors: raw.resale_factors,
  });

  return {
    water_liters,
    co2_kg,
    ...dye,
    ...(resale ? { resale } : {}),
  };
}

export type GarmentImageAnalysis = {
  category: string | null;
  color: string | null;
  condition: GarmentCondition | null;
};

export async function computeLandfillImpact(garment: Garment): Promise<LandfillImpact> {
  const apiKey = getApiKey();

  const fiberList = garment.fibers.length
    ? garment.fibers.map((f) => `${f.percentage}% ${f.material}`).join(', ')
    : 'unknown composition';

  const prompt = [
    'You are an environmental scientist specializing in textile waste.',
    `A garment made of ${fiberList}${garment.category ? ` (${garment.category})` : ''}${garment.origin ? `, manufactured in ${garment.origin},` : ''} is about to be thrown in the trash and sent to landfill.`,
    'Write a factual, fiber-specific analysis of the environmental damage this causes.',
    'Cover exactly four areas:',
    '1. microplastics — which fibers shed microplastics, how they leach into soil and groundwater',
    '2. methane — decomposition timeline and methane/greenhouse gas output from organic fibers',
    '3. dye_runoff — toxic dye and chemical runoff from this specific fiber blend and likely dye types into soil and water',
    '4. breakdown_years — realistic range of years for this specific fiber blend to break down in landfill',
    'Also write a one-sentence summary of the overall landfill impact (under 40 words).',
    'STRICT: microplastics, methane, dye_runoff, and breakdown_years must each be under 100 characters. Write complete short sentences — do not exceed the limit.',
    'Be specific to the fiber blend. breakdown_years should be a short string like "200–500 years" or "20–30 years".',
    'Return only valid JSON matching the schema.',
  ].join(' ');

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['summary', 'microplastics', 'methane', 'dye_runoff', 'breakdown_years'],
            properties: {
              summary: { type: 'STRING' },
              microplastics: { type: 'STRING' },
              methane: { type: 'STRING' },
              dye_runoff: { type: 'STRING' },
              breakdown_years: { type: 'STRING' },
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini landfill impact failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content for landfill impact.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON for landfill impact: ${rawText}`);
  }

  const r = parsed as Record<string, unknown>;
  return {
    summary: String(r.summary ?? ''),
    microplastics: String(r.microplastics ?? ''),
    methane: String(r.methane ?? ''),
    dye_runoff: String(r.dye_runoff ?? ''),
    breakdown_years: String(r.breakdown_years ?? ''),
  };
}

export type LabelParseResult = {
  brand: string | null;
  fibers: Array<{ material: string; percentage: number }>;
  origin: string | null;
  category: string | null;
};

export async function parseLabelWithGemini(ocrText: string): Promise<LabelParseResult> {
  const apiKey = getApiKey();

  const prompt = [
    'You are an expert clothing label parser. Extract structured garment data from raw OCR text.',
    'The OCR text may be messy — apply all of the following corrections and rules carefully.',
    '',
    '## OCR NOISE & ARTIFACTS',
    '- Trademark/copyright symbols are often misread: ® → "B", "R", or "®"; © → "C"; ™ → "TM" or "M".',
    '  Strip these from brand names (e.g. "BNEW BALANCE" → "New Balance", "RNIKE" → "Nike").',
    '- Characters may be merged with no space (e.g. "3%ELASTANE" → 3% elastane).',
    '- Letters may be OCR-swapped: 0/O, 1/I/l, 5/S, 8/B, etc. Use context to correct.',
    '- Garbled or unreadable segments should be ignored rather than guessed.',
    '',
    '## BRAND',
    '- Find the brand/manufacturer name. It is usually prominent, near the top, and not part of care or composition text.',
    '- Correct OCR artifacts as described above.',
    '- Ignore distributor lines like "Distributed by", "Imported by", "Exclusively for".',
    '- If multiple brand names appear, prefer the most prominent or first one.',
    '- Return null if no brand can be confidently identified.',
    '',
    '## FIBER COMPOSITION',
    '- Extract fibers as { material, percentage } pairs. Percentages must sum to 100.',
    '- Use canonical English fiber names: "cotton", "polyester", "elastane", "nylon", "wool",',
    '  "viscose", "linen", "silk", "acrylic", "modal", "lyocell", "cashmere", "down", "hemp", "spandex".',
    '- Translate non-English fiber names to English:',
    '  French: coton→cotton, polyester, laine→wool, soie→silk, lin→linen, viscose, élasthanne→elastane',
    '  Spanish: algodón→cotton, lana→wool, seda→silk, lino→linen, poliéster→polyester',
    '  Italian: cotone→cotton, lana→wool, seta→silk, lino→linen, poliestere→polyester',
    '  German: Baumwolle→cotton, Wolle→wool, Seide→silk, Leinen→linen, Polyester',
    '- Recognize ISO fiber abbreviations: CO→cotton, PES→polyester, WO→wool, PA→nylon,',
    '  EL→elastane, VI→viscose, LI→linen, SE→silk, CV→viscose, CLY→lyocell, CMD→modal',
    '- If the label has multiple sections (e.g. SHELL, BODY, LINING, TRIM, FILL, EXCLUSIVE OF DECORATION),',
    '  use ONLY the primary/largest section (usually labeled SHELL or BODY, or the first section listed).',
    '  Ignore secondary sections entirely — do not mix fibers from different sections.',
    '- "Exclusive of decoration/ornamentation/trim" is boilerplate — ignore it.',
    '- If percentages do not sum to 100 due to OCR error, scale them proportionally.',
    '- Decimal percentages (e.g. 98.5%) should be rounded to the nearest integer.',
    '- Do not confuse washing temperatures (30, 40, 60) or garment weights (200gsm) with fiber percentages.',
    '',
    '## ORIGIN',
    '- Find the country of manufacture. Look for: "Made in X", "Fabricado en X", "Fabriqué en X",',
    '  "Fatto in X", "Hergestellt in X", "Made in X", or just a country name near those phrases.',
    '- Translate to English (e.g. "États-Unis"→"USA", "Deutschland"→"Germany", "Chine"→"China").',
    '- Return the country name only (e.g. "China", "USA", "Bangladesh"), not the full phrase.',
    '- Return null if not found.',
    '',
    '## CATEGORY',
    '- Infer the garment type from any descriptive text, style names, or context clues.',
    '- Use one of: "t-shirt", "shirt", "blouse", "jeans", "pants", "shorts", "skirt", "dress",',
    '  "jacket", "coat", "hoodie", "sweater", "leggings", "socks", "underwear", "bra", "shoes".',
    '- Return null if the category cannot be confidently determined.',
    '',
    '## RULES',
    '- Never invent data not present or strongly implied by the text.',
    '- Return null for any field you cannot confidently extract.',
    '- Return only valid JSON matching the schema.',
    '',
    '--- RAW OCR TEXT ---',
    ocrText.slice(0, 2000),
    '--- END OCR TEXT ---',
  ].join('\n');

  const data = await withRetry(async () => {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['brand', 'fibers', 'origin', 'category'],
            properties: {
              brand:    { type: 'STRING', nullable: true },
              origin:   { type: 'STRING', nullable: true },
              category: { type: 'STRING', nullable: true },
              fibers: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  required: ['material', 'percentage'],
                  properties: {
                    material:   { type: 'STRING' },
                    percentage: { type: 'NUMBER' },
                  },
                },
              },
            },
          },
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new HttpError(response.status, `Gemini label parse failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<GeminiResponse>;
  }, { retries: 2, label: 'Gemini label parse' });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content for label parse.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON for label parse: ${rawText}`);
  }

  const r = parsed as Record<string, unknown>;

  const rawFibers = Array.isArray(r.fibers) ? r.fibers : [];
  const fibers = rawFibers
    .filter((f): f is { material: string; percentage: number } =>
      f && typeof f.material === 'string' && typeof f.percentage === 'number'
    )
    .map((f) => ({
      material: f.material.toLowerCase().trim(),
      percentage: Math.max(0, Math.min(100, Math.round(f.percentage))),
    }));

  // Normalize percentages to sum to 100 if Gemini didn't
  const total = fibers.reduce((s, f) => s + f.percentage, 0);
  if (total > 0 && total !== 100) {
    for (const f of fibers) f.percentage = Math.round((f.percentage / total) * 100);
  }

  return {
    brand:    typeof r.brand === 'string' && r.brand ? r.brand.trim() : null,
    origin:   typeof r.origin === 'string' && r.origin ? r.origin.trim() : null,
    category: typeof r.category === 'string' && r.category ? r.category.trim() : null,
    fibers,
  };
}

export type ResaleEvaluation = {
  brand: string | null;
  category: string | null;
  color: string | null;
  condition: GarmentCondition | null;
  resale: ResaleEstimate | null;
};

// Full image-based resale appraisal for the listing flow. Unlike the scan-time
// estimate (text-only, OCR-derived), this sees the actual photos — so brand
// labels, logos, and true condition inform the payout. A Miu Miu polo should
// price like Miu Miu, not like an unknown-brand polo.
export async function evaluateResaleFromImages(
  images: Array<{ mimeType: string; data: string }>,
  garment?: Garment | null,
): Promise<ResaleEvaluation> {
  const apiKey = getApiKey();

  const knownContext = garment
    ? JSON.stringify({
        brand: sanitizeForPrompt(garment.brand),
        category: sanitizeForPrompt(garment.category ?? undefined),
        color: sanitizeForPrompt(garment.color),
        condition: garment.condition ?? null,
        fibers: garment.fibers.map((f) => ({
          material: sanitizeForPrompt(f.material),
          percentage: f.percentage,
        })),
      })
    : 'none';

  const prompt = [
    'You are an expert secondhand-clothing appraiser for a resale marketplace.',
    'Examine the attached photos of a garment (and its care/brand labels, if shown) and do a full appraisal.',
    '',
    '## IDENTIFY',
    '- brand: read brand names from labels, tags, logos, or embroidery. Recognize designer and',
    '  luxury houses (e.g. Miu Miu, Prada, Gucci, Ralph Lauren) as readily as mass-market brands.',
    '  Return null only if no brand is visible or inferable.',
    '- category: garment type (e.g. "polo", "jeans", "dress", "jacket").',
    '- color: dominant color as a descriptive name.',
    '- condition: visible wear — "poor" | "fair" | "good" | "excellent".',
    '',
    '## PRICE (resale payout, USD)',
    'Estimate what a resale/consignment store would PAY THE OWNER for this garment:',
    '- Mass-market and fast-fashion brands: stores pay roughly 20-30% of their resale price.',
    '- Designer and luxury brands hold real value: consignment payouts run 30-40% of realistic',
    '  secondhand resale value. Do NOT lowball a recognized designer item to thrift prices —',
    '  a $300-retail luxury polo in good condition should not be valued at $1-2.',
    '- Within the right bracket, stay conservative: round DOWN and prefer the low end when',
    '  brand authenticity or condition is unclear from the photos.',
    '- resale_low_usd / resale_high_usd: integers, low >= 1, keep the range tight (high <= 2x low).',
    '- resale_factors: 2-4 short phrases a shopper would understand,',
    '  e.g. "Miu Miu resells strongly", "light wear on collar", "polos are steady sellers".',
    '',
    'Set confidence: high (brand label clearly readable + condition visible), medium (partial), low (guessing).',
    '',
    '--- PREVIOUSLY SCANNED DATA (may be incomplete or wrong; trust the photos over it) ---',
    knownContext,
    '--- END SCANNED DATA ---',
    '',
    'Return only valid JSON matching the schema.',
  ].join('\n');

  const data = await withRetry(async () => {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.data } })),
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['brand', 'category', 'color', 'condition', 'confidence', 'resale_low_usd', 'resale_high_usd', 'resale_factors'],
            properties: {
              brand: { type: 'STRING', nullable: true },
              category: { type: 'STRING', nullable: true },
              color: { type: 'STRING', nullable: true },
              condition: { type: 'STRING', enum: ['poor', 'fair', 'good', 'excellent'], nullable: true },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              resale_low_usd: { type: 'NUMBER' },
              resale_high_usd: { type: 'NUMBER' },
              resale_factors: { type: 'ARRAY', items: { type: 'STRING' } },
            },
          },
        },
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      log.error('Gemini resale evaluation failed', undefined, { stage: 'evaluate', status: response.status });
      throw new HttpError(response.status, `Gemini resale evaluation failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<GeminiResponse>;
  }, { retries: 2, label: 'Gemini-evaluate' });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content for resale evaluation.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON for resale evaluation: ${rawText}`);
  }

  const r = parsed as Record<string, unknown>;
  const VALID_CONDITIONS = new Set<string>(['poor', 'fair', 'good', 'excellent']);

  const resale = normalizeResaleEstimate({
    low_usd: r.resale_low_usd,
    high_usd: r.resale_high_usd,
    confidence: r.confidence,
    factors: r.resale_factors,
  });

  return {
    brand: typeof r.brand === 'string' && r.brand ? sanitizeResponseText(r.brand.trim(), 80) : null,
    category: typeof r.category === 'string' && r.category ? sanitizeResponseText(r.category.trim(), 60) : null,
    color: typeof r.color === 'string' && r.color ? sanitizeResponseText(r.color.trim(), 60) : null,
    condition:
      typeof r.condition === 'string' && VALID_CONDITIONS.has(r.condition)
        ? (r.condition as GarmentCondition)
        : null,
    resale,
  };
}

export async function analyzeGarmentImage(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
): Promise<GarmentImageAnalysis> {
  const apiKey = getApiKey();

  const base64Image = imageBuffer.toString('base64');

  const prompt = [
    'Analyze this clothing item image.',
    'Identify the garment category (e.g. "shirt", "pants", "dress", "jacket", "shoes", "shorts", "skirt", "sweater", "coat").',
    'Identify the dominant color as a descriptive name (e.g. "navy blue", "burgundy", "off-white", "forest green").',
    'Assess the visible wear condition: "poor" (significant damage, stains, or tears), "fair" (minor wear or fading), "good" (lightly used), "excellent" (like new).',
    'Return only valid JSON matching the schema.',
  ].join(' ');

  const data = await withRetry(async () => {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: base64Image } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: ['category', 'color', 'condition'],
            properties: {
              category: { type: 'STRING' },
              color: { type: 'STRING' },
              condition: { type: 'STRING', enum: ['poor', 'fair', 'good', 'excellent'] },
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      log.error('Gemini image analysis failed', undefined, { stage: 'ingest', status: response.status });
      throw new HttpError(response.status, `Gemini image analysis failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<GeminiResponse>;
  }, { retries: 3, label: 'Gemini-image' });
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content for image analysis.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON for image analysis: ${rawText}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini image analysis response is not an object.');
  }

  const VALID_CONDITIONS = new Set<string>(['poor', 'fair', 'good', 'excellent']);
  const result = parsed as Record<string, unknown>;
  return {
    category: typeof result.category === 'string' && result.category ? result.category : null,
    color: typeof result.color === 'string' && result.color ? result.color : null,
    condition:
      typeof result.condition === 'string' && VALID_CONDITIONS.has(result.condition)
        ? (result.condition as GarmentCondition)
        : null,
  };
}

import type { EnvironmentalCost, Fiber, Garment, GarmentCondition, LandfillImpact, ResaleEstimate } from '@/types/garment';
import { log } from '@/lib/logger';
import { GEMINI_TIMEOUT_MS } from '@/lib/config';
import { withRetry, HttpError } from '@/lib/retry';

// Gemini — one multimodal "super call" per garment. A single structured-output
// request handles identification (brand/category/color/condition/origin/fibers),
// dye and disposal analysis, landfill impact, and the resale appraisal.
// Water and CO2 are NOT estimated here — they come from the fiber lookup table
// (Textile Exchange / Water Footprint Network LCA data) via computeFiberImpact.

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
// never a reason to fail the whole analysis.
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

export type AnalyzedGarment = {
  brand: string | null;
  category: string | null;
  color: string | null;
  condition: GarmentCondition | null;
  origin: string | null;
  fibers: Fiber[];
};

export type GarmentAnalysis = {
  garment: AnalyzedGarment;
  /** Dye + disposal analysis — water/CO2 are added by the caller from the fiber lookup table. */
  cost: Omit<EnvironmentalCost, 'water_liters' | 'co2_kg' | 'resale'>;
  landfill: LandfillImpact;
  resale: ResaleEstimate | null;
};

function normalizeFibers(value: unknown): Fiber[] {
  const raw = Array.isArray(value) ? value : [];
  const fibers = raw
    .filter((f): f is { material: string; percentage: number } =>
      f && typeof f.material === 'string' && typeof f.percentage === 'number'
    )
    .map((f) => ({
      material: f.material.toLowerCase().trim(),
      percentage: Math.max(0, Math.min(100, Math.round(f.percentage))),
    }))
    .filter((f) => f.material.length > 0);

  // Normalize percentages to sum to 100 if Gemini didn't.
  const total = fibers.reduce((s, f) => s + f.percentage, 0);
  if (total > 0 && total !== 100) {
    for (const f of fibers) f.percentage = Math.round((f.percentage / total) * 100);
  }
  return fibers;
}

// Landfill text is display-only prose; keep unicode (e.g. "200–500 years")
// but strip markup and cap length.
function landfillText(v: unknown, max = 300): string {
  return typeof v === 'string' ? v.replace(/<[^>]*>/g, '').trim().slice(0, max) : '';
}

function buildAnalysisPrompt(ocrText: string | undefined, known: Garment | null | undefined): string {
  const knownContext = known
    ? JSON.stringify({
        brand: sanitizeForPrompt(known.brand),
        category: sanitizeForPrompt(known.category ?? undefined),
        color: sanitizeForPrompt(known.color),
        condition: known.condition ?? null,
        origin: sanitizeForPrompt(known.origin ?? undefined),
        fibers: known.fibers.map((f) => ({
          material: sanitizeForPrompt(f.material),
          percentage: f.percentage,
        })),
      })
    : 'none';

  return [
    'You are an expert secondhand-clothing appraiser AND textile environmental analyst for a resale app.',
    'Examine the attached photos of a garment (including any care/brand labels) and produce a complete,',
    'internally consistent analysis: identification, dye and disposal impact, landfill impact, and a resale payout.',
    'Water and CO2 footprints are computed separately from a lookup table (Textile Exchange / Water Footprint',
    'Network data) — do NOT estimate them.',
    '',
    '## IDENTIFY',
    '- brand: read brand names from labels, tags, logos, or embroidery. Recognize designer and luxury houses',
    '  (e.g. Miu Miu, Prada, Gucci, Ralph Lauren) as readily as mass-market brands. OCR text may garble',
    '  trademark symbols into stray letters ("BNEW BALANCE" -> "New Balance"). Ignore "Distributed by" /',
    '  "Imported by" lines. Return null only if no brand is visible or inferable.',
    '- category: garment type (e.g. "polo", "t-shirt", "jeans", "dress", "jacket").',
    '- color: dominant color as a descriptive name.',
    '- condition: visible wear — "poor" | "fair" | "good" | "excellent".',
    '- origin: country of manufacture from "Made in X" (translate to English, country name only), else null.',
    '- fibers: composition as { material, percentage } pairs summing to 100.',
    '  Use canonical English fiber names: "cotton", "polyester", "elastane", "nylon", "wool", "viscose",',
    '  "linen", "silk", "acrylic", "modal", "lyocell", "cashmere", "down", "hemp", "spandex".',
    '  Translate non-English names (coton/algodon/cotone/Baumwolle -> cotton; laine/lana/Wolle -> wool; etc.)',
    '  and ISO abbreviations (CO -> cotton, PES -> polyester, WO -> wool, PA -> nylon, EL -> elastane,',
    '  VI/CV -> viscose, LI -> linen, SE -> silk, CLY -> lyocell, CMD -> modal).',
    '  If the label has multiple sections (SHELL, LINING, TRIM, FILL), use ONLY the primary/largest section.',
    '  Do not confuse washing temperatures (30, 40, 60) or weights (200gsm) with fiber percentages.',
    '  Return an empty array if composition is not readable.',
    '',
    '## DYE ANALYSIS',
    'Score dye_pollution_score (1-10) from fiber blend + color + origin country:',
    '- Synthetic dyes (reactive, disperse, acid) on synthetic or blended fibers: higher risk (6-9)',
    '- Natural or low-impact dyes on natural fibers: lower risk (1-4)',
    '- Mixed fibers often require multiple dye types: moderate-high risk',
    '- Weak wastewater controls in the origin country increase risk',
    'If a color is identifiable, set dye_type to the most likely dye family used to achieve it',
    '(e.g. "synthetic reactive dye", "vat dye", "acid dye", "natural indigo", "disperse dye") and explain its',
    'environmental impact in dye_reasoning. Omit both if no color is discernible.',
    'reasoning: a brief environmental summary, under 80 words.',
    '',
    '## DISPOSAL',
    '- disposal_co2_kg: CO2 released via landfill decomposition or incineration (number)',
    '- disposal_landfill_years: estimated years to decompose in landfill (integer)',
    '- disposal_note: one sentence summarising disposal impact, max 40 words',
    '',
    '## LANDFILL IMPACT',
    'Fiber-specific analysis of what happens if this garment is landfilled:',
    '- landfill_microplastics: which fibers shed microplastics and how they leach into soil/groundwater',
    '- landfill_methane: decomposition timeline and methane/greenhouse output from organic fibers',
    '- landfill_dye_runoff: toxic dye and chemical runoff from this blend and its likely dyes',
    '- landfill_breakdown_years: realistic range like "200-500 years" for this specific blend',
    '- landfill_summary: one-sentence overall landfill impact, under 40 words',
    'STRICT: microplastics, methane, dye_runoff, and breakdown_years must each be under 100 characters.',
    '',
    '## RESALE (payout, USD)',
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
    'Set confidence: high (label clearly readable + condition visible), medium (partial), low (guessing).',
    'The identification, environmental analysis, and price must all describe the SAME garment.',
    '',
    '--- RAW LABEL OCR TEXT (auxiliary; may be noisy or empty) ---',
    (ocrText ?? '').slice(0, 2000) || 'none',
    '--- END OCR TEXT ---',
    '',
    '--- PREVIOUSLY SCANNED DATA (may be incomplete or wrong; trust the photos over it) ---',
    knownContext,
    '--- END SCANNED DATA ---',
    '',
    'Return only valid JSON matching the schema.',
  ].join('\n');
}

// The one Gemini call per garment. Used at scan time (with OCR text) and by the
// closet "Sell It" re-appraisal (with the previously scanned garment as hints).
export async function analyzeGarment(
  images: Array<{ mimeType: string; data: string }>,
  opts: { ocrText?: string; knownGarment?: Garment | null } = {},
): Promise<GarmentAnalysis> {
  const apiKey = getApiKey();
  const prompt = buildAnalysisPrompt(opts.ocrText, opts.knownGarment);

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
            required: [
              'brand', 'category', 'color', 'condition', 'origin', 'fibers', 'confidence',
              'dye_pollution_score', 'reasoning',
              'disposal_co2_kg', 'disposal_landfill_years', 'disposal_note',
              'landfill_summary', 'landfill_microplastics', 'landfill_methane', 'landfill_dye_runoff', 'landfill_breakdown_years',
              'resale_low_usd', 'resale_high_usd', 'resale_factors',
            ],
            properties: {
              brand: { type: 'STRING', nullable: true },
              category: { type: 'STRING', nullable: true },
              color: { type: 'STRING', nullable: true },
              condition: { type: 'STRING', enum: ['poor', 'fair', 'good', 'excellent'], nullable: true },
              origin: { type: 'STRING', nullable: true },
              fibers: {
                type: 'ARRAY',
                items: {
                  type: 'OBJECT',
                  required: ['material', 'percentage'],
                  properties: {
                    material: { type: 'STRING' },
                    percentage: { type: 'NUMBER' },
                  },
                },
              },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              dye_pollution_score: { type: 'NUMBER' },
              dye_type: { type: 'STRING' },
              dye_reasoning: { type: 'STRING' },
              reasoning: { type: 'STRING' },
              disposal_co2_kg: { type: 'NUMBER' },
              disposal_landfill_years: { type: 'NUMBER' },
              disposal_note: { type: 'STRING' },
              landfill_summary: { type: 'STRING' },
              landfill_microplastics: { type: 'STRING' },
              landfill_methane: { type: 'STRING' },
              landfill_dye_runoff: { type: 'STRING' },
              landfill_breakdown_years: { type: 'STRING' },
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
      log.error('Gemini garment analysis failed', undefined, { stage: 'analyze', status: response.status });
      throw new HttpError(response.status, `Gemini garment analysis failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<GeminiResponse>;
  }, { retries: 2, label: 'Gemini-analyze' });

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini returned no content for garment analysis.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON for garment analysis: ${rawText}`);
  }

  const r = parsed as Record<string, unknown>;
  const VALID_CONDITIONS = new Set<string>(['poor', 'fair', 'good', 'excellent']);

  const dye = normalizeDyeAnalysis(parsed);

  const resale = normalizeResaleEstimate({
    low_usd: r.resale_low_usd,
    high_usd: r.resale_high_usd,
    confidence: r.confidence,
    factors: r.resale_factors,
  });

  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? sanitizeResponseText(v.trim(), max) : null;

  return {
    garment: {
      brand: str(r.brand, 80),
      category: str(r.category, 60),
      color: str(r.color, 60),
      condition:
        typeof r.condition === 'string' && VALID_CONDITIONS.has(r.condition)
          ? (r.condition as GarmentCondition)
          : null,
      origin: str(r.origin, 60),
      fibers: normalizeFibers(r.fibers),
    },
    cost: dye,
    landfill: {
      summary: landfillText(r.landfill_summary),
      microplastics: landfillText(r.landfill_microplastics),
      methane: landfillText(r.landfill_methane),
      dye_runoff: landfillText(r.landfill_dye_runoff),
      breakdown_years: landfillText(r.landfill_breakdown_years, 60),
    },
    resale,
  };
}

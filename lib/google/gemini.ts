import type { EnvironmentalCost, Fiber, Garment, GarmentCondition, LandfillImpact, Provenance } from '@/types/garment';
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
            required: ['dye_pollution_score', 'confidence', 'reasoning', 'disposal_co2_kg', 'disposal_landfill_years', 'disposal_note'],
            properties: {
              dye_pollution_score: { type: 'NUMBER' },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              reasoning: { type: 'STRING' },
              disposal_co2_kg: { type: 'NUMBER' },
              disposal_landfill_years: { type: 'NUMBER' },
              disposal_note: { type: 'STRING' },
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

  return {
    water_liters,
    co2_kg,
    ...dye,
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

// ── Single-call multimodal ingest ─────────────────────────────────────────
// Replaces the Vision-OCR-then-parse chain: one Gemini request reads all label
// images (plus an optional garment photo) and returns structured garment data
// with per-field provenance (stated = read off the label, inferred = guessed).

export type IngestResult = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
  condition?: GarmentCondition;
  provenance: { fibers: Provenance; origin: Provenance; category: Provenance; brand?: Provenance };
  confidence: 'high' | 'medium' | 'low';
};

const INGEST_PROMPT = [
  'You are reading clothing care labels. Extract fibers (material + percentage, material normalized to snake_case like recycled_polyester), country of origin, garment category, brand, and (only if a garment photo is included) color and condition (poor|fair|good|excellent).',
  "If a field is not printed on the label, infer your best guess from brand, category, and typical industry sourcing — and mark that field 'inferred' in provenance. Fields read directly off the label are 'stated'. Never leave provenance unset for a non-null field.",
].join('\n');

const INGEST_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['fibers', 'origin', 'category', 'provenance', 'confidence'],
  properties: {
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
    origin: { type: 'STRING', nullable: true },
    category: { type: 'STRING', nullable: true },
    brand: { type: 'STRING', nullable: true },
    color: { type: 'STRING', nullable: true },
    condition: { type: 'STRING', enum: ['poor', 'fair', 'good', 'excellent'], nullable: true },
    provenance: {
      type: 'OBJECT',
      required: ['fibers', 'origin', 'category'],
      properties: {
        fibers: { type: 'STRING', enum: ['stated', 'inferred'] },
        origin: { type: 'STRING', enum: ['stated', 'inferred'] },
        category: { type: 'STRING', enum: ['stated', 'inferred'] },
        brand: { type: 'STRING', enum: ['stated', 'inferred'], nullable: true },
      },
    },
    confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
  },
} as const;

const VALID_PROVENANCE = new Set<string>(['stated', 'inferred']);
const VALID_CONFIDENCE = new Set<string>(['high', 'medium', 'low']);
const VALID_INGEST_CONDITIONS = new Set<string>(['poor', 'fair', 'good', 'excellent']);

function provenanceFor(value: unknown): Provenance {
  // Default to 'inferred' when the model omits provenance for a present field.
  if (typeof value === 'string' && VALID_PROVENANCE.has(value)) return value as Provenance;
  return 'inferred';
}

function normalizeIngest(parsed: unknown): IngestResult {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Gemini ingest response is not an object.');
  }
  const r = parsed as Record<string, unknown>;

  // Fibers: keep only entries with numeric percentage > 0, cap at 8.
  const rawFibers = Array.isArray(r.fibers) ? r.fibers : [];
  const fibers: Fiber[] = rawFibers
    .filter(
      (f): f is { material: string; percentage: number } =>
        !!f &&
        typeof f === 'object' &&
        typeof (f as { material?: unknown }).material === 'string' &&
        typeof (f as { percentage?: unknown }).percentage === 'number' &&
        (f as { percentage: number }).percentage > 0,
    )
    .map((f) => ({
      material: sanitizeResponseText(f.material.trim(), 60),
      percentage: Math.max(0, Math.min(100, Math.round(f.percentage))),
    }))
    .filter((f) => f.material.length > 0 && f.percentage > 0)
    .slice(0, 8);

  if (fibers.length === 0) {
    throw new Error('Gemini ingest returned no valid fibers.');
  }

  const origin = typeof r.origin === 'string' && r.origin ? sanitizeResponseText(r.origin.trim(), 100) : null;
  const category = typeof r.category === 'string' && r.category ? sanitizeResponseText(r.category.trim(), 60) : null;
  const brand = typeof r.brand === 'string' && r.brand ? sanitizeResponseText(r.brand.trim(), 100) : undefined;
  const color = typeof r.color === 'string' && r.color ? sanitizeResponseText(r.color.trim(), 60) : undefined;
  const condition =
    typeof r.condition === 'string' && VALID_INGEST_CONDITIONS.has(r.condition)
      ? (r.condition as GarmentCondition)
      : undefined;

  const prov = (r.provenance && typeof r.provenance === 'object' ? r.provenance : {}) as Record<string, unknown>;
  const provenance: IngestResult['provenance'] = {
    fibers: provenanceFor(prov.fibers),
    origin: provenanceFor(prov.origin),
    category: provenanceFor(prov.category),
    ...(brand !== undefined ? { brand: provenanceFor(prov.brand) } : {}),
  };

  const confidence =
    typeof r.confidence === 'string' && VALID_CONFIDENCE.has(r.confidence)
      ? (r.confidence as 'high' | 'medium' | 'low')
      : 'medium';

  return {
    fibers,
    origin,
    category,
    ...(brand !== undefined ? { brand } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(condition !== undefined ? { condition } : {}),
    provenance,
    confidence,
  };
}

export async function ingestGarment(
  labelBuffers: Buffer[],
  garmentPhoto: Buffer | null,
): Promise<IngestResult> {
  if (labelBuffers.length === 0 && garmentPhoto === null) throw new Error('ingestGarment requires at least one image.');

  const apiKey = getApiKey();

  const imageParts = [
    ...labelBuffers.map((buf) => ({
      inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') },
    })),
    ...(garmentPhoto
      ? [{ inlineData: { mimeType: 'image/jpeg', data: garmentPhoto.toString('base64') } }]
      : []),
  ];

  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [...imageParts, { text: INGEST_PROMPT }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: INGEST_RESPONSE_SCHEMA,
    },
  });

  // One attempt issues the (retryable) HTTP request, then parses + validates.
  // A parse/validation failure re-issues the whole request exactly once.
  const attempt = async (): Promise<IngestResult> => {
    const data = await withRetry(async () => {
      const response = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        headers: geminiHeaders(apiKey),
        body,
      });
      if (!response.ok) {
        const text = await response.text();
        log.error('Gemini ingest request failed', undefined, { stage: 'ingest', status: response.status });
        throw new HttpError(response.status, `Gemini ingest failed (${response.status}): ${text}`);
      }
      return response.json() as Promise<GeminiResponse>;
    }, { retries: 3, label: 'Gemini-ingest' });

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Gemini returned no content for ingest.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error(`Gemini returned non-JSON for ingest: ${rawText}`);
    }
    return normalizeIngest(parsed);
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    log.warn('Gemini ingest parse/validation failed, retrying once', {
      stage: 'ingest',
      err: err instanceof Error ? err.message : String(err),
    });
    return attempt();
  }
}

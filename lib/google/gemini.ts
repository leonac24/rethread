import type { EnvironmentalCost, Garment, LandfillImpact } from '@/types/garment';
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
    fibers: garment.fibers,
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
    'Keep reasoning under 60 words. Return only valid JSON matching schema.',
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
    'If a color is present, identify the most likely dye family',
    '(e.g. "synthetic reactive dye", "vat dye", "acid dye", "natural indigo", "disperse dye")',
    'and include dye_type and dye_reasoning. Omit both if no color is present.',
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
    !['high', 'medium', 'low'].includes(confidence)
  ) {
    throw new Error('Gemini response does not match dye analysis schema.');
  }

  return {
    dye_pollution_score: Math.max(1, Math.min(10, Math.round(candidate.dye_pollution_score))),
    confidence,
    reasoning: sanitizeResponseText(candidate.reasoning.trim(), 200),
    ...(candidate.dye_type ? { dye_type: sanitizeResponseText(candidate.dye_type.trim(), 100) } : {}),
    ...(candidate.dye_reasoning ? { dye_reasoning: sanitizeResponseText(candidate.dye_reasoning.trim(), 200) } : {}),
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
            required: ['dye_pollution_score', 'confidence', 'reasoning'],
            properties: {
              dye_pollution_score: { type: 'NUMBER' },
              confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
              reasoning: { type: 'STRING' },
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
    'Also write a one-sentence summary of the overall landfill impact.',
    'Be specific to the fiber blend. Keep each field under 40 words. breakdown_years should be a short string like "200–500 years" or "20–30 years".',
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
    'Return only valid JSON matching the schema.',
  ].join(' ');

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
          required: ['category', 'color'],
          properties: {
            category: { type: 'STRING' },
            color: { type: 'STRING' },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error('Gemini image analysis failed', undefined, { stage: 'ingest', status: response.status });
    throw new Error(`Gemini image analysis failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;
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

  const result = parsed as Record<string, unknown>;
  return {
    category: typeof result.category === 'string' && result.category ? result.category : null,
    color: typeof result.color === 'string' && result.color ? result.color : null,
  };
}

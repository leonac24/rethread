import type { EnvironmentalCost, Garment, GarmentCondition } from '@/types/garment';
import { log } from '@/lib/logger';
import { GEMINI_TIMEOUT_MS } from '@/lib/config';
import { withRetry, HttpError } from '@/lib/retry';

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
  // Sanitize all user-controlled fields before embedding in prompt
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
    'You are an apparel lifecycle analyst.',
    'Estimate environmental cost for a single garment using known apparel benchmarks and conservative assumptions.',
    'Focus on water use, CO2 emissions, and dye pollution risk from fiber blend + origin country + category.',
    'If data is missing, use sensible defaults and lower confidence accordingly.',
    'Keep the reasoning field under 60 words.',
    'Return only valid JSON matching schema.',
    '',
    '--- GARMENT DATA (user-provided) ---',
    JSON.stringify(safeGarment),
    '--- END GARMENT DATA ---',
    '',
    brandContext ? `Brand context: ${sanitizeForPrompt(brandContext, 500)}` : 'Brand context: none',
    '',
    'Benchmark hints (guidance, not hard constraints):',
    '- Cotton tends to be water-intensive in raw fiber stage.',
    '- Polyester tends to be lower-water but higher fossil CO2 than natural fibers.',
    '- Dye pollution risk rises with synthetic dyes, mixed fibers, and weak wastewater controls.',
    '- Origin country may affect average grid intensity and wastewater treatment reliability.',
    '- Category affects mass assumptions (e.g., t-shirt < hoodie < jeans).',
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
  ].join('\n');
}

function normalizeCost(value: unknown): EnvironmentalCost {
  if (!value || typeof value !== 'object') {
    throw new Error('Gemini response is not an object.');
  }

  const candidate = value as Partial<EnvironmentalCost>;
  const confidence = candidate.confidence;

  if (
    typeof candidate.water_liters !== 'number' ||
    typeof candidate.co2_kg !== 'number' ||
    typeof candidate.dye_pollution_score !== 'number' ||
    typeof candidate.reasoning !== 'string' ||
    !confidence ||
    !['high', 'medium', 'low'].includes(confidence) ||
    typeof candidate.disposal_co2_kg !== 'number' ||
    typeof candidate.disposal_landfill_years !== 'number' ||
    typeof candidate.disposal_note !== 'string'
  ) {
    throw new Error('Gemini response does not match EnvironmentalCost schema.');
  }

  const dyeScore = Math.max(1, Math.min(10, Math.round(candidate.dye_pollution_score)));

  return {
    water_liters: Math.max(0, Number(candidate.water_liters.toFixed(2))),
    co2_kg: Math.max(0, Number(candidate.co2_kg.toFixed(2))),
    dye_pollution_score: dyeScore,
    confidence,
    reasoning: sanitizeResponseText(candidate.reasoning.trim(), 200),
    ...(candidate.dye_type ? { dye_type: sanitizeResponseText(candidate.dye_type.trim(), 100) } : {}),
    ...(candidate.dye_reasoning ? { dye_reasoning: sanitizeResponseText(candidate.dye_reasoning.trim(), 200) } : {}),
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
            required: ['water_liters', 'co2_kg', 'dye_pollution_score', 'confidence', 'reasoning', 'disposal_co2_kg', 'disposal_landfill_years', 'disposal_note'],
            properties: {
              water_liters: { type: 'NUMBER' },
              co2_kg: { type: 'NUMBER' },
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

  return normalizeCost(parsed);
}

export type GarmentImageAnalysis = {
  category: string | null;
  color: string | null;
  condition: GarmentCondition | null;
};

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

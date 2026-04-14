import type { EnvironmentalCost, Garment, LandfillImpact } from '@/types/garment';
import { log } from '@/lib/logger';

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
    fibers: garment.fibers,
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
    !['high', 'medium', 'low'].includes(confidence)
  ) {
    throw new Error('Gemini response does not match EnvironmentalCost schema.');
  }

  const dyeScore = Math.max(1, Math.min(10, Math.round(candidate.dye_pollution_score)));

  return {
    water_liters: Number(candidate.water_liters.toFixed(2)),
    co2_kg: Number(candidate.co2_kg.toFixed(2)),
    dye_pollution_score: dyeScore,
    confidence,
    reasoning: sanitizeResponseText(candidate.reasoning.trim(), 200),
    ...(candidate.dye_type ? { dye_type: sanitizeResponseText(candidate.dye_type.trim(), 100) } : {}),
    ...(candidate.dye_reasoning ? { dye_reasoning: sanitizeResponseText(candidate.dye_reasoning.trim(), 200) } : {}),
  };
}

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');
  return apiKey;
}

function geminiUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
}

export async function computeCost(
  garment: Garment,
  brandContext?: string,
): Promise<EnvironmentalCost> {
  const apiKey = getApiKey();
  const prompt = buildPrompt(garment, brandContext);

  const hasDyeFields = !!garment.color;

  const response = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          required: ['water_liters', 'co2_kg', 'dye_pollution_score', 'confidence', 'reasoning'],
          properties: {
            water_liters: { type: 'NUMBER' },
            co2_kg: { type: 'NUMBER' },
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
    throw new Error(`Gemini request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;
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

  const response = await fetch(geminiUrl(apiKey), {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: { 'Content-Type': 'application/json' },
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

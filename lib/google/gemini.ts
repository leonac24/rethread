import type { EnvironmentalCost, Garment } from '@/types/garment';

// Gemini — structured environmental-cost reasoning.
// Enforce responseSchema so output always matches EnvironmentalCost.

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function buildPrompt(garment: Garment, brandContext?: string) {
  return [
    'You are an apparel lifecycle analyst.',
    'Estimate environmental cost for a single garment using known apparel benchmarks and conservative assumptions.',
    'Focus on water use, CO2 emissions, and dye pollution risk from fiber blend + origin country + category.',
    'If data is missing, use sensible defaults and lower confidence accordingly.',
    'Return only valid JSON matching schema.',
    '',
    `Garment JSON: ${JSON.stringify(garment)}`,
    brandContext ? `Brand context: ${brandContext}` : 'Brand context: none',
    '',
    'Benchmark hints (guidance, not hard constraints):',
    '- Cotton tends to be water-intensive in raw fiber stage.',
    '- Polyester tends to be lower-water but higher fossil CO2 than natural fibers.',
    '- Dye pollution risk rises with synthetic dyes, mixed fibers, and weak wastewater controls.',
    '- Origin country may affect average grid intensity and wastewater treatment reliability.',
    '- Category affects mass assumptions (e.g., t-shirt < hoodie < jeans).',
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
    reasoning: candidate.reasoning.trim(),
  };
}

export async function computeCost(
  garment: Garment,
  brandContext?: string,
): Promise<EnvironmentalCost> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }

  const prompt = buildPrompt(garment, brandContext);

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            required: [
              'water_liters',
              'co2_kg',
              'dye_pollution_score',
              'confidence',
              'reasoning',
            ],
            properties: {
              water_liters: { type: 'NUMBER' },
              co2_kg: { type: 'NUMBER' },
              dye_pollution_score: { type: 'NUMBER' },
              confidence: {
                type: 'STRING',
                enum: ['high', 'medium', 'low'],
              },
              reasoning: { type: 'STRING' },
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error('Gemini returned no content.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON content: ${rawText}`);
  }

  return normalizeCost(parsed);
}

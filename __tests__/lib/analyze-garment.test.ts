import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';

// Unit tests for the one-call garment analysis: mock the Gemini HTTP layer and
// verify the normalization of every section of the structured response.

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const { analyzeGarment } = await import('../../lib/google/gemini');

const realFetch = globalThis.fetch;
let lastRequestBody: Record<string, unknown> | null = null;
let responseText: string | (() => string) = '';

function geminiBody(payload: unknown): string {
  return JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  });
}

const GOOD_PAYLOAD = {
  brand: '<b>Miu Miu</b>',
  category: 'polo',
  color: 'navy blue',
  condition: 'good',
  origin: 'Italy',
  fibers: [
    { material: 'Cotton', percentage: 60 },
    { material: 'Polyester', percentage: 20 },
  ],
  confidence: 'high',
  dye_pollution_score: 15,
  dye_type: 'synthetic reactive dye',
  dye_reasoning: 'Reactive dyes on cotton blends carry wastewater risk.',
  reasoning: 'Blend requires multiple dye baths.',
  disposal_co2_kg: 1.238,
  disposal_landfill_years: 4.6,
  disposal_note: 'Partially biodegradable; synthetics persist.',
  landfill_summary: 'Mixed blend lingers in landfill.',
  landfill_microplastics: 'Polyester content sheds microplastics into soil.',
  landfill_methane: 'Cotton portion emits methane over 1-5 years.',
  landfill_dye_runoff: 'Reactive dye runoff can reach groundwater.',
  landfill_breakdown_years: '20–200 years',
  resale_low_usd: 45.9,
  resale_high_usd: 70.2,
  resale_factors: ['Miu Miu resells strongly', 'light wear'],
};

beforeAll(() => {
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    lastRequestBody = init?.body ? JSON.parse(init.body) : null;
    const text = typeof responseText === 'function' ? responseText() : responseText;
    return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  lastRequestBody = null;
  responseText = geminiBody(GOOD_PAYLOAD);
});

describe('analyzeGarment', () => {
  it('normalizes every section of the super-call response', async () => {
    const analysis = await analyzeGarment(
      [{ mimeType: 'image/jpeg', data: 'aW1n' }],
      { ocrText: '100% COTTON MADE IN ITALY' },
    );

    // Identification: HTML stripped, invalid-free.
    expect(analysis.garment.brand).toBe('Miu Miu');
    expect(analysis.garment.category).toBe('polo');
    expect(analysis.garment.condition).toBe('good');
    expect(analysis.garment.origin).toBe('Italy');

    // Fibers lowercased and rescaled to sum to 100 (60/20 → 75/25).
    expect(analysis.garment.fibers).toEqual([
      { material: 'cotton', percentage: 75 },
      { material: 'polyester', percentage: 25 },
    ]);

    // Dye/disposal: score clamped to 10, disposal rounded.
    expect(analysis.cost.dye_pollution_score).toBe(10);
    expect(analysis.cost.confidence).toBe('high');
    expect(analysis.cost.dye_type).toBe('synthetic reactive dye');
    expect(analysis.cost.disposal_co2_kg).toBe(1.24);
    expect(analysis.cost.disposal_landfill_years).toBe(5);

    // Landfill text keeps unicode (en-dash) — display prose, not identifiers.
    expect(analysis.landfill.breakdown_years).toBe('20–200 years');
    expect(analysis.landfill.microplastics).toContain('microplastics');

    // Resale floored/ordered.
    expect(analysis.resale).toEqual({
      low_usd: 45,
      high_usd: 70,
      confidence: 'high',
      factors: ['Miu Miu resells strongly', 'light wear'],
    });
  });

  it('sends images inline and the OCR text in the prompt', async () => {
    await analyzeGarment(
      [
        { mimeType: 'image/jpeg', data: 'aW1nMQ==' },
        { mimeType: 'image/png', data: 'aW1nMg==' },
      ],
      { ocrText: 'UNIQUE-OCR-MARKER' },
    );

    const contents = (lastRequestBody as { contents: Array<{ parts: Array<Record<string, unknown>> }> }).contents;
    const parts = contents[0].parts;
    expect(parts).toHaveLength(3);
    expect(parts[0].inlineData).toEqual({ mimeType: 'image/jpeg', data: 'aW1nMQ==' });
    expect(parts[1].inlineData).toEqual({ mimeType: 'image/png', data: 'aW1nMg==' });
    expect(String(parts[2].text)).toContain('UNIQUE-OCR-MARKER');

    const gen = (lastRequestBody as Record<string, any>).generationConfig;
    expect(gen.responseMimeType).toBe('application/json');
    expect(gen.responseSchema.required).toContain('resale_low_usd');
    expect(gen.responseSchema.required).toContain('landfill_summary');
  });

  it('null resale never sinks the analysis', async () => {
    responseText = geminiBody({ ...GOOD_PAYLOAD, resale_low_usd: 'free', resale_high_usd: null });
    const analysis = await analyzeGarment([{ mimeType: 'image/jpeg', data: 'aW1n' }]);
    expect(analysis.resale).toBeNull();
    expect(analysis.garment.brand).toBe('Miu Miu');
  });

  it('invalid condition and blank identity fields become null', async () => {
    responseText = geminiBody({
      ...GOOD_PAYLOAD,
      brand: '   ',
      condition: 'mint',
      origin: null,
      fibers: 'not-an-array',
    });
    const analysis = await analyzeGarment([{ mimeType: 'image/jpeg', data: 'aW1n' }]);
    expect(analysis.garment.brand).toBeNull();
    expect(analysis.garment.condition).toBeNull();
    expect(analysis.garment.origin).toBeNull();
    expect(analysis.garment.fibers).toEqual([]);
  });

  it('throws when Gemini returns non-JSON content', async () => {
    responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'not json at all' }] } }],
    });
    await expect(analyzeGarment([{ mimeType: 'image/jpeg', data: 'aW1n' }])).rejects.toThrow(/non-JSON/);
  });
});

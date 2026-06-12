import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { ingestGarment } from '@/lib/google/gemini';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// Production reads GEMINI_API_KEY before issuing the request; mocking fetch is
// enough for the rest, but the key must be present or getApiKey() throws.
beforeAll(() => { process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key'; });

const geminiReply = (obj: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] } }] }), { status: 200 });

const valid = {
  fibers: [{ material: 'cotton', percentage: 100 }],
  origin: 'portugal', category: 't-shirt', brand: 'Uniqlo', color: null, condition: null,
  provenance: { fibers: 'stated', origin: 'stated', category: 'inferred', brand: 'stated' },
  confidence: 'high',
};

describe('ingestGarment', () => {
  test('parses schema-enforced response', async () => {
    globalThis.fetch = (async () => geminiReply(valid)) as typeof fetch;
    const g = await ingestGarment([Buffer.from('fake')], null);
    expect(g.fibers[0].material).toBe('cotton');
    expect(g.provenance.category).toBe('inferred');
  });

  test('retries once on malformed response, then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? geminiReply('not json at all') : geminiReply(valid);
    }) as typeof fetch;
    const g = await ingestGarment([Buffer.from('fake')], null);
    expect(calls).toBe(2);
    expect(g.brand).toBe('Uniqlo');
  });
});

// scripts/seed-brands.ts
// One-time local script: bun run scripts/seed-brands.ts
//
// Required environment variables:
//   FIREBASE_SERVICE_ACCOUNT_BASE64  — base64-encoded Firebase Admin service account JSON
//   GEMINI_API_KEY                   — Google Gemini API key
//   WIKIRATE_API_KEY                 — WikiRate API key (optional; FTI lookup skipped if absent)

import { db } from '@/lib/firebase/admin';
import { computeBrandScore, kappaForStatus, slugifyBrand } from '@/lib/score/brand';
import type { BrandRecord } from '@/types/brand';
import { getFashionTransparencyScore } from '@/lib/wikirate';

// ── Gemini plumbing (local — helpers in lib/google/gemini.ts are not exported) ──

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

const SEED_GEMINI_TIMEOUT_MS = 60_000; // longer budget for grounded research

function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Missing GEMINI_API_KEY');
  return key;
}

function geminiHeaders(apiKey: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

async function withLocalRetry<T>(fn: () => Promise<T>, retries = 3, label = 'Gemini'): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status ?? 0;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || i === retries) throw err;
      const wait = Math.min(300 * 2 ** (i - 1), 5000) * (0.8 + Math.random() * 0.4);
      console.warn(`  [retry] ${label} attempt ${i}/${retries}, waiting ${Math.round(wait)}ms`);
      await new Promise<void>((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// Phase 1: grounded dossier (google_search tool, no responseSchema)
async function fetchDossier(brandName: string): Promise<string> {
  const apiKey = getGeminiApiKey();
  const prompt =
    `Research the clothing brand ${brandName} for environmental and labor practices. Cover: sustainability commitments and progress, supply-chain transparency and disclosure depth, labor controversies or violations in the last 10 years, certifications (Fair Trade, B Corp, SA8000, GOTS, bluesign), typical materials used. Cite a source URL for every factual claim.`;
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
  });
  const data = await withLocalRetry(async () => {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(SEED_GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = Object.assign(new Error(`Gemini dossier failed (${res.status}): ${text}`), { status: res.status });
      throw err;
    }
    return res.json() as Promise<GeminiResponse>;
  }, 3, 'Gemini-dossier');
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) throw new Error('Gemini dossier returned no content');
  return text;
}

type ExtractedDossier = {
  summary: string;
  citations: { claim: string; url: string }[];
  certifications: string[];
  transparency: number;
  laborSupplyChain: number;
  productImpactBaseline: number;
};

// Phase 2: schema-enforced extraction (no grounding)
async function extractStructured(dossierText: string): Promise<ExtractedDossier> {
  const apiKey = getGeminiApiKey();
  const prompt = [
    "From the following brand research dossier, extract structured data.",
    "summary: one-paragraph summary of the brand's sustainability and labor record, max 600 characters.",
    "citations: list of { claim, url } pairs from the dossier text.",
    "certifications: list of certifications the brand holds (e.g. Fair Trade, B Corp, SA8000, GOTS, bluesign).",
    "transparency (0-100): reflects disclosure depth — how much the brand publicly discloses supply chain, environmental policies, and labor practices.",
    "laborSupplyChain (0-100): reflects certifications minus controversies — high certifications and no controversies = high score.",
    "productImpactBaseline (0-100): reflects typical materials and manufacturing footprint — sustainable materials and practices = high score.",
    "",
    "Dossier:",
    dossierText,
  ].join('\n');

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        required: ['summary', 'citations', 'certifications', 'transparency', 'laborSupplyChain', 'productImpactBaseline'],
        properties: {
          summary: { type: 'STRING' },
          citations: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              required: ['claim', 'url'],
              properties: { claim: { type: 'STRING' }, url: { type: 'STRING' } },
            },
          },
          certifications: { type: 'ARRAY', items: { type: 'STRING' } },
          transparency: { type: 'NUMBER' },
          laborSupplyChain: { type: 'NUMBER' },
          productImpactBaseline: { type: 'NUMBER' },
        },
      },
    },
  });

  const data = await withLocalRetry(async () => {
    const res = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      signal: AbortSignal.timeout(SEED_GEMINI_TIMEOUT_MS),
      headers: geminiHeaders(apiKey),
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = Object.assign(new Error(`Gemini extract failed (${res.status}): ${text}`), { status: res.status });
      throw err;
    }
    return res.json() as Promise<GeminiResponse>;
  }, 3, 'Gemini-extract');

  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!rawText) throw new Error('Gemini extract returned no content');
  return JSON.parse(rawText) as ExtractedDossier;
}

function clamp(n: number, min = 0, max = 100): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

// ── Seed list ────────────────────────────────────────────────────────────────

export type SeedEntry = { name: string; aliases?: string[] };

export const SEED_BRANDS: SeedEntry[] = [
  { name: 'zara' },
  { name: 'h&m', aliases: ['hennes-mauritz', 'h-and-m'] },
  { name: 'uniqlo' },
  { name: 'nike' },
  { name: 'adidas' },
  { name: 'shein' },
  { name: 'gap' },
  { name: 'old navy' },
  { name: "levi's", aliases: ['levi-strauss', 'levis'] },
  { name: 'patagonia' },
  { name: 'the north face', aliases: ['north-face'] },
  { name: 'lululemon' },
  { name: 'primark' },
  { name: 'forever 21' },
  { name: 'urban outfitters' },
  { name: 'american eagle', aliases: ['american-eagle-outfitters'] },
  { name: 'hollister' },
  { name: 'abercrombie & fitch', aliases: ['abercrombie'] },
  { name: 'gucci' },
  { name: 'prada' },
  { name: 'louis vuitton' },
  { name: 'burberry' },
  { name: 'ralph lauren', aliases: ['polo-ralph-lauren', 'polo'] },
  { name: 'tommy hilfiger' },
  { name: 'calvin klein' },
  { name: 'under armour' },
  { name: 'puma' },
  { name: 'new balance' },
  { name: 'asos' },
  { name: 'boohoo' },
  { name: 'mango' },
  { name: 'banana republic' },
  { name: 'j.crew', aliases: ['jcrew'] },
  { name: 'madewell' },
  { name: 'everlane' },
  { name: 'reformation' },
  { name: 'carhartt' },
  { name: 'columbia', aliases: ['columbia-sportswear'] },
  { name: 'champion' },
  { name: 'hanes' },
  { name: 'fruit of the loom' },
  { name: "victoria's secret" },
  { name: 'aerie' },
  { name: 'free people' },
  { name: 'anthropologie' },
  { name: 'dickies' },
  { name: 'wrangler' },
  { name: 'lee' },
  { name: 'guess' },
  { name: 'cos' },
];

// ── Main ─────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < SEED_BRANDS.length; i++) {
    const entry = SEED_BRANDS[i]!;
    const { name, aliases = [] } = entry;
    const slug = slugifyBrand(name);
    console.log(`[${i + 1}/${SEED_BRANDS.length}] ${name}…`);

    try {
      // Step 1: grounded dossier
      const dossierText = await fetchDossier(name);

      // Step 2: schema-enforced extraction
      const extracted = await extractStructured(dossierText);

      // Step 3: FTI override
      let transparency = clamp(extracted.transparency);
      let fti: BrandRecord['fti'] | undefined;
      try {
        const ftiResult = await getFashionTransparencyScore(name);
        if (ftiResult) {
          transparency = Math.round(0.5 * extracted.transparency + 0.5 * ftiResult.score);
          fti = { score: ftiResult.score, year: ftiResult.year, url: ftiResult.url };
        }
      } catch (err) {
        console.warn(`  [fti] ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Step 4: build BrandRecord
      const baseline = clamp(extracted.productImpactBaseline);
      const laborSupplyChain = clamp(extracted.laborSupplyChain);
      const productImpact = baseline; // current = baseline when n=0
      const { score, grade } = computeBrandScore({ productImpact, transparency, laborSupplyChain });

      const slugifiedAliases = aliases.map((a) => slugifyBrand(a)).filter(Boolean);

      const record: BrandRecord = {
        name,
        slug,
        aliases: slugifiedAliases,
        status: 'unclaimed',
        dossier: {
          summary: extracted.summary.slice(0, 600),
          citations: extracted.citations,
          certifications: extracted.certifications,
          researchedAt: Date.now(),
        },
        dims: {
          productImpact: {
            baseline,
            kappa: kappaForStatus('unclaimed'),
            n: 0,
            sum: 0,
            current: baseline,
          },
          transparency,
          laborSupplyChain,
        },
        ...(fti ? { fti } : {}),
        score,
        grade,
        updatedAt: Date.now(),
      };

      // Step 5: upsert (merge: false is idempotent on re-run — replaces the full document)
      await db().collection('brands').doc(slug).set(record, { merge: false });
      console.log(`  ✓ ${name} → score ${score} (${grade})`);
      succeeded.push(name);
    } catch (err) {
      console.error(`  ✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
      failed.push(name);
    }
  }

  console.log('\n─── Seed summary ───────────────────────────────');
  console.log(`Succeeded (${succeeded.length}): ${succeeded.join(', ')}`);
  if (failed.length) {
    console.log(`Failed    (${failed.length}): ${failed.join(', ')}`);
    process.exit(1);
  }
}

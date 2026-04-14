import type { Garment } from '@/types/garment';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import { getGoogleCredentials } from '@/lib/google/client';

// Cloud Vision — OCR a care-label photo.

// Proper singleton — no promise-based lazy init to avoid race conditions
let _client: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
  if (_client) return _client;
  const creds = getGoogleCredentials();
  _client = new ImageAnnotatorClient({
    projectId: creds.projectId,
    credentials: {
      client_email: creds.clientEmail,
      private_key: creds.privateKey,
    },
  });
  return _client;
}

// Material synonym normalization — maps shorthand to canonical names
const MATERIAL_SYNONYMS: Record<string, string> = {
  poly: 'polyester',
  elastane: 'spandex',
  lycra: 'spandex',
  viscose: 'rayon',
  modal: 'rayon',
  tencel: 'lyocell',
};

function normalizeMaterial(raw: string): string {
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return MATERIAL_SYNONYMS[normalized] ?? normalized;
}

function extractFibers(text: string): Garment['fibers'] {
  const fibers: Garment['fibers'] = [];
  const seen = new Set<string>();

  // Pattern 1: "80% cotton" — standard forward format
  const forwardMatches = text.matchAll(/(\d{1,3})\s*%\s*([a-z][a-z\-\s]{1,40})/gi);
  for (const match of forwardMatches) {
    const percentage = Number(match[1]);
    const material = normalizeMaterial(match[2]);
    if (!material || Number.isNaN(percentage) || percentage < 1 || percentage > 100) continue;
    if (seen.has(material)) continue;
    fibers.push({ material, percentage });
    seen.add(material);
  }

  // Pattern 2: "cotton (80%)" — reverse format
  const reverseMatches = text.matchAll(/([a-z][a-z\-\s]{1,40})\s*\((\d{1,3})\s*%\)/gi);
  for (const match of reverseMatches) {
    const percentage = Number(match[2]);
    const material = normalizeMaterial(match[1]);
    if (!material || Number.isNaN(percentage) || percentage < 1 || percentage > 100) continue;
    if (seen.has(material)) continue;
    fibers.push({ material, percentage });
    seen.add(material);
  }

  return fibers;
}

function extractOrigin(text: string): string | null {
  const originMatch = text.match(
    /(?:made\s+in|manufactured\s+in|product\s+of|country\s+of\s+origin)\s*[:\-]?\s*([a-z\s]+)/i,
  );
  if (!originMatch?.[1]) {
    return null;
  }

  const origin = originMatch[1].trim().replace(/\s+/g, ' ');
  return origin.length > 1 ? origin : null;
}

function inferCategory(text: string): string | null {
  const lower = text.toLowerCase();
  const categoryMatchers: Array<[RegExp, string]> = [
    [/\b(t\s*shirt|tee|shirt)\b/, 'shirt'],
    [/\b(jeans|denim|pants|trousers)\b/, 'pants'],
    [/\b(dress)\b/, 'dress'],
    [/\b(skirt)\b/, 'skirt'],
    [/\b(sweater|hoodie|sweatshirt|knit)\b/, 'sweater'],
    [/\b(jacket|coat|blazer)\b/, 'jacket'],
    [/\b(shorts)\b/, 'shorts'],
  ];

  const match = categoryMatchers.find(([pattern]) => pattern.test(lower));
  return match?.[1] ?? null;
}

function inferBrand(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  for (const line of lines) {
    if (line.length < 2 || line.length > 30) {
      continue;
    }

    if (/\d|%|made in|wash|care|polyester|cotton|rayon|spandex/i.test(line)) {
      continue;
    }

    return line;
  }

  return undefined;
}

export async function readClothingLabelText(image: Buffer): Promise<string> {
  if (!image.length) {
    throw new Error('Image buffer is empty');
  }

  const client = getVisionClient();
  const [result] = await client.documentTextDetection({
    image: { content: image },
  });

  const text =
    result.fullTextAnnotation?.text ??
    result.textAnnotations?.[0]?.description ??
    '';

  return text;
}

export async function readClothingLabel(
  image: Buffer,
): Promise<Partial<Garment>> {
  const text = await readClothingLabelText(image);
  return parseClothingLabelText(text);
}

export function parseClothingLabelText(text: string): Partial<Garment> {
  if (!text.trim()) {
    return {
      fibers: [],
      origin: null,
      category: null,
    };
  }

  return {
    fibers: extractFibers(text),
    origin: extractOrigin(text),
    category: inferCategory(text),
    brand: inferBrand(text),
  };
}

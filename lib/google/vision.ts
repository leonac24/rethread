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

// Words that signal the end of a fiber name (start of label boilerplate)
const FIBER_STOP_RE = /\s+(?:made|fabric|fabriqu|body|shell|lining|trim|content|exclusive|outer|import|origin|hand|wash|dry|iron|do\s+not|machine|tumble)\b.*/i;

function trimFiberName(raw: string): string {
  return raw.replace(FIBER_STOP_RE, '').trim();
}

function normalizeMaterial(raw: string): string {
  const trimmed = trimFiberName(raw);
  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
  return MATERIAL_SYNONYMS[normalized] ?? normalized;
}

// English consonant clusters that validly start a word.
// Used to detect single-char OCR artifacts (e.g. ® → "B") glued to a brand name.
const VALID_CLUSTERS = new Set([
  'BL','BR','CH','CL','CR','DR','DW','FL','FR','GH','GL','GR',
  'KN','PH','PL','PR','SC','SH','SK','SL','SM','SN','SP','SQ',
  'ST','SW','TH','TR','TW','WH','WR',
]);
const VOWELS = new Set(['A','E','I','O','U']);

function stripBrandArtifact(s: string): string {
  if (!s.includes(' ')) return s; // Only strip from multi-word strings
  const firstWord = s.split(/\s+/)[0];
  if (firstWord.length < 3) return s;
  const c1 = firstWord[0].toUpperCase();
  const c2 = firstWord[1].toUpperCase();
  if (
    /[A-Z]/.test(c1) && /[A-Z]/.test(c2) &&
    !VOWELS.has(c1) && !VOWELS.has(c2) &&
    !VALID_CLUSTERS.has(c1 + c2)
  ) {
    return s.slice(1);
  }
  return s;
}

function extractFibers(text: string): Garment['fibers'] {
  const fibers: Garment['fibers'] = [];
  const seen = new Set<string>();

  // Pattern 1: "80% cotton" — standard forward format
  // Limit material capture to 30 chars; stop-word trimming handles the rest
  const forwardMatches = text.matchAll(/(\d{1,3})\s*%\s*([a-z][a-z\-\s]{1,30})/gi);
  for (const match of forwardMatches) {
    const percentage = Number(match[1]);
    const material = normalizeMaterial(match[2]);
    if (!material || Number.isNaN(percentage) || percentage < 1 || percentage > 100) continue;
    if (seen.has(material)) continue;
    fibers.push({ material, percentage });
    seen.add(material);
  }

  // Pattern 2: "cotton (80%)" — reverse format
  const reverseMatches = text.matchAll(/([a-z][a-z\-\s]{1,30})\s*\((\d{1,3})\s*%\)/gi);
  for (const match of reverseMatches) {
    const percentage = Number(match[2]);
    const material = normalizeMaterial(match[1]);
    if (!material || Number.isNaN(percentage) || percentage < 1 || percentage > 100) continue;
    if (seen.has(material)) continue;
    fibers.push({ material, percentage });
    seen.add(material);
  }

  // If percentages sum over 100 (e.g. multi-section label), scale proportionally
  const total = fibers.reduce((sum, f) => sum + f.percentage, 0);
  if (total > 100) {
    for (const f of fibers) f.percentage = Math.round((f.percentage / total) * 100);
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
    if (line.length < 2 || line.length > 40) continue;
    if (/\d|%|made in|wash|care|polyester|cotton|rayon|spandex/i.test(line)) continue;

    const cleaned = stripBrandArtifact(line);
    if (cleaned.length >= 2) return cleaned;
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

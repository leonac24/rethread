import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { getBrand } from '@/lib/brands';
import { geocodeAddress } from '@/lib/google/places';
import type { PartnerRecord, PartnerType } from '@/types/partner';

const VALID_KINDS = new Set(['partner', 'brand_claim']);
const VALID_TYPES = new Set<PartnerType>(['repair', 'resale', 'donation', 'recycler']);
const BRAND_SLUG_RE = /^[a-z0-9-]{1,80}$/;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Request body must be a JSON object.' }, { status: 400 });
  }

  const raw = body as Record<string, unknown>;

  // Validate kind
  const kind = raw.kind;
  if (typeof kind !== 'string' || !VALID_KINDS.has(kind)) {
    return Response.json(
      { error: "kind must be one of: 'partner', 'brand_claim'." },
      { status: 400 },
    );
  }

  // Validate businessName
  const businessName = raw.businessName;
  if (
    typeof businessName !== 'string' ||
    businessName.length < 2 ||
    businessName.length > 100
  ) {
    return Response.json(
      { error: 'businessName must be a string between 2 and 100 characters.' },
      { status: 400 },
    );
  }

  let partnerType: PartnerType | undefined;
  let address: string | undefined;
  let brandSlug: string | undefined;

  if (kind === 'partner') {
    // Validate type
    const rawType = raw.type;
    if (typeof rawType !== 'string' || !VALID_TYPES.has(rawType as PartnerType)) {
      return Response.json(
        { error: "type must be one of: 'repair', 'resale', 'donation', 'recycler'." },
        { status: 400 },
      );
    }
    partnerType = rawType as PartnerType;

    // Validate optional address
    if (raw.address !== undefined) {
      if (typeof raw.address !== 'string' || raw.address.length > 200) {
        return Response.json(
          { error: 'address must be a string of at most 200 characters.' },
          { status: 400 },
        );
      }
      address = raw.address;
    }
  } else {
    // kind === 'brand_claim'
    const rawSlug = raw.brandSlug;
    if (typeof rawSlug !== 'string' || !BRAND_SLUG_RE.test(rawSlug)) {
      return Response.json(
        { error: 'brandSlug must match /^[a-z0-9-]{1,80}$/.' },
        { status: 400 },
      );
    }
    // Verify the brand exists
    const brand = await getBrand(rawSlug).catch(() => null);
    if (!brand) {
      return Response.json({ error: 'unknown brand' }, { status: 400 });
    }
    brandSlug = rawSlug;
  }

  // Validate evidence
  const rawEvidence = raw.evidence;
  if (!rawEvidence || typeof rawEvidence !== 'object') {
    return Response.json({ error: 'evidence must be an object.' }, { status: 400 });
  }
  const ev = rawEvidence as Record<string, unknown>;

  if (!Array.isArray(ev.links) || ev.links.length > 5) {
    return Response.json(
      { error: 'evidence.links must be an array of at most 5 items.' },
      { status: 400 },
    );
  }
  for (const link of ev.links) {
    if (
      typeof link !== 'string' ||
      !link.startsWith('https://') ||
      link.length > 300
    ) {
      return Response.json(
        { error: 'Each evidence link must start with https:// and be at most 300 characters.' },
        { status: 400 },
      );
    }
  }
  if (typeof ev.text !== 'string' || ev.text.length > 2000) {
    return Response.json(
      { error: 'evidence.text must be a string of at most 2000 characters.' },
      { status: 400 },
    );
  }

  // Validate optional discountPct (only meaningful for 'partner', but accepted for any)
  let discountPct = 5;
  if (raw.discountPct !== undefined) {
    const d = Number(raw.discountPct);
    if (!Number.isFinite(d)) {
      return Response.json(
        { error: 'discountPct must be a number.' },
        { status: 400 },
      );
    }
    discountPct = Math.max(0, Math.min(20, d));
  }

  // Geocode if partner + address provided
  let placeId: string | undefined;
  let lat: number | undefined;
  let lng: number | undefined;

  if (kind === 'partner' && address) {
    const geo = await geocodeAddress(address);
    if (geo) {
      placeId = geo.placeId;
      lat = geo.lat;
      lng = geo.lng;
    }
    // On failure, proceed without coordinates — application still accepted
  }

  // Build the record — status is always server-set to 'pending'
  const record: PartnerRecord = {
    kind: kind as 'partner' | 'brand_claim',
    businessName,
    evidence: { links: ev.links as string[], text: ev.text as string },
    discountPct,
    status: 'pending',
    appliedAt: Date.now(),
    ...(partnerType !== undefined ? { type: partnerType } : {}),
    ...(address !== undefined ? { address } : {}),
    ...(placeId !== undefined ? { placeId } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(lng !== undefined ? { lng } : {}),
    ...(brandSlug !== undefined ? { brandSlug } : {}),
  };

  try {
    await db().collection('partners').doc(user.uid).create(record);
  } catch (err: unknown) {
    // Firestore ALREADY_EXISTS — code 6
    const code = (err as { code?: number }).code;
    if (code === 6) {
      return Response.json({ error: 'Application already exists.' }, { status: 409 });
    }
    console.error('[partners/apply] Firestore write failed', {
      uid: user.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to save application.' }, { status: 500 });
  }

  return Response.json({ status: 'pending' }, { status: 201 });
}

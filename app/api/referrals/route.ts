import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { getScanById } from '@/lib/scan-store';
import { issueReferral } from '@/lib/referrals';
import type { PartnerRecord } from '@/types/partner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Missing required fields: scanId, partnerId.' }, { status: 400 });
  }

  const { scanId, partnerId } = body as Record<string, unknown>;

  if (typeof scanId !== 'string' || !scanId) {
    return Response.json({ error: 'Missing required field: scanId.' }, { status: 400 });
  }
  if (typeof partnerId !== 'string' || !partnerId) {
    return Response.json({ error: 'Missing required field: partnerId.' }, { status: 400 });
  }
  if (!UUID_RE.test(scanId)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  // Validate scan exists.
  const scan = await getScanById(scanId);
  if (!scan) {
    return Response.json({ error: 'Scan not found.' }, { status: 404 });
  }

  // Validate partner exists, is verified, and is of kind 'partner'.
  const partnerSnap = await db().collection('partners').doc(partnerId).get();
  if (!partnerSnap.exists) {
    return Response.json({ error: 'Partner not available.' }, { status: 403 });
  }
  const partner = partnerSnap.data() as PartnerRecord;
  if (partner.status !== 'verified' || partner.kind !== 'partner') {
    return Response.json({ error: 'Partner not available.' }, { status: 403 });
  }

  // Auth is optional — attach userId only when token is valid.
  const user = await verifyBearerToken(request);
  const userId = user?.uid;

  const discountPct = partner.discountPct ?? 5;
  const { code, expiresAt } = await issueReferral({ partnerId, scanId, userId, discountPct });

  const origin = new URL(request.url).origin;
  const url = `${origin}/redeem/${code}`;

  return Response.json({ code, url, discountPct, expiresAt }, { status: 201 });
}

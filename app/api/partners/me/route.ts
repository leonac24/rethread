import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import type { PartnerRecord } from '@/types/partner';

export async function GET(request: Request) {
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

  try {
    const snap = await db().collection('partners').doc(user.uid).get();
    if (!snap.exists) {
      return Response.json({ error: 'No application found.' }, { status: 404 });
    }
    return Response.json(snap.data() as PartnerRecord, { status: 200 });
  } catch (err: unknown) {
    console.error('[partners/me] Firestore read failed', {
      uid: user.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to fetch application.' }, { status: 500 });
  }
}

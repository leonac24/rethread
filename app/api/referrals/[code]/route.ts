import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { db } from '@/lib/firebase/admin';
import { CODE_RE } from '@/lib/referrals';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  const { code } = await params;

  if (!CODE_RE.test(code)) {
    return Response.json({ error: 'Invalid referral code format.' }, { status: 400 });
  }

  const snap = await db().collection('referrals').doc(code).get();
  if (!snap.exists) {
    return Response.json({ error: 'Code not found.' }, { status: 404 });
  }

  const referral = snap.data()!;

  // Fetch partner businessName — guard against missing partner doc.
  let businessName = 'Unknown business';
  if (referral.partnerId) {
    try {
      const partnerSnap = await db().collection('partners').doc(referral.partnerId).get();
      if (partnerSnap.exists) {
        businessName = (partnerSnap.data() as { businessName?: string }).businessName ?? 'Unknown business';
      }
    } catch {
      // Non-fatal — fall back to 'Unknown business'.
    }
  }

  // Compute expiry dynamically — referral docs are never flipped to 'expired' in storage.
  // Guard malformed data: if expiresAt is missing or lacks .toMillis, treat as expired.
  const expired =
    referral.status !== 'redeemed' &&
    (!referral.expiresAt?.toMillis || referral.expiresAt.toMillis() < Date.now());

  const status =
    referral.status === 'redeemed' ? 'redeemed' : expired ? 'expired' : 'issued';

  const expiresAt: number | null =
    referral.expiresAt?.toMillis ? referral.expiresAt.toMillis() : null;

  // No userId/scanId in the response — no user data exposure.
  return Response.json(
    {
      businessName,
      discountPct: referral.discountPct,
      status,
      expiresAt,
    },
    { status: 200 },
  );
}

import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { CODE_RE, redeemReferral } from '@/lib/referrals';
import type { PartnerRecord } from '@/types/partner';

export async function POST(
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

  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  // Caller must have a verified partner record.
  const partnerSnap = await db().collection('partners').doc(user.uid).get();
  if (!partnerSnap.exists) {
    return Response.json({ error: 'Not a verified partner.' }, { status: 403 });
  }
  const partner = partnerSnap.data() as PartnerRecord;
  if (partner.status !== 'verified') {
    return Response.json({ error: 'Not a verified partner.' }, { status: 403 });
  }

  const result = await redeemReferral(code, user.uid);

  if (result.ok) {
    return Response.json({ ok: true }, { status: 200 });
  }

  switch (result.reason) {
    case 'not_found':
      return Response.json({ error: 'Referral code not found.' }, { status: 404 });
    case 'wrong_partner':
      return Response.json(
        { error: 'This code belongs to a different business.' },
        { status: 403 },
      );
    case 'already_redeemed':
      return Response.json({ error: 'This code has already been redeemed.' }, { status: 409 });
    case 'expired':
      return Response.json({ error: 'This referral code has expired.' }, { status: 410 });
  }
}

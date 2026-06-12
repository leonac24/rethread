import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { PER_REDEMPTION_USD } from '@/lib/config';

function monthKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function last6MonthKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
  }
  return keys;
}

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
    // Check partner doc exists (any status allowed)
    const partnerSnap = await db().collection('partners').doc(user.uid).get();
    if (!partnerSnap.exists) {
      return Response.json({ error: 'No application found.' }, { status: 404 });
    }
    const partnerData = partnerSnap.data() as { status: string };

    // Query referrals for this partner
    const referralsSnap = await db()
      .collection('referrals')
      .where('partnerId', '==', user.uid)
      .get();

    const months = last6MonthKeys();
    const monthBuckets: Record<string, { issued: number; redeemed: number }> = {};
    for (const key of months) {
      monthBuckets[key] = { issued: 0, redeemed: 0 };
    }

    let issued = 0;
    let redeemed = 0;

    for (const doc of referralsSnap.docs) {
      const data = doc.data() as {
        status?: string;
        createdAt?: { toMillis?: () => number } | null;
      };

      issued++;
      if (data.status === 'redeemed') redeemed++;

      // Bucket into monthly — skip malformed createdAt
      let ms: number | null = null;
      try {
        if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
          ms = data.createdAt.toMillis();
        }
      } catch {
        ms = null;
      }

      if (ms !== null) {
        const key = monthKey(ms);
        if (monthBuckets[key]) {
          monthBuckets[key].issued++;
          if (data.status === 'redeemed') monthBuckets[key].redeemed++;
        }
      }
    }

    const conversionPct = issued ? Math.round((redeemed / issued) * 100) : 0;
    const estimatedOwed = Math.round(redeemed * PER_REDEMPTION_USD * 100) / 100;
    const monthly = months.map((month) => ({
      month,
      issued: monthBuckets[month].issued,
      redeemed: monthBuckets[month].redeemed,
    }));

    return Response.json(
      { issued, redeemed, conversionPct, monthly, estimatedOwed, status: partnerData.status },
      { status: 200 },
    );
  } catch (err: unknown) {
    console.error('[partners/stats] Firestore read failed', {
      uid: user.uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to fetch stats.' }, { status: 500 });
  }
}

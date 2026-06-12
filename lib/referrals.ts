import { randomBytes } from 'node:crypto';
import { db } from '@/lib/firebase/admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export const REFERRAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODE_RE = /^[A-Za-z0-9_-]{8}$/;

export type ReferralStatus = 'issued' | 'redeemed' | 'expired';

export function newCode(): string {
  return randomBytes(6).toString('base64url').slice(0, 8);
}

export async function issueReferral(args: {
  partnerId: string;
  scanId: string;
  userId?: string;
  discountPct: number;
}): Promise<{ code: string; expiresAt: number }> {
  const { partnerId, scanId, userId, discountPct } = args;
  const expiresAt = Timestamp.fromMillis(Date.now() + REFERRAL_TTL_MS);

  const doc = {
    partnerId,
    scanId,
    discountPct,
    status: 'issued' as ReferralStatus,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    ...(userId ? { userId } : {}),
  };

  // Retry once on the astronomically-unlikely code collision (.create throws ALREADY_EXISTS, code 6).
  for (let attempt = 0; attempt < 2; attempt++) {
    const code = newCode();
    try {
      await db().collection('referrals').doc(code).create(doc);
      return { code, expiresAt: expiresAt.toMillis() };
    } catch (err: unknown) {
      const isCollision =
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: number }).code === 6;
      if (isCollision && attempt === 0) continue;
      throw err;
    }
  }

  // Should never reach here — TypeScript needs a return path.
  throw new Error('Failed to generate a unique referral code.');
}

// Transactional redeem: only the matching verified partner, only once, only unexpired.
export async function redeemReferral(
  code: string,
  partnerUid: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'wrong_partner' | 'already_redeemed' | 'expired' }
> {
  const ref = db().collection('referrals').doc(code);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, reason: 'not_found' as const };
    const r = snap.data()!;
    if (r.partnerId !== partnerUid) return { ok: false as const, reason: 'wrong_partner' as const };
    if (r.status === 'redeemed') return { ok: false as const, reason: 'already_redeemed' as const };
    if (r.expiresAt.toMillis() < Date.now()) return { ok: false as const, reason: 'expired' as const };
    tx.update(ref, { status: 'redeemed', redeemedAt: FieldValue.serverTimestamp() });
    return { ok: true as const };
  });
}

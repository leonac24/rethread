import { db } from '@/lib/firebase/admin';
import type { PartnerRecord } from '@/types/partner';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheEntry = {
  partners: Array<{ id: string } & PartnerRecord>;
  cachedAt: number;
};

let cache: CacheEntry | null = null;

export async function getVerifiedPartners(): Promise<Array<{ id: string } & PartnerRecord>> {
  const now = Date.now();

  if (cache && now - cache.cachedAt < CACHE_TTL_MS) {
    return cache.partners;
  }

  const snapshot = await db()
    .collection('partners')
    .where('status', '==', 'verified')
    .get();

  const partners: Array<{ id: string } & PartnerRecord> = snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as PartnerRecord) }))
    .filter((p) => p.kind === 'partner');

  cache = { partners, cachedAt: now };
  return partners;
}

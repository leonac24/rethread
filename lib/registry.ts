// Internal evidence stream — no public UI in v1. One doc per garment "spec".
import { createHash } from 'node:crypto';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Fiber } from '@/types/garment';
import type { GarmentScore } from '@/lib/score/garment';

export function specId(category: string | null, fibers: Fiber[], origin: string | null, brandSlug?: string): string {
  const fiberKey = [...fibers]
    .sort((a, b) => a.material.localeCompare(b.material))
    .map((f) => `${f.material.toLowerCase()}:${f.percentage}`)
    .join(',');
  return createHash('sha1')
    .update(`${(category ?? '').toLowerCase()}|${fiberKey}|${(origin ?? '').toLowerCase()}|${brandSlug ?? ''}`)
    .digest('hex')
    .slice(0, 16);
}

export async function upsertRegistryEntry(args: {
  category: string | null; fibers: Fiber[]; origin: string | null; brandSlug?: string; score: GarmentScore;
}): Promise<void> {
  const id = specId(args.category, args.fibers, args.origin, args.brandSlug);
  await db().collection('registry').doc(id).set(
    {
      category: args.category, fibers: args.fibers, origin: args.origin,
      ...(args.brandSlug ? { brandSlug: args.brandSlug } : {}),
      score: args.score.score, grade: args.score.grade, subScores: args.score.subScores,
      scanCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
}

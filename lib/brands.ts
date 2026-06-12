import { db } from '@/lib/firebase/admin';
import { computeBrandScore, kappaForStatus, slugifyBrand, updateProductImpact } from '@/lib/score/brand';
import type { BrandRecord } from '@/types/brand';
import { FieldValue } from 'firebase-admin/firestore';

export async function getBrand(slug: string): Promise<BrandRecord | null> {
  const snap = await db().collection('brands').doc(slug).get();
  return snap.exists ? (snap.data() as BrandRecord) : null;
}

export async function listBrands(): Promise<BrandRecord[]> {
  const snap = await db().collection('brands').orderBy('score', 'desc').limit(200).get();
  return snap.docs.map((d) => d.data() as BrandRecord);
}

// Resolve a Gemini-extracted brand name to a record: try slug as doc id,
// then alias match. Unmatched names are queued in brand_candidates for later.
export async function resolveBrand(name: string): Promise<BrandRecord | null> {
  const slug = slugifyBrand(name);
  if (!slug) return null;
  const direct = await getBrand(slug);
  if (direct) return direct;
  const byAlias = await db().collection('brands').where('aliases', 'array-contains', slug).limit(1).get();
  if (!byAlias.empty) return byAlias.docs[0].data() as BrandRecord;
  await db().collection('brand_candidates').doc(slug).set(
    { name, slug, seen: FieldValue.increment(1), lastSeenAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return null;
}

// Record one garment scan as evidence in a transaction; recompute productImpact + headline.
export async function recordScanEvidence(slug: string, garmentScore: number): Promise<void> {
  const ref = db().collection('brands').doc(slug);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const b = snap.data() as BrandRecord;
    const pi = { ...b.dims.productImpact, n: b.dims.productImpact.n + 1, sum: b.dims.productImpact.sum + garmentScore };
    pi.kappa = kappaForStatus(b.status);
    pi.current = updateProductImpact(pi);
    const { score, grade } = computeBrandScore({ productImpact: pi.current, transparency: b.dims.transparency, laborSupplyChain: b.dims.laborSupplyChain });
    tx.update(ref, { 'dims.productImpact': pi, score, grade, updatedAt: FieldValue.serverTimestamp() });
  });
}

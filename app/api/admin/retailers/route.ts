// GET /api/admin/retailers
// Pending retailer applications for the bare-bones admin page.
// ⚠ Deliberately unauthenticated per current MVP scope — anyone with the URL
// can read pending applications. Lock this down before real users arrive.

import { db } from '@/lib/firebase/admin';

function toMillis(v: unknown): number {
  return v && typeof (v as { toMillis?: () => number }).toMillis === 'function'
    ? (v as { toMillis: () => number }).toMillis()
    : 0;
}

export async function GET() {
  try {
    const snapshot = await db()
      .collection('users')
      .where('retailer.status', '==', 'pending')
      .get();

    const applications = snapshot.docs.map((doc) => {
      const data = doc.data();
      const r = (data.retailer ?? {}) as Record<string, unknown>;
      return {
        uid: doc.id,
        email: data.email ?? null,
        storeName: r.storeName ?? null,
        street1: r.street1 ?? null,
        city: r.city ?? null,
        state: r.state ?? null,
        zip: r.zip ?? null,
        phone: r.phone ?? null,
        appliedAt: toMillis(r.appliedAt),
      };
    });

    return Response.json({ applications });
  } catch (err) {
    console.error('[admin/retailers] Firestore error', {
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve applications.' }, { status: 500 });
  }
}

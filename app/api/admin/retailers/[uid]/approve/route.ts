// POST /api/admin/retailers/[uid]/approve
// Flips a pending retailer application to approved. Idempotent.
// ⚠ Deliberately unauthenticated per current MVP scope — lock down before launch.

import { db } from '@/lib/firebase/admin';

// Firebase UIDs are alphanumeric by default, but custom UIDs may include - and _.
// No '/' means no Firestore path traversal.
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uid: string }> },
) {
  const { uid } = await params;

  if (!UID_RE.test(uid)) {
    return Response.json({ error: 'Invalid user ID format.' }, { status: 400 });
  }

  try {
    const userRef = db().collection('users').doc(uid);
    const snap = await userRef.get();
    const data = snap.exists ? snap.data()! : null;
    if (!data || data.role !== 'retailer' || !data.retailer) {
      return Response.json({ error: 'No retailer application found.' }, { status: 404 });
    }

    if (data.retailer.status !== 'approved') {
      await userRef.update({ 'retailer.status': 'approved' });
    }

    return Response.json({ uid, status: 'approved' });
  } catch (err) {
    console.error('[admin/retailers approve] Firestore error', {
      uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to approve application.' }, { status: 500 });
  }
}

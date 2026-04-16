import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import type { OutcomeAction, ScanResult } from '@/types/garment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ scanId: string }> },
) {
  const { scanId } = await params;

  if (!UUID_RE.test(scanId)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const user = await verifyBearerToken(request);
  if (!user) {
    return Response.json({ error: 'Authentication required.' }, { status: 401 });
  }

  try {
    const doc = await db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .doc(scanId)
      .get();

    if (!doc.exists) {
      return Response.json({ error: 'Scan not found.' }, { status: 404 });
    }

    const data = doc.data() as {
      scanId: string;
      action: OutcomeAction;
      result: ScanResult;
      text: string;
      createdAt?: FirebaseFirestore.Timestamp;
    };

    return Response.json({
      scanId: data.scanId,
      action: data.action,
      result: data.result,
      text: data.text,
      createdAt: data.createdAt?.toMillis() ?? 0,
    });
  } catch (err) {
    console.error('[user/scans/:scanId] Firestore error', {
      uid: user.uid,
      scanId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to retrieve scan.' }, { status: 500 });
  }
}

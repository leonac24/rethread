import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db, adminStorage } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
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
      imageUrls?: string[];
    };

    return Response.json({
      scanId: data.scanId,
      action: data.action,
      result: data.result,
      text: data.text,
      createdAt: data.createdAt?.toMillis() ?? 0,
      imageUrls: data.imageUrls ?? [],
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

export async function DELETE(
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
    const scanRef = db()
      .collection('users')
      .doc(user.uid)
      .collection('scans')
      .doc(scanId);

    const scanSnap = await scanRef.get();
    if (!scanSnap.exists) {
      return Response.json({ error: 'Scan not found.' }, { status: 404 });
    }

    const scanData = scanSnap.data() as {
      result?: ScanResult;
    };
    const co2Kg = scanData.result?.cost?.co2_kg ?? 0;
    const waterLiters = scanData.result?.cost?.water_liters ?? 0;

    const outcomeSnap = await db()
      .collection('outcomes')
      .where('userId', '==', user.uid)
      .where('scanId', '==', scanId)
      .get();

    const batch = db().batch();
    batch.delete(scanRef);
    outcomeSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.set(
      db().collection('users').doc(user.uid),
      {
        totalCO2SavedKg: FieldValue.increment(-co2Kg),
        totalWaterSavedLiters: FieldValue.increment(-waterLiters),
        actionCount: FieldValue.increment(-1),
      },
      { merge: true },
    );
    await batch.commit();

    try {
      await adminStorage()
        .bucket()
        .deleteFiles({ prefix: `scans/${user.uid}/${scanId}/` });
    } catch (storageErr) {
      console.error('[user/scans/:scanId DELETE] storage cleanup failed', {
        uid: user.uid,
        scanId,
        err: storageErr instanceof Error ? storageErr.message : String(storageErr),
      });
    }

    return Response.json({ deleted: true }, { status: 200 });
  } catch (err) {
    console.error('[user/scans/:scanId DELETE] Firestore error', {
      uid: user.uid,
      scanId,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to delete scan.' }, { status: 500 });
  }
}

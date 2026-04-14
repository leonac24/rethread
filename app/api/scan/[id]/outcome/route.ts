import { recordOutcome } from '@/lib/scan-store';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { verifyBearerToken } from '@/lib/firebase/verify-token';
import { db } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { OutcomeAction } from '@/types/garment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set<OutcomeAction>(['throw_away', 'repair', 'list', 'donate']);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return Response.json({ error: 'Invalid scan ID format.' }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('action' in body)) {
    return Response.json({ error: 'Missing required field: action.' }, { status: 400 });
  }

  const action = (body as Record<string, unknown>).action;
  if (typeof action !== 'string' || !VALID_ACTIONS.has(action as OutcomeAction)) {
    return Response.json(
      { error: 'action must be one of: throw_away, repair, list, donate.' },
      { status: 400 },
    );
  }

  const { conflict, stored } = await recordOutcome(id, action as OutcomeAction);

  if (!stored) {
    return Response.json({ error: 'Scan not found.' }, { status: 404 });
  }
  if (conflict) {
    return Response.json({ error: 'Outcome already recorded for this scan.' }, { status: 409 });
  }

  // If the user is authenticated and didn't throw the item away, credit their totals.
  // verifyBearerToken returns null for unauthenticated requests — outcome still records.
  const user = await verifyBearerToken(request);
  if (user && action !== 'throw_away') {
    const co2Kg = stored.result.cost.co2_kg;
    const waterLiters = stored.result.cost.water_liters;

    const outcomeRef = db().collection('outcomes').doc();
    const userRef = db().collection('users').doc(user.uid);

    // Atomic batch — both writes succeed or both fail
    const batch = db().batch();
    batch.set(outcomeRef, {
      userId: user.uid,
      scanId: id,
      action,
      co2Kg,
      waterLiters,
      createdAt: FieldValue.serverTimestamp(),
    });
    batch.update(userRef, {
      totalCO2SavedKg: FieldValue.increment(co2Kg),
      totalWaterSavedLiters: FieldValue.increment(waterLiters),
      actionCount: FieldValue.increment(1),
    });

    await batch.commit();
  }

  return Response.json({ id, outcome: stored.outcome }, { status: 200 });
}

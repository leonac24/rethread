// Firebase Admin SDK — server-side only.
// getAdminApp() is called lazily so missing env vars surface at request time,
// not at module load (which would crash the whole server on startup).

import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

function getAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!raw) throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable.');

  let credentials: object;
  try {
    credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is not valid base64-encoded JSON.');
  }

  return initializeApp({ credential: cert(credentials as Parameters<typeof cert>[0]) });
}

export function adminAuth() {
  return getAuth(getAdminApp());
}

export function db() {
  return getFirestore(getAdminApp());
}

export function adminStorage() {
  return getStorage(getAdminApp());
}

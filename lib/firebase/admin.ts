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

  // Without storageBucket, adminStorage().bucket() throws — server-side
  // uploads and delete-cleanup both need it. Prefer the same bucket the
  // client SDK uses; fall back to the project's legacy default name.
  const projectId = (credentials as { project_id?: string }).project_id;
  const storageBucket =
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    (projectId ? `${projectId}.appspot.com` : undefined);

  return initializeApp({
    credential: cert(credentials as Parameters<typeof cert>[0]),
    ...(storageBucket ? { storageBucket } : {}),
  });
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

// Resolve the bucket name independently of app-init options: the Admin app
// singleton survives dev hot-reloads, so an instance created before
// storageBucket was configured would otherwise poison every bucket() call.
// Pass this explicitly: adminStorage().bucket(storageBucketName()).
export function storageBucketName(): string {
  const fromEnv = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  if (fromEnv) return fromEnv;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (raw) {
    try {
      const { project_id } = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as {
        project_id?: string;
      };
      // New Firebase projects use the .firebasestorage.app default bucket.
      if (project_id) return `${project_id}.firebasestorage.app`;
    } catch {
      // fall through
    }
  }
  throw new Error('Cannot resolve storage bucket: set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET.');
}

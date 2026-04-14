// Verify a Firebase ID token from the Authorization: Bearer header.
// Returns the verified user's uid + email, or null if the token is
// missing, malformed, or expired. Callers decide whether to reject or allow anonymous.

import { adminAuth } from '@/lib/firebase/admin';

export type VerifiedUser = {
  uid: string;
  email: string | undefined;
};

export async function verifyBearerToken(
  request: Request,
): Promise<VerifiedUser | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7).trim();
  if (!token) return null;

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email };
  } catch {
    // Invalid, expired, or revoked token — treat as unauthenticated
    return null;
  }
}

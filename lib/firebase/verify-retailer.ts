// Verify that a request comes from an approved retailer.
// Verifies the bearer token, then loads users/{uid} and returns the flattened
// retailer profile — or null if unauthenticated, not a retailer, or not approved.

import { db } from '@/lib/firebase/admin';
import { verifyBearerToken } from './verify-token';

export type VerifiedRetailer = {
  uid: string;
  storeName: string;
  phone: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

export async function verifyApprovedRetailer(
  request: Request,
): Promise<VerifiedRetailer | null> {
  const user = await verifyBearerToken(request);
  if (!user) return null;

  try {
    const doc = await db().collection('users').doc(user.uid).get();
    if (!doc.exists) return null;

    const data = doc.data();
    if (data?.role !== 'retailer' || data.retailer?.status !== 'approved') return null;

    const profile = data.retailer;
    return {
      uid: user.uid,
      storeName: profile.storeName,
      phone: profile.phone,
      street1: profile.street1,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
      lat: profile.lat ?? null,
      lng: profile.lng ?? null,
    };
  } catch {
    // Firestore unavailable — treat as unauthorized rather than crashing the route
    return null;
  }
}

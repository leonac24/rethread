// Pure marketplace helpers — no Firebase or network dependencies.

// Firestore auto-generated document IDs are 20 alphanumeric chars; allow a
// small range so hand-written fixtures pass too. Guards path traversal.
export const FIRESTORE_ID_RE = /^[A-Za-z0-9]{10,30}$/;

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Two decimals ≈ 1.1 km — coarse enough that a listing never reveals a home address.
export function roundCoord(v: number): number {
  return Math.round(v * 100) / 100;
}

// Unambiguous alphabet: no I, O, 0, 1.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateDropoffCode(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (v) => CODE_ALPHABET[v % CODE_ALPHABET.length]).join('');
}

import type { Garment } from '@/types/garment';

// Cloud Vision — OCR a care-label photo.

export async function readClothingLabel(
  _image: Buffer,
): Promise<Partial<Garment>> {
  throw new Error('Not implemented');
}

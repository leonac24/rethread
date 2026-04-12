import type { Garment } from '@/types/garment';

// Document AI — parse a receipt or order confirmation.

export async function parseReceipt(
  _document: Buffer,
): Promise<Partial<Garment>> {
  throw new Error('Not implemented');
}

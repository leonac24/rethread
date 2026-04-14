import type { Garment } from '@/types/garment';
import { log } from '@/lib/logger';

// Document AI — parse a receipt or order confirmation.
// Not yet implemented — returns empty partial rather than throwing.

export async function parseReceipt(
  _document: Buffer,
): Promise<Partial<Garment>> {
  log.warn('parseReceipt called but Document AI is not yet implemented');
  return {};
}

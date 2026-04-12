import type { EnvironmentalCost, Garment } from '@/types/garment';

// Gemini — structured environmental-cost reasoning.
// Enforce responseSchema so output always matches EnvironmentalCost.

export async function computeCost(
  _garment: Garment,
  _brandContext?: string,
): Promise<EnvironmentalCost> {
  throw new Error('Not implemented');
}

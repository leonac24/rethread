// Shippo — shipping label purchase for accepted marketplace deals.
// Server-side only. Requires SHIPPO_API_KEY env var (test-mode keys work in development).
// Deliberately a SINGLE attempt with no retry: purchasing a label moves money,
// and a retried timeout could buy two labels.

import { SHIPPO_TIMEOUT_MS } from '@/lib/config';

export type ShippoAddress = {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
  country?: string;
  phone?: string;
};

export type PurchasedLabel = {
  labelUrl: string;
  trackingNumber: string;
  carrier: string;
};

type Parcel = { length: number; width: number; height: number; weight: number };

// Default parcel dimensions (inches) and weight (lb) per garment category.
// Exported for tests.
export const PARCEL_DEFAULTS: Record<string, Parcel> = {
  coat: { length: 16, width: 12, height: 6, weight: 2.5 },
  jacket: { length: 16, width: 12, height: 6, weight: 2.5 },
  shoes: { length: 14, width: 10, height: 6, weight: 3 },
  jeans: { length: 12, width: 10, height: 4, weight: 1.5 },
  pants: { length: 12, width: 10, height: 4, weight: 1.5 },
  skirt: { length: 12, width: 10, height: 4, weight: 1.5 },
  default: { length: 12, width: 10, height: 4, weight: 1 },
};

function parcelFor(category: string | null): Parcel {
  const key = category?.trim().toLowerCase() ?? '';
  return PARCEL_DEFAULTS[key] ?? PARCEL_DEFAULTS.default;
}

type ShippoRate = { object_id: string; amount: string; provider: string };
type ShipmentResponse = { rates?: ShippoRate[] };
type TransactionResponse = {
  status?: string;
  label_url?: string;
  tracking_number?: string;
  messages?: { text?: string }[];
};

export async function purchaseLabel(
  from: ShippoAddress,
  to: ShippoAddress,
  category: string | null,
): Promise<PurchasedLabel> {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) throw new Error('SHIPPO_API_KEY is not set.');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `ShippoToken ${apiKey}`,
  };
  const parcel = parcelFor(category);

  const shipmentRes = await fetch('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      address_from: { ...from, country: from.country ?? 'US' },
      address_to: { ...to, country: to.country ?? 'US' },
      parcels: [{
        length: String(parcel.length),
        width: String(parcel.width),
        height: String(parcel.height),
        weight: String(parcel.weight),
        distance_unit: 'in',
        mass_unit: 'lb',
      }],
      async: false,
    }),
    signal: AbortSignal.timeout(SHIPPO_TIMEOUT_MS),
  });

  if (!shipmentRes.ok) {
    throw new Error(`Shippo shipment request failed (${shipmentRes.status}).`);
  }

  const shipment = await shipmentRes.json() as ShipmentResponse;
  const rates = shipment.rates ?? [];
  if (rates.length === 0) throw new Error('Shippo returned no rates.');

  const rate = rates.reduce((best, r) =>
    parseFloat(r.amount) < parseFloat(best.amount) ? r : best,
  );

  const transactionRes = await fetch('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers,
    body: JSON.stringify({ rate: rate.object_id, label_file_type: 'PDF', async: false }),
    signal: AbortSignal.timeout(SHIPPO_TIMEOUT_MS),
  });

  if (!transactionRes.ok) {
    throw new Error(`Shippo transaction request failed (${transactionRes.status}).`);
  }

  const transaction = await transactionRes.json() as TransactionResponse;
  if (transaction.status !== 'SUCCESS') {
    const message = transaction.messages
      ?.map((m) => m.text)
      .filter(Boolean)
      .join(' ');
    throw new Error(message || 'Shippo label purchase failed.');
  }

  return {
    labelUrl: transaction.label_url ?? '',
    trackingNumber: transaction.tracking_number ?? '',
    carrier: rate.provider,
  };
}

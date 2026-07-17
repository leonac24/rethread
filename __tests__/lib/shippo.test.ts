import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { purchaseLabel, PARCEL_DEFAULTS, type ShippoAddress } from '../../lib/shippo';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const FROM: ShippoAddress = {
  name: 'Jae Bird',
  street1: '1 Sender St',
  city: 'Portland',
  state: 'OR',
  zip: '97201',
};

const TO: ShippoAddress = {
  name: 'Second Stitch',
  street1: '12 Thread Ln',
  city: 'Portland',
  state: 'OR',
  zip: '97209',
  phone: '555-0100',
};

const THREE_RATES = [
  { object_id: 'rate-usps', amount: '12.50', provider: 'USPS' },
  { object_id: 'rate-ups', amount: '7.25', provider: 'UPS' },
  { object_id: 'rate-fedex', amount: '9.99', provider: 'FedEx' },
];

const SUCCESS_TRANSACTION = {
  status: 'SUCCESS',
  label_url: 'https://shippo-delivery.s3.amazonaws.com/label.pdf',
  tracking_number: '1Z999AA10123456784',
};

// ─── Fetch mocking ────────────────────────────────────────────────────────────

type FetchCall = { url: string; body: Record<string, unknown> };

const originalFetch = globalThis.fetch;

/** Replace globalThis.fetch; routes by URL and records each call's parsed body. */
function mockShippoFetch(
  shipmentResponse: { status?: number; json: unknown },
  transactionResponse: { status?: number; json: unknown } = { json: SUCCESS_TRANSACTION },
): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const res = url.includes('/transactions') ? transactionResponse : shipmentResponse;
    return new Response(JSON.stringify(res.json), { status: res.status ?? 200 });
  }) as unknown as typeof fetch;
  return calls;
}

describe('purchaseLabel', () => {
  beforeEach(() => {
    process.env.SHIPPO_API_KEY = 'shippo_test_key';
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('picks the cheapest of three rates and purchases it', async () => {
    const calls = mockShippoFetch({ json: { rates: THREE_RATES } });

    const label = await purchaseLabel(FROM, TO, null);

    expect(label).toEqual({
      labelUrl: SUCCESS_TRANSACTION.label_url,
      trackingNumber: SUCCESS_TRANSACTION.tracking_number,
      carrier: 'UPS',
    });
    const transactionCall = calls.find((c) => c.url.includes('/transactions'));
    expect(transactionCall?.body.rate).toBe('rate-ups');
  });

  it('throws with Shippo message text when the transaction errors', async () => {
    mockShippoFetch(
      { json: { rates: THREE_RATES } },
      { json: { status: 'ERROR', messages: [{ text: 'Address is invalid.' }] } },
    );

    await expect(purchaseLabel(FROM, TO, null)).rejects.toThrow('Address is invalid.');
  });

  it('throws when the shipment returns no rates', async () => {
    mockShippoFetch({ json: { rates: [] } });

    await expect(purchaseLabel(FROM, TO, null)).rejects.toThrow('Shippo returned no rates.');
  });

  it("category 'Coat' sends the outerwear parcel weight (case-insensitive)", async () => {
    const calls = mockShippoFetch({ json: { rates: THREE_RATES } });

    await purchaseLabel(FROM, TO, 'Coat');

    const shipmentCall = calls.find((c) => c.url.includes('/shipments'));
    const parcel = (shipmentCall?.body.parcels as Record<string, string>[])[0];
    expect(parcel.weight).toBe('2.5');
    expect(parcel.length).toBe(String(PARCEL_DEFAULTS.coat.length));
    expect(parcel.distance_unit).toBe('in');
    expect(parcel.mass_unit).toBe('lb');
  });

  it('throws when SHIPPO_API_KEY is missing', async () => {
    delete process.env.SHIPPO_API_KEY;
    const calls = mockShippoFetch({ json: { rates: THREE_RATES } });

    await expect(purchaseLabel(FROM, TO, null)).rejects.toThrow(/SHIPPO_API_KEY/);
    expect(calls.length).toBe(0);
  });
});

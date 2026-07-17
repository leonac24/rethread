// POST /api/listings/[id]/label
// The accepted retailer purchases a prepaid Shippo label for a shipped deal.
// From = the customer's shipFrom address, to = the retailer's store address.
// Shippo failure leaves the deal untouched so the button is retryable.

import { verifyApprovedRetailer } from '@/lib/firebase/verify-retailer';
import { db } from '@/lib/firebase/admin';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { FIRESTORE_ID_RE } from '@/lib/marketplace';
import { purchaseLabel, type ShippoAddress } from '@/lib/shippo';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ip = getClientIp(request);
  const { allowed, retryAfter } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many requests. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(retryAfter ?? 60) } },
    );
  }

  if (!FIRESTORE_ID_RE.test(id)) {
    return Response.json({ error: 'Invalid listing ID format.' }, { status: 400 });
  }

  const retailer = await verifyApprovedRetailer(request);
  if (!retailer) {
    return Response.json({ error: 'Approved retailer account required.' }, { status: 403 });
  }

  try {
    const listingRef = db().collection('listings').doc(id);
    const snap = await listingRef.get();
    const listing = snap.exists ? snap.data()! : null;
    if (!listing || listing.acceptedRetailerUid !== retailer.uid) {
      return Response.json({ error: 'Deal not found.' }, { status: 404 });
    }
    if (listing.status !== 'accepted' || listing.fulfillment !== 'ship') {
      return Response.json(
        { error: 'A label can only be sent for an accepted, shipped deal.' },
        { status: 409 },
      );
    }
    if (listing.shipping) {
      return Response.json({ error: 'A label was already sent for this deal.' }, { status: 409 });
    }
    if (!listing.shipFrom) {
      return Response.json(
        { error: 'Waiting for the customer to add their address.' },
        { status: 400 },
      );
    }

    const from: ShippoAddress = {
      name: listing.shipFrom.name,
      street1: listing.shipFrom.street1,
      city: listing.shipFrom.city,
      state: listing.shipFrom.state,
      zip: listing.shipFrom.zip,
    };
    const to: ShippoAddress = {
      name: retailer.storeName,
      street1: retailer.street1,
      city: retailer.city,
      state: retailer.state,
      zip: retailer.zip,
      phone: retailer.phone,
    };

    let shipping;
    try {
      shipping = await purchaseLabel(from, to, listing.garment?.category ?? null);
    } catch (err) {
      console.error('[listings label] Shippo purchase failed', {
        listingId: id,
        retailerUid: retailer.uid,
        err: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: err instanceof Error ? err.message : 'Label purchase failed.' },
        { status: 502 },
      );
    }

    await listingRef.update({ shipping });

    return Response.json({ shipping });
  } catch (err) {
    console.error('[listings label] Firestore error', {
      listingId: id,
      err: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: 'Failed to send label.' }, { status: 500 });
  }
}

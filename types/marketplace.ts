// Marketplace domain types — retailer roles, listings, offers, fulfillment.
// Listings live in a top-level Firestore collection, denormalized from the
// owner's scan so retailers never read user subcollections.

import type { Fiber, GarmentCondition } from './garment';

export type RetailerStatus = 'pending' | 'approved';

export type StoreAddress = {
  street1: string;
  city: string;
  state: string;
  zip: string;
};

export type RetailerProfile = StoreAddress & {
  storeName: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  status: RetailerStatus;
};

export type ResaleEstimate = {
  low_usd: number;
  high_usd: number;
  confidence: 'high' | 'medium' | 'low';
  factors: string[];
};

export type ListingStatus = 'active' | 'accepted' | 'completed' | 'cancelled';
export type OfferStatus = 'open' | 'accepted' | 'declined' | 'withdrawn';
export type FulfillmentMethod = 'dropoff' | 'ship';

export type ShipFromAddress = {
  name: string;
  street1: string;
  city: string;
  state: string;
  zip: string;
};

export type ListingGarment = {
  brand?: string;
  category?: string;
  color?: string;
  condition?: GarmentCondition;
  fibers: Fiber[];
};

export type Offer = {
  id: string;
  retailerUid: string;
  storeName: string;
  storeLat: number | null;
  storeLng: number | null;
  amountUsd: number;
  note?: string;
  status: OfferStatus;
  createdAt: number;
};

export type Listing = {
  id: string;
  ownerUid: string;
  scanId: string;
  status: ListingStatus;
  garment: ListingGarment;
  imageUrls: string[];
  estimate: ResaleEstimate | null;
  approxLocation: { lat: number; lng: number } | null;
  offerCount: number;
  acceptedOfferId?: string;
  acceptedRetailerUid?: string;
  acceptedAmountUsd?: number;
  fulfillment?: FulfillmentMethod;
  dropoffCode?: string;
  shipFrom?: ShipFromAddress;
  shipping?: { labelUrl: string; trackingNumber: string; carrier: string };
  finalAmountUsd?: number;
  createdAt: number;
  acceptedAt?: number;
  completedAt?: number;
};

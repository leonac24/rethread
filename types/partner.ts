export type PartnerType = 'repair' | 'resale' | 'donation' | 'recycler';
export type PartnerStatus = 'pending' | 'verified' | 'rejected';

export type PartnerRecord = {
  kind: 'partner' | 'brand_claim';
  businessName: string;
  type?: PartnerType;
  placeId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  brandSlug?: string;
  evidence: { links: string[]; text: string };
  discountPct: number; // default 5
  status: PartnerStatus;
  appliedAt: number;
  verifiedAt?: number;
};

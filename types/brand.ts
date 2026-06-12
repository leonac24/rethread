import type { Grade } from '@/lib/score/garment';

export type BrandStatus = 'unclaimed' | 'claimed' | 'verified';

export type ProductImpactDim = { baseline: number; kappa: number; n: number; sum: number; current: number };

export type BrandRecord = {
  name: string;
  slug: string;
  aliases: string[];
  status: BrandStatus;
  claimedBy?: string;
  dossier: {
    summary: string;
    citations: { claim: string; url: string }[];
    certifications: string[];
    researchedAt: number; // epoch ms (Firestore Timestamp on the wire)
  };
  dims: { productImpact: ProductImpactDim; transparency: number; laborSupplyChain: number };
  fti?: { score: number; year: number; url: string };
  score: number;
  grade: Grade;
  updatedAt: number;
};

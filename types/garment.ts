export type Fiber = {
  material: string;
  percentage: number;
};

export type Garment = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
};

export type EnvironmentalCost = {
  water_liters: number;
  co2_kg: number;
  dye_pollution_score: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  dye_type?: string;
  dye_reasoning?: string;
};

export type RouteKind = 'repair' | 'resale' | 'donation';

export type RouteOption = {
  kind: RouteKind;
  name: string;
  address: string;
  distance_km: number;
  lat?: number;
  lng?: number;
  hours?: string;
  rating?: number;
  accepts_item: boolean | null;
};

export type LandfillImpact = {
  summary: string;
  microplastics: string;
  methane: string;
  dye_runoff: string;
  breakdown_years: string;
};

export type FashionTransparencyIndex = {
  score: number;   // 0–100
  year: number;
  brand: string;
  url: string;
};

export type ScanResult = {
  id: string;
  garment: Garment;
  cost: EnvironmentalCost;
  routes: [RouteOption, RouteOption, RouteOption];
  landfill_impact?: LandfillImpact;
  fti?: FashionTransparencyIndex;
};

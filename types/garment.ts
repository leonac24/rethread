export type Fiber = {
  material: string;
  percentage: number;
};

export type Garment = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  price?: number;
};

export type EnvironmentalCost = {
  water_liters: number;
  co2_kg: number;
  dye_pollution_score: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

export type RouteKind = 'repair' | 'resale' | 'donation';

export type RouteOption = {
  kind: RouteKind;
  name: string;
  address: string;
  distance_km: number;
  hours?: string;
  rating?: number;
  accepts_item: boolean;
};

export type ScanResult = {
  id: string;
  garment: Garment;
  cost: EnvironmentalCost;
  routes: [RouteOption, RouteOption, RouteOption];
};

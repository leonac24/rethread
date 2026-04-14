export type Fiber = {
  material: string;
  percentage: number;
};

export type GarmentCondition = 'poor' | 'fair' | 'good' | 'excellent';

export type Garment = {
  fibers: Fiber[];
  origin: string | null;
  category: string | null;
  brand?: string;
  color?: string;
  condition?: GarmentCondition;
};

export type EnvironmentalCost = {
  water_liters: number;
  co2_kg: number;
  dye_pollution_score: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  dye_type?: string;
  dye_reasoning?: string;
  disposal_co2_kg: number;
  disposal_landfill_years: number;
  disposal_note: string;
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

export type OutcomeAction = 'throw_away' | 'repair' | 'list' | 'donate';

export type ScanResult = {
  id: string;
  garment: Garment;
  cost: EnvironmentalCost;
  routes: [RouteOption, RouteOption, RouteOption];
};

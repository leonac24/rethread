// Fiber environmental impact lookup table.
//
// Water (L/kg of fiber):
//   Verified sources:
//     - Cotton:    WaterFootprint.org, Chapagain & Hoekstra (2006) — waterfootprint.org/resources/Report18.pdf
//     - Polyester: Water Footprint Network (2017) — waterfootprint.org/resources/WFA_Polyester_and__Viscose_2017.pdf
//     - Viscose:   Water Footprint Network (2017) — same report above
//   Estimates (no reliable public source found — marked with ~):
//     organic_cotton, recycled_polyester, nylon, recycled_nylon, acrylic,
//     wool, cashmere, silk, modal, lyocell, linen, hemp, elastane, down
//
// CO2 (kg CO2e/kg of fiber):
//   Verified sources:
//     - Cotton, organic cotton, wool, nylon, recycled nylon:
//       Textile Exchange Materials Benchmark (textileexchange.org)
//   Estimates (no reliable public source found — marked with ~):
//     polyester, recycled_polyester, acrylic, cashmere, silk, viscose,
//     modal, lyocell, linen, hemp, elastane, down

type FiberImpact = {
  water: number; // L per kg of fiber
  co2: number;   // kg CO2e per kg of fiber
};

const FIBER_IMPACT: Record<string, FiberImpact> = {
  // ── Verified ──────────────────────────────────────────────────────────────
  cotton:             { water: 10_000, co2: 6.0  }, // water: WFN Report18; co2: Textile Exchange
  organic_cotton:     { water:  7_500, co2: 2.0  }, // water: est; co2: Textile Exchange
  polyester:          { water:     71, co2: 9.5  }, // water: WFN 2017 PDF; co2: est
  viscose:            { water:    640, co2: 4.3  }, // water: WFN 2017 PDF; co2: est
  wool:               { water:  3_000, co2: 19.0 }, // water: est; co2: Textile Exchange
  nylon:              { water:     67, co2: 6.52 }, // water: est; co2: Textile Exchange
  recycled_nylon:     { water:     50, co2: 0.2  }, // water: est; co2: Textile Exchange
  // ── Estimated (no verified public source) ─────────────────────────────────
  recycled_polyester: { water:     60, co2: 2.3  },
  acrylic:            { water:     90, co2: 5.5  },
  cashmere:           { water:  7_500, co2: 60.0 },
  silk:               { water:  1_000, co2: 12.0 },
  modal:              { water:    600, co2: 3.4  },
  lyocell:            { water:    600, co2: 2.4  },
  linen:              { water:  2_400, co2: 1.7  },
  hemp:               { water:    300, co2: 1.5  },
  elastane:           { water:    100, co2: 8.0  },
  down:               { water:  2_000, co2: 5.0  },
};

// Fallback for unrecognized fibers — uses a mid-range synthetic estimate.
const FALLBACK: FiberImpact = { water: 500, co2: 6.0 };

// Estimated finished-garment weight in grams by category.
const GARMENT_WEIGHT_G: Record<string, number> = {
  't-shirt':    175,
  'shirt':      225,
  'blouse':     200,
  'jeans':      800,
  'pants':      500,
  'trousers':   500,
  'shorts':     250,
  'skirt':      275,
  'dress':      300,
  'jacket':     750,
  'coat':      1200,
  'hoodie':     500,
  'sweatshirt': 500,
  'sweater':    400,
  'leggings':   250,
  'socks':      100,
  'underwear':   75,
  'bra':        125,
  'shoes':      450,
};

const DEFAULT_WEIGHT_G = 400;

function normalizeKey(material: string): string {
  const m = material.toLowerCase().trim();
  if (m.includes('organic') && m.includes('cotton')) return 'organic_cotton';
  if (m.includes('recycled') && (m.includes('polyester') || m.includes('pet'))) return 'recycled_polyester';
  if (m.includes('recycled') && (m.includes('nylon') || m.includes('polyamide'))) return 'recycled_nylon';
  if (m.includes('cotton')) return 'cotton';
  if (m.includes('polyester') || m.includes('pet') || m.includes('dacron')) return 'polyester';
  if (m.includes('nylon') || m.includes('polyamide')) return 'nylon';
  if (m.includes('acrylic') || m.includes('orlon')) return 'acrylic';
  if (m.includes('cashmere')) return 'cashmere';
  if (m.includes('wool') || m.includes('merino') || m.includes('lambswool')) return 'wool';
  if (m.includes('silk')) return 'silk';
  if (m.includes('lyocell') || m.includes('tencel')) return 'lyocell';
  if (m.includes('modal')) return 'modal';
  if (m.includes('viscose') || m.includes('rayon') || m.includes('bamboo')) return 'viscose';
  if (m.includes('linen') || m.includes('flax')) return 'linen';
  if (m.includes('hemp')) return 'hemp';
  if (m.includes('elastane') || m.includes('spandex') || m.includes('lycra')) return 'elastane';
  if (m.includes('down') || m.includes('feather') || m.includes('goose') || m.includes('duck')) return 'down';
  return '';
}

function garmentWeightG(category?: string | null): number {
  if (!category) return DEFAULT_WEIGHT_G;
  const c = category.toLowerCase().trim();
  for (const [key, weight] of Object.entries(GARMENT_WEIGHT_G)) {
    if (c.includes(key)) return weight;
  }
  return DEFAULT_WEIGHT_G;
}

export type ImpactResult = {
  water_liters: number;
  co2_kg: number;
  /** Fraction of blend (by %) that matched known fibers. */
  coverage: number;
};

export function computeFiberImpact(
  fibers: Array<{ material: string; percentage: number }>,
  category?: string | null,
): ImpactResult {
  const weightKg = garmentWeightG(category) / 1000;

  let totalPct = 0;
  let knownPct = 0;
  let waterPerKg = 0;
  let co2PerKg = 0;

  for (const { material, percentage } of fibers) {
    const pct = Math.max(0, Math.min(100, percentage));
    const key = normalizeKey(material);
    const impact = key ? FIBER_IMPACT[key] : null;
    const resolved = impact ?? FALLBACK;

    waterPerKg += (pct / 100) * resolved.water;
    co2PerKg   += (pct / 100) * resolved.co2;
    totalPct   += pct;
    if (impact) knownPct += pct;
  }

  // If fiber percentages don't add to 100, fill the remainder with fallback.
  if (totalPct < 100) {
    const remainder = (100 - totalPct) / 100;
    waterPerKg += remainder * FALLBACK.water;
    co2PerKg   += remainder * FALLBACK.co2;
  }

  return {
    water_liters: Math.round(waterPerKg * weightKg),
    co2_kg: Math.round(co2PerKg * weightKg * 100) / 100,
    coverage: totalPct > 0 ? knownPct / totalPct : 0,
  };
}

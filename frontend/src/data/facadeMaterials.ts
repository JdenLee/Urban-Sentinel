/**
 * Façade material classes, as recorded by façade inspectors.
 *
 * `scripts/prepare-buildings.mjs` writes one of these onto every footprint, taken from the
 * `exterior_wall_type_s_` field of the building's DOB NOW façade filing where one exists, and
 * otherwise inferred from construction era and building class. The shader in
 * `layers/FacadeMaterialExtension.ts` renders each class procedurally; the index below is what
 * crosses into GLSL, so the order is part of the contract with the shader.
 */
export const FACADE_MATERIALS = ['brick', 'terra_cotta', 'stone', 'cast_iron', 'curtain', 'metal', 'concrete', 'stucco'] as const;

export type FacadeMaterial = (typeof FACADE_MATERIALS)[number];
export type MaterialSource = 'filing' | 'inferred';

const INDEX = new Map(FACADE_MATERIALS.map((m, i) => [m, i]));

export const DEFAULT_MATERIAL: FacadeMaterial = 'brick';

export function materialIndex(material: FacadeMaterial): number {
  return INDEX.get(material) ?? 0;
}

export function isFacadeMaterial(value: unknown): value is FacadeMaterial {
  return typeof value === 'string' && INDEX.has(value as FacadeMaterial);
}

export const MATERIAL_LABEL: Record<FacadeMaterial, string> = {
  brick: 'Brick masonry',
  terra_cotta: 'Terra cotta',
  stone: 'Stone',
  cast_iron: 'Cast iron',
  curtain: 'Curtain wall',
  metal: 'Metal panel',
  concrete: 'Concrete / precast',
  stucco: 'Stucco',
};

/** Typical floor-to-floor height when a building's storey count is unknown. */
const FALLBACK_STOREY_M: Record<FacadeMaterial, number> = {
  brick: 3.1,
  terra_cotta: 3.6,
  stone: 3.8,
  cast_iron: 4.0,
  curtain: 3.9,
  metal: 3.6,
  concrete: 3.4,
  stucco: 3.1,
};

/**
 * Floor-to-floor height in metres, used to space the window bands so they line up with the
 * building's real storeys instead of a fixed guess. PLUTO storey counts are per tax lot and
 * occasionally disagree with the LiDAR roof height, so implausible ratios fall back to the
 * material's typical spacing.
 */
export function storeyHeight(heightM: number, floors: number | null | undefined, material: FacadeMaterial): number {
  if (floors && floors > 0) {
    const h = heightM / floors;
    if (h >= 2.5 && h <= 6.5) return h;
  }
  return FALLBACK_STOREY_M[material];
}

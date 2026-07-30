const COPPER_DENSITY_KG_PER_MM3 = 8.96e-6;

export const SWG_AREA_MM2: Readonly<Record<number, number>> = {
  1: 45.6095862,
  2: 38.59954855,
  3: 32.17408,
  4: 27.25064455,
  5: 22.7358262,
  6: 18.7062112,
  7: 15.69499695,
  8: 12.9478678,
  9: 10.5222438,
  10: 8.29684375,
  11: 6.83581375,
  12: 5.4746208,
  13: 4.3010838,
  14: 3.23696695,
  15: 2.63056095,
  16: 2.08699495,
  17: 1.5838822,
  18: 1.1691382,
  19: 0.8172342,
  20: 0.656203558,
  21: 0.51919115,
  22: 0.397086746,
  23: 0.29228455,
  24: 0.245453826,
  25: 0.202709272,
  26: 0.16405089,
  27: 0.13658981,
  28: 0.111050848,
  29: 0.093494138,
  30: 0.077941238,
  31: 0.068358138,
  32: 0.058972198,
  33: 0.050677318,
  34: 0.043010838,
  35: 0.03563735,
  36: 0.02925909,
  37: 0.02350923,
  38: 0.018148192,
  39: 0.013686552,
  40: 0.011691382,
  41: 0.009853312,
  42: 0.008172342,
  43: 0.006504726,
  44: 0.005153666,
  45: 0.003959706,
  46: 0.002922846,
  47: 0.002043086,
  48: 0.001320426,
  49: 0.00070695,
  50: 0.000490938,
};

export type SecondaryWindingSegment = {
  conductor?: string | null;
  turns?: string | number | null;
};

export type SecondaryCopperCalculationInput = {
  bareCoreDimensions?: string | null;
  totalTurns?: string | number | null;
  segments: SecondaryWindingSegment[];
};

export type SecondaryCopperCalculation = {
  weightKg: number;
  mmpMm: number;
  windingVolumeMm3: number;
};

/**
 * Calculates winding copper for circular cores only. Five-value rectangular
 * cores need a confirmed winding-path formula and deliberately return null.
 */
export function calculateSecondaryCopperWeight(
  input: SecondaryCopperCalculationInput
): SecondaryCopperCalculation | null {
  const dimensions = extractNumbers(input.bareCoreDimensions);
  if (dimensions.length !== 3) return null;

  const [id, od, height] = dimensions;
  if (id <= 0 || od <= id || height <= 0) return null;

  const radialThickness = (od - id) / 2;
  const mmpMm = 2 * (height + radialThickness);

  const activeSegments = input.segments.filter(
    (segment) => String(segment.conductor || "").trim() || toPositiveNumber(segment.turns)
  );
  const conductorSegments = activeSegments.filter((segment) => String(segment.conductor || "").trim());
  if (!conductorSegments.length) return null;

  // Do not publish a partial weight while one tap has turns but no conductor.
  if (activeSegments.length !== conductorSegments.length) return null;

  const areaTurnsValues = conductorSegments.map((segment) => {
    const turns = segment.turns || (conductorSegments.length === 1 ? input.totalTurns : null);
    return calculateAreaTurns(segment.conductor, turns);
  });
  if (areaTurnsValues.some((value) => value === null || value <= 0)) return null;

  const areaTurns = areaTurnsValues.reduce((sum, value) => sum + value!, 0);
  const windingVolumeMm3 = areaTurns * mmpMm;
  const weightKg = windingVolumeMm3 * COPPER_DENSITY_KG_PER_MM3;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return null;

  return { weightKg, mmpMm, windingVolumeMm3 };
}

export function formatSecondaryCopperWeight(weightKg: number): string {
  return `${weightKg.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}kg`;
}

function calculateAreaTurns(
  conductorValue?: string | null,
  turnsValue?: string | number | null
): number | null {
  const conductor = String(conductorValue || "").trim();
  if (!conductor) return null;

  const terms = Array.from(
    conductor.matchAll(/(\d{1,2})\s*swg(?:\s*[xX]\s*(\d+(?:\.\d+)?))?(?:\s*=\s*(\d+(?:\.\d+)?)\s*turns?)?/gi)
  ).map((match) => ({
    swg: Number(match[1]),
    strands: match[2] ? Number(match[2]) : 1,
    assignedTurns: match[3] ? Number(match[3]) : null,
  }));

  if (!terms.length) return null;
  if (terms.some((term) => !SWG_AREA_MM2[term.swg] || term.strands <= 0)) return null;

  const hasAssignedTurns = terms.some((term) => term.assignedTurns !== null);
  if (hasAssignedTurns && terms.some((term) => term.assignedTurns === null)) return null;

  const segmentTurns = toPositiveNumber(turnsValue);
  if (!hasAssignedTurns && !segmentTurns) return null;

  return terms.reduce((sum, term) => {
    const turns = term.assignedTurns ?? segmentTurns!;
    return sum + SWG_AREA_MM2[term.swg] * term.strands * turns;
  }, 0);
}

function extractNumbers(value?: string | null): number[] {
  return String(value || "").match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
}

function toPositiveNumber(value?: string | number | null): number | null {
  const parsed = Number(String(value ?? "").match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

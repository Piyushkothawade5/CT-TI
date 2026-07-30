export type CoreCalculation = {
  shape: "circular" | "rectangular";
  weightKg: number;
  id?: number;
  od?: number;
  height?: number;
  cs?: number;
  mmp?: number;
};

export function calculateCoreFromDimensions(value?: string | null): CoreCalculation | null {
  if (!value) return null;
  const dimensions = value.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!dimensions || dimensions.length < 3) return null;

  if (dimensions.length === 5) {
    const [innerWidth, innerHeight, outerWidth, outerHeight, stackHeight] = dimensions;
    if (
      innerWidth <= 0 || innerHeight <= 0 || stackHeight <= 0 ||
      outerWidth <= innerWidth || outerHeight <= innerHeight
    ) return null;

    const netAreaMm2 = (outerWidth * outerHeight) - (innerWidth * innerHeight);
    const weightKg = (netAreaMm2 * stackHeight * 0.96 * 7.4) / 1_000_000;
    return { shape: "rectangular", weightKg };
  }

  // Only three-value dimensions are unambiguously circular. Combined or
  // multi-core dimension strings must be confirmed rather than miscalculated.
  if (dimensions.length !== 3) return null;

  const [id, od, height] = dimensions;
  if (id <= 0 || od <= id || height <= 0) return null;

  const cs = (((od - id) / 2) * 0.96 * height) / 100;
  const mmp = (((od + id) / 2) * 3.14) / 10;
  const weightKg = (cs * mmp * 7.77) / 1000;

  return { shape: "circular", id, od, height, cs, mmp, weightKg };
}

export function formatCoreWeight(weightKg: number): string {
  return `${weightKg.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}kg`;
}

export type TapTurnCalculation = {
  totalTurns: number;
  segmentTurns: number[];
};

export function expandRatioByCore(ratioValue?: string | null): string[] {
  if (!ratioValue) return [];
  const normalized = ratioValue.toUpperCase().replace(/\s+/g, "");
  const [primaryPart, secondaryPart] = normalized.split("/");
  if (!primaryPart || !secondaryPart) return [];

  const secondaryCurrents = extractNumbers(secondaryPart);
  if (!secondaryCurrents.length) return [];
  const isRepeatedSecondaryCurrent =
    secondaryCurrents.length > 1 &&
    secondaryCurrents.every((current) => current === secondaryCurrents[0]);

  if (isRepeatedSecondaryCurrent) {
    return secondaryCurrents.slice(0, 3).map(
      (current) => `${primaryPart}/${formatNumber(current)}A`
    );
  }

  return [normalized];
}

export function calculateTapTurns(
  ratioValue?: string | null,
  primaryTurnsValue?: string | null
): TapTurnCalculation | null {
  if (!ratioValue) return null;
  const normalized = ratioValue.toUpperCase().replace(/\s+/g, "");
  const [primaryPart, secondaryPart] = normalized.split("/");
  if (!primaryPart || !secondaryPart) return null;

  const primaryRatios = extractNumbers(primaryPart);
  const secondaryCurrents = extractNumbers(secondaryPart);
  if (!primaryRatios.length || !secondaryCurrents.length) return null;
  if (primaryRatios.length > 1 && secondaryCurrents.length > 1) return null;

  const primaryTurns = extractNumbers(primaryTurnsValue || "")[0] || 1;
  if (primaryTurns <= 0 || secondaryCurrents.some((current) => current <= 0)) return null;

  let tapPoints: number[];
  if (primaryRatios.length > 1) {
    const secondaryCurrent = secondaryCurrents[0];
    tapPoints = primaryRatios.map((ratio) => Math.round((ratio * primaryTurns) / secondaryCurrent));
  } else {
    const primaryRatio = primaryRatios[0];
    tapPoints = secondaryCurrents.map((current) => Math.round((primaryRatio * primaryTurns) / current));
  }

  tapPoints = Array.from(new Set(tapPoints)).sort((a, b) => a - b);
  if (!tapPoints.length || tapPoints.some((turns) => turns <= 0)) return null;

  const segmentTurns = tapPoints.map((turns, index) =>
    index === 0 ? turns : turns - tapPoints[index - 1]
  );
  if (segmentTurns.some((turns) => turns <= 0)) return null;

  return {
    totalTurns: tapPoints[tapPoints.length - 1],
    segmentTurns,
  };
}

function extractNumbers(value: string): number[] {
  return value.match(/\d+(?:\.\d+)?/g)?.map(Number) || [];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

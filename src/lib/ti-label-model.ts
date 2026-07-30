import type { CoreData, TiRecordInput } from "@/api-client";

export const MAX_LABEL_TAP_ROWS = 12;
export const MAX_TAPS_PER_CORE = 4;

export const TAP_FIELD_NAMES = [
  "TAP_01",
  "TAP_02",
  "TAP_03",
  "TAP_04",
  "TAP_05",
  "TAP_06",
  "TAP_07",
  "TAP_08",
  "TAP_09",
  "TAP_10",
  "TAP_11",
  "TAP_12",
] as const;

export type BarTenderTapField = typeof TAP_FIELD_NAMES[number];
export type LabelDiagramOrientation = "vertical" | "horizontal";
export type LabelDiagramP1Position = "start" | "end";
export type LabelDiagramTerminalPosition = "start" | "end";
export type LabelDiagramOrder = "start" | "end";

type LabelSerial = {
  serial: string;
  index: number;
};

export type TiLabelData = {
  mfg: string;
  itemNo: string;
  ctr: string;
  tapRows: string[];
  wireColour: string;
  insulationLevel: string;
  stc: string;
  frequency: string;
  insClass: string;
  refStd: string;
  mfgYear: string;
  terminalNames: string[];
};

export type BarTenderLabelRow = {
  MFG: string;
  SR_NO: string;
  ITEM_NO: string;
  CTR: string;
  WIRE_COLOUR: string;
  IL: string;
  STC: string;
  FREQ: string;
  INS_CLASS: string;
  REF_STD: string;
  IEC: string;
  MFG_YEAR: string;
  MADE_IN_INDIA: string;
  DIAGRAM_ORIENTATION: LabelDiagramOrientation;
  DIAGRAM_P1_POSITION: LabelDiagramP1Position;
  DIAGRAM_TERMINAL_POSITION: LabelDiagramTerminalPosition;
  DIAGRAM_TERMINAL_ORDER: LabelDiagramOrder;
  DIAGRAM_CORE_ORDER: LabelDiagramOrder;
  tapRows: string[];
} & Record<BarTenderTapField, string>;

export type LabelDiagramCore = {
  coreNumber: number;
  terminals: string[];
};

const MFG_TEXT = "Mfg : Shubhada Polymers Product Pvt Ltd, Nashik";
export const SECONDARY_OPEN_CIRCUIT_WARNING = "*Secondary terminals must not be open-circuited";

export function getWireColourLabelLine(value: unknown): string {
  const wireColour = cleanValue(value);
  return wireColour ? `Wire Color : ${wireColour}` : SECONDARY_OPEN_CIRCUIT_WARNING;
}

export function buildTiLabelData(data: TiRecordInput): TiLabelData {
  const cores = getActiveCores(data);
  const firstCore = cores[0]?.core;
  const firstRatio = cleanValue(firstCore?.ratio || data.ratio);
  const tapRows = cores.flatMap(({ core, coreNumber }) => buildCoreTapRows(core, coreNumber, data.ratio));
  const terminalNames = getTerminalNames(firstCore, Math.max(Math.min(tapRows.length + 1, 5), 2), 1);

  return {
    mfg: MFG_TEXT,
    itemNo: cleanValue(data.cust_part_code) || cleanValue(data.item_no) || "-",
    ctr: formatRatioText(cleanValue(data.ratio) || firstRatio),
    tapRows: tapRows.length ? tapRows.slice(0, MAX_LABEL_TAP_ROWS) : [`RATIO : ${firstRatio || "-"}`],
    wireColour: cleanValue(firstCore?.wire_colour),
    insulationLevel: normalizeVoltage(data.insulation_level),
    stc: cleanValue(data.stc),
    frequency: normalizeFrequency(data.frequency),
    insClass: cleanValue(data.ins_class),
    refStd: normalizeStandard(data.ref_std),
    mfgYear: getManufacturingYear(data),
    terminalNames,
  };
}

export function buildBarTenderLabelRows(data: TiRecordInput & { ti_no?: string | null }): BarTenderLabelRow[] {
  const labelData = buildTiLabelData(data);
  return buildLabelSerials(getLabelSerialSeed(data), data.quantity).map((label) => makeBarTenderLabelRow(labelData, label.serial));
}

export function makeBarTenderLabelRow(labelData: TiLabelData, serial: string): BarTenderLabelRow {
  const tapFields = Object.fromEntries(
    TAP_FIELD_NAMES.map((field, index) => [field, labelData.tapRows[index] || ""])
  ) as Record<BarTenderTapField, string>;

  return {
    MFG: labelData.mfg,
    SR_NO: serial,
    ITEM_NO: labelData.itemNo,
    CTR: labelData.ctr,
    WIRE_COLOUR: labelData.wireColour,
    IL: labelData.insulationLevel,
    STC: labelData.stc,
    FREQ: labelData.frequency,
    INS_CLASS: labelData.insClass,
    REF_STD: labelData.refStd,
    IEC: labelData.refStd,
    MFG_YEAR: labelData.mfgYear,
    MADE_IN_INDIA: "Made in India",
    DIAGRAM_ORIENTATION: "vertical",
    DIAGRAM_P1_POSITION: "end",
    DIAGRAM_TERMINAL_POSITION: "end",
    DIAGRAM_TERMINAL_ORDER: "end",
    DIAGRAM_CORE_ORDER: "start",
    tapRows: labelData.tapRows,
    ...tapFields,
  };
}

export function getOrderedLabelDiagramCores(
  row: Pick<BarTenderLabelRow, "tapRows"> & Partial<Pick<BarTenderLabelRow, "DIAGRAM_CORE_ORDER" | "DIAGRAM_TERMINAL_ORDER">>
): LabelDiagramCore[] {
  const cores = getLabelDiagramCores(row);
  const orderedCores = row.DIAGRAM_CORE_ORDER === "end" ? [...cores].reverse() : cores;
  return orderedCores.map((core) => ({
    ...core,
    terminals: row.DIAGRAM_TERMINAL_ORDER === "end" ? [...core.terminals].reverse() : core.terminals,
  }));
}

export function getLabelDiagramCores(row: Pick<BarTenderLabelRow, "tapRows">): LabelDiagramCore[] {
  const coreTerminalCounts = new Map<number, number>();

  row.tapRows.forEach((tapRow) => {
    const matches = String(tapRow || "").matchAll(/\b(\d*)S1\s*-\s*(\d*)S([2-5])\b/gi);
    for (const match of matches) {
      const coreNumber = Number(match[1] || match[2] || "1");
      const terminalNumber = Number(match[3]);
      if (!Number.isFinite(coreNumber) || !Number.isFinite(terminalNumber)) continue;
      coreTerminalCounts.set(coreNumber, Math.max(coreTerminalCounts.get(coreNumber) || 0, terminalNumber));
    }
  });

  if (!coreTerminalCounts.size) {
    coreTerminalCounts.set(1, 2);
  }

  const hasMultipleCores = coreTerminalCounts.size > 1;
  return [...coreTerminalCounts.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, 3)
    .map(([coreNumber, terminalCount]) => ({
      coreNumber,
      terminals: Array.from(
        { length: Math.max(2, Math.min(terminalCount, 5)) },
        (_, index) => hasMultipleCores ? `${coreNumber}S${index + 1}` : `S${index + 1}`
      ),
    }));
}

export function buildLabelSerials(tiNo: string, quantity?: string | null): LabelSerial[] {
  const count = parseQuantity(quantity);
  const match = tiNo.match(/^(.*?)(\d+)\s*$/);
  if (!match) return [{ serial: tiNo || "-", index: 0 }];

  const prefix = match[1];
  const start = Number(match[2]);
  const width = match[2].length;

  return Array.from({ length: count }, (_, index) => ({
    serial: `${prefix}${String(start + index).padStart(width, "0")}`,
    index,
  }));
}

export function getLabelSerialSeed(data: TiRecordInput & { ti_no?: string | null }): string {
  return getFirstSerialInRange(data.serial_number) || cleanValue(data.ti_no) || "";
}

function getActiveCores(data: TiRecordInput): Array<{ core: CoreData; coreNumber: number }> {
  return ([data.core1, data.core2, data.core3] as Array<CoreData | undefined>)
    .map((core, index) => ({ core, coreNumber: index + 1 }))
    .filter((entry): entry is { core: CoreData; coreNumber: number } => Boolean(entry.core && hasCoreData(entry.core)));
}

function buildCoreTapRows(core: CoreData, coreNumber: number, fallbackRatio?: string): string[] {
  const ratio = cleanValue(core.ratio || fallbackRatio);
  const ratioParts = parseRatio(ratio);
  const burden = normalizeBurden(core.burden_va);
  const extraSpecs = getTapExtraSpecs(core);
  const tapValues = getTapTurnValues(core, ratioParts);
  const terminalPairs = getTapTerminalPairs(core, tapValues.length, coreNumber);

  if (tapValues.length && ratioParts.secondary) {
    return tapValues.map((turns, index) => {
      const accuracy = getAccuracyForTap(core.accuracy_class, turns, index, tapValues.length);
      const suffix = formatTapSuffix(burden, accuracy, extraSpecs);
      const suffixText = suffix ? `, ${suffix}` : "";
      return `${terminalPairs[index] || `${coreNumber}S1-${coreNumber}S${index + 2}`} : ${formatNumber(turns)}/${ratioParts.secondary}${suffixText}`;
    });
  }

  const formattedRatio = formatRatioText(ratio);
  if (!formattedRatio) return [];

  const accuracy = getAccuracyForTap(core.accuracy_class, null, 0, 1);
  const suffix = formatTapSuffix(burden, accuracy, extraSpecs);
  const suffixText = suffix ? `, ${suffix}` : "";
  return [`${terminalPairs[0] || `${coreNumber}S1-${coreNumber}S2`} : ${formattedRatio}${suffixText}`];
}

function formatTapSuffix(burden: string, accuracy: string, extraSpecs: string[]): string {
  return [
    burden,
    accuracy ? `CL : ${accuracy}` : "",
    ...extraSpecs,
  ].filter(Boolean).join(", ");
}

function getTapExtraSpecs(core: CoreData): string[] {
  return [
    formatTapSpec("ISF", core.isf),
    cleanValue(core.min_knee_pt_volt),
    formatTapSpec("RCT", core.max_rct_75c),
    cleanValue(core.max_exc_vk2),
  ].filter(Boolean);
}

function formatTapSpec(label: string, value?: string): string {
  const text = cleanValue(value);
  return text ? `${label} : ${text}` : "";
}

function getTapTurnValues(core: CoreData, ratioParts: ParsedRatio): number[] {
  const totalTurns = parseNumber(core.sec_total_turns);
  const segmentTurns = [
    core.sec_turns_s1s2,
    core.sec_turns_s2s3,
    core.sec_turns_s3s4,
    core.sec_turns_s4s5,
  ].map(parseNumber).filter((value): value is number => Number.isFinite(value) && value > 0);
  const ratioTurnValues = ratioParts.primaryValues.length > 1
    ? [...ratioParts.primaryValues].sort((a, b) => a - b).slice(0, MAX_TAPS_PER_CORE)
    : [];
  const terminalTapCount = Math.max(getTerminalNames(core, 0, 1).length - 1, 0);
  const tapCount = Math.min(
    Math.max(terminalTapCount, segmentTurns.length, ratioTurnValues.length, totalTurns ? 1 : 0),
    MAX_TAPS_PER_CORE
  );

  if (tapCount <= 0) return ratioParts.primaryValues.slice(0, 1);

  if (!segmentTurns.length && ratioTurnValues.length >= tapCount) {
    return ratioTurnValues.slice(0, tapCount);
  }

  let cumulativeTurns = 0;
  return Array.from({ length: tapCount }, (_, index) => {
    cumulativeTurns += segmentTurns[index] || 0;
    if (tapCount === 1) return totalTurns || cumulativeTurns || segmentTurns[0] || ratioTurnValues[0];
    if (index === tapCount - 1 && totalTurns) return totalTurns;
    return cumulativeTurns || ratioTurnValues[index] || totalTurns || segmentTurns[index];
  }).filter((value): value is number => Number.isFinite(value) && value > 0);
}

type ParsedRatio = {
  primaryValues: number[];
  secondary: string;
};

function parseRatio(value: string): ParsedRatio {
  const [primaryPart = "", secondaryPart = ""] = value.toUpperCase().split("/");
  return {
    primaryValues: primaryPart.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [],
    secondary: normalizeSecondaryCurrent(secondaryPart),
  };
}

function getTapTerminalPairs(core: CoreData | undefined, count: number, coreNumber: number): string[] {
  const terminalNames = getTerminalNames(core, Math.max(count + 1, 2), coreNumber);
  const firstTerminal = terminalNames[0] || `${coreNumber}S1`;
  return Array.from({ length: count }, (_, index) => {
    const endTerminal = terminalNames[index + 1] || fallbackTerminalName(firstTerminal, index + 2, coreNumber);
    return `${firstTerminal}-${endTerminal}`;
  });
}

function getTerminalNames(core: CoreData | undefined, minimumCount = 2, coreNumber: number): string[] {
  const terminalText = `${core?.sec_ter_marking || ""} ${core?.wire_colour || ""}`;
  const parsed = parseTerminalNames(terminalText).map((name) => normalizeCoreTerminalName(name, coreNumber));
  const minimum = minimumCount > 0 ? Math.max(minimumCount, 2) : 0;
  const count = Math.min(Math.max(parsed.length, minimum), 5);
  if (parsed.length >= count) return parsed.slice(0, count);
  if (count === 0) return [];

  const firstTerminal = parsed[0] || `${coreNumber}S1`;
  const names = [...parsed];
  while (names.length < count) {
    names.push(fallbackTerminalName(firstTerminal, names.length + 1, coreNumber));
  }
  return names;
}

function parseTerminalNames(value: string): string[] {
  const terminals = cleanValue(value).match(/\d*S[1-5]/gi) || [];
  return terminals
    .map((terminal) => terminal.toUpperCase())
    .filter((terminal, index, items) => items.indexOf(terminal) === index);
}

function normalizeCoreTerminalName(value: string, coreNumber: number): string {
  const match = value.match(/^(\d*)S([1-5])$/i);
  if (!match) return value.toUpperCase();
  return `${match[1] || coreNumber}S${match[2]}`;
}

function fallbackTerminalName(firstTerminal: string, terminalNumber: number, coreNumber: number): string {
  const match = firstTerminal.match(/^(\d*)S\d+$/i);
  return `${match?.[1] || coreNumber}S${terminalNumber}`;
}

function getAccuracyForTap(value: string | undefined, turns: number | null, index: number, tapCount: number): string {
  const parsed = parseAccuracyClasses(value);
  if (!parsed.length) return "";

  if (turns !== null) {
    const exact = parsed.find((entry) => entry.tapValue !== null && Math.abs(entry.tapValue - turns) < 0.001);
    if (exact?.classText) return exact.classText;
  }

  const classes = parsed.map((entry) => entry.classText).filter(Boolean);
  if (!classes.length) return "";
  if (classes.length === 1) return classes[0];
  if (index === tapCount - 1) return classes[classes.length - 1];
  return classes[Math.min(index, classes.length - 1)];
}

function parseAccuracyClasses(value: string | undefined): Array<{ classText: string; tapValue: number | null }> {
  const text = cleanValue(value);
  if (!text) return [];

  return text
    .split(/\s*(?:,|;|&|\band\b)\s*/i)
    .map((part) => {
      const atIndex = part.indexOf("@");
      const classPart = atIndex >= 0 ? part.slice(0, atIndex) : part;
      const tapPart = atIndex >= 0 ? part.slice(atIndex + 1) : "";
      return {
        classText: cleanAccuracyClass(classPart),
        tapValue: parseNumber(tapPart),
      };
    })
    .filter((entry) => entry.classText);
}

function cleanAccuracyClass(value: string): string {
  const text = cleanValue(value)
    .replace(/^CL\s*/i, "")
    .replace(/^CLASS\s*/i, "")
    .trim();
  const compact = text.replace(/\s+/g, "").toUpperCase();
  const pClass = compact.match(/\b\d+(?:\.\d+)?P\d+\b/)?.[0];
  if (pClass) return pClass;
  const reversedPClass = compact.match(/^P(\d)(10|20|30)$/);
  if (reversedPClass) return `${reversedPClass[1]}P${reversedPClass[2]}`;
  const reversedTenPClass = compact.match(/^P(10|15|20|30)(\d)$/);
  if (reversedTenPClass) return `${reversedTenPClass[1]}P${reversedTenPClass[2]}`;

  return (
    compact.match(/\b(?:PS|PX|PR|TPX|TPY|TPZ)\b/)?.[0] ||
    compact.match(/\b\d+(?:\.\d+)?S\b/)?.[0] ||
    text.match(/\b\d+(?:\.\d+)?\b(?!\s*(?:VA|A|V|KV|KA|HZ|SEC)\b)/i)?.[0] ||
    compact
  );
}

function getFirstSerialInRange(value?: string | null): string {
  const serial = cleanValue(value);
  if (!serial) return "";

  const rangeMatch = serial.match(/^(.+?)\s+(?:TO|TILL|THRU|THROUGH)\s+.+$/i);
  return rangeMatch ? rangeMatch[1].trim() : serial;
}

function hasCoreData(core: CoreData): boolean {
  return Boolean(
    core.ratio ||
    core.burden_va ||
    core.accuracy_class ||
    core.isf ||
    core.min_knee_pt_volt ||
    core.max_rct_75c ||
    core.max_exc_vk2 ||
    core.sec_total_turns ||
    core.sec_ter_marking ||
    core.sec_turns_s1s2 ||
    core.sec_turns_s2s3 ||
    core.sec_turns_s3s4 ||
    core.sec_turns_s4s5 ||
    core.wire_colour
  );
}

function parseQuantity(value?: string | null): number {
  const raw = value?.match(/\d+/)?.[0];
  const parsed = raw ? Number(raw) : 1;
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(Math.floor(parsed), 1000);
}

function cleanValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatRatioText(value?: string): string {
  return cleanValue(value).replace(/\s*-\s*/g, "-").replace(/\s*\/\s*/g, "/").replace(/([0-9])A\b/i, "$1A");
}

function normalizeSecondaryCurrent(value: string): string {
  const current = value.match(/\d+(?:\.\d+)?/)?.[0];
  return current ? `${formatNumber(Number(current))}A` : "";
}

function normalizeBurden(value?: string): string {
  const burden = cleanValue(value);
  if (!burden) return "";
  return burden.replace(/\s*VA\b/i, " VA").replace(/\s+/g, " ");
}

function normalizeVoltage(value?: string): string {
  return cleanValue(value);
}

function normalizeFrequency(value?: string): string {
  return cleanValue(value);
}

function normalizeStandard(value?: string): string {
  const standard = cleanValue(value);
  if (!standard) return "";
  return standard.replace(/\s*:\s*/g, " ").replace(/\s+/g, " ");
}

function getManufacturingYear(data: TiRecordInput): string {
  const dateText = cleanValue(data.ti_date);
  const year = dateText.match(/\b(20\d{2}|19\d{2})\b/)?.[1];
  if (year) return year;
  const date = dateText ? new Date(dateText) : null;
  if (date && Number.isFinite(date.getTime())) return String(date.getFullYear());
  return String(new Date().getFullYear());
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function parseNumber(value?: string): number | null {
  const number = cleanValue(value).match(/\d+(?:\.\d+)?/)?.[0];
  if (!number) return null;
  const parsed = Number(number);
  return Number.isFinite(parsed) ? parsed : null;
}

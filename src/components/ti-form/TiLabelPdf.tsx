import React from "react";
import { Document, Page, Text, View, StyleSheet, Font } from "@react-pdf/renderer";
import type { CoreData, TiRecordInput } from "@/api-client";
import { buildTiLabelData, getWireColourLabelLine } from "@/lib/ti-label-model";

const MM_TO_PT = 2.834645669;
const LABEL_WIDTH_MM = 100;
const MAX_LABEL_HEIGHT_MM = 35;
const FALLBACK_LABEL_HEIGHT_MM = 35;
const TERMINAL_FONT_FAMILY = "Verdana-Bold";
const fontBaseUrl = import.meta.env.BASE_URL || "/";
const normalizedFontBaseUrl = fontBaseUrl.endsWith("/") ? fontBaseUrl : `${fontBaseUrl}/`;

Font.register({
  family: TERMINAL_FONT_FAMILY,
  src: `${normalizedFontBaseUrl}fonts/verdanab.ttf`,
});

type LabelSerial = {
  serial: string;
  index: number;
};

export type BarTenderLabelRow = {
  MFG: string;
  SR_NO: string;
  ITEM_NO: string;
  CTR: string;
  TAP1: string;
  TAP2: string;
  TAP3: string;
  WIRE_COLOUR: string;
  IL: string;
  STC: string;
  FREQ: string;
  INS_CLASS: string;
  IEC: string;
  MADE_IN_INDIA: string;
};

export function TiLabelPdfDocument({ data }: { data: TiRecordInput & { ti_no?: string | null } }) {
  const labelHeightMm = getLabelHeightMm(data);
  const serials = buildLabelSerials(getLabelSerialSeed(data), data.quantity);
  const labelData = buildTiLabelData(data);

  return (
    <Document title={`${data.ti_no || "TI"} labels`}>
      {serials.map((label) => (
        <Page
          key={`${label.serial}-${label.index}`}
          size={[mmToPt(LABEL_WIDTH_MM), mmToPt(labelHeightMm)]}
          style={styles.page}
        >
          <View wrap={false} style={styles.label}>
            <View style={styles.content}>
              <Text style={styles.mfg}>MFG : SHUBHADA POLYMERS PRODUCTS PVT LTD, NASHIK.</Text>

              <View style={styles.identityRow}>
                <Text style={styles.identityLeft}>SR.NO: {label.serial}</Text>
              <Text style={styles.identityRight}>ITEM NO: {labelData.itemNo}</Text>
              </View>

              {labelData.ctr && <Text style={styles.ctrLine}>CTR : {labelData.ctr}</Text>}

              <View style={styles.tapRows}>
                {labelData.tapRows.map((row) => (
                  <Text key={row} style={styles.tapRow}>{row}</Text>
                ))}
              </View>

              <Text style={styles.wireColour}>{getWireColourLabelLine(labelData.wireColour)}</Text>

              <View style={styles.electricalRow}>
                <Text style={styles.electricalText}>IL : {labelData.insulationLevel}</Text>
                <Text style={styles.electricalText}>STC : {labelData.stc}</Text>
                <Text style={styles.electricalText}>FREQ.: {labelData.frequency}</Text>
                <Text style={styles.electricalText}>INS CL: {labelData.insClass}</Text>
              </View>

              <View style={styles.footerRow}>
                <Text style={styles.iecText}>{labelData.refStd}</Text>
                <Text style={styles.madeInIndia}>MADE IN INDIA</Text>
              </View>
            </View>
            <TerminalDiagram terminalNames={labelData.terminalNames} />
          </View>
        </Page>
      ))}
    </Document>
  );
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

export function buildBarTenderLabelRows(data: TiRecordInput & { ti_no?: string | null }): BarTenderLabelRow[] {
  const labelData = buildLabelData(data);
  return buildLabelSerials(getLabelSerialSeed(data), data.quantity).map((label) => ({
    MFG: "MFG : SHUBHADA POLYMERS PRODUCTS PVT LTD, NASHIK.",
    SR_NO: label.serial,
    ITEM_NO: labelData.itemNo,
    CTR: labelData.ctr,
    TAP1: labelData.tapRows[0] || "",
    TAP2: labelData.tapRows[1] || "",
    TAP3: labelData.tapRows[2] || "",
    WIRE_COLOUR: labelData.wireColour,
    IL: labelData.insulationLevel,
    STC: labelData.stc,
    FREQ: labelData.frequency,
    INS_CLASS: labelData.insClass,
    IEC: labelData.refStd,
    MADE_IN_INDIA: "MADE IN INDIA",
  }));
}

function getLabelSerialSeed(data: TiRecordInput & { ti_no?: string | null }): string {
  return getFirstSerialInRange(data.serial_number) || cleanValue(data.ti_no) || "";
}

function getFirstSerialInRange(value?: string | null): string {
  const serial = cleanValue(value);
  if (!serial) return "";

  const rangeMatch = serial.match(/^(.+?)\s+(?:TO|TILL|THRU|THROUGH)\s+.+$/i);
  return rangeMatch ? rangeMatch[1].trim() : serial;
}

export function getLabelHeightMm(data: TiRecordInput): number {
  const candidates = [
    data.core1?.bare_core_dim,
    data.core2?.bare_core_dim,
    data.core3?.bare_core_dim,
    data.ct_final_dim,
  ];

  for (const candidate of candidates) {
    const height = parseHeightFromDimensions(candidate);
    if (height) return height;
  }

  return FALLBACK_LABEL_HEIGHT_MM;
}

function parseHeightFromDimensions(value?: string | null): number | null {
  const dimensions = value?.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!dimensions || dimensions.length < 3) return null;

  let height: number | null = null;
  if (dimensions.length === 3) {
    height = dimensions[2];
  } else if (dimensions.length >= 5) {
    height = dimensions[dimensions.length - 1];
  } else {
    height = dimensions[dimensions.length - 1];
  }

  if (!height || height < 15 || height > 300) return null;
  return Math.min(height, MAX_LABEL_HEIGHT_MM);
}

function buildLabelData(data: TiRecordInput) {
  const core = findPrimaryCore(data);
  const ratio = cleanValue(core?.ratio || data.ratio);
  const ratioParts = parseRatio(ratio);
  const tapRows = buildTapRows(core, ratioParts);
  const terminalNames = getTerminalNames(core, Math.max(tapRows.length + 1, 3));

  return {
    itemNo: cleanValue(data.cust_part_code) || cleanValue(data.item_no) || "-",
    ctr: ratioParts.primaryValues.length > 1 ? formatRatioText(ratio) : "",
    tapRows: tapRows.length ? tapRows : [`RATIO : ${ratio || "-"}`],
    wireColour: cleanValue(core?.wire_colour),
    insulationLevel: normalizeVoltage(data.insulation_level),
    stc: cleanValue(data.stc),
    frequency: normalizeFrequency(data.frequency),
    insClass: cleanValue(data.ins_class),
    refStd: normalizeStandard(data.ref_std),
    terminalNames,
  };
}

function findPrimaryCore(data: TiRecordInput): CoreData | undefined {
  return [data.core1, data.core2, data.core3].find((core) => core && hasCoreData(core));
}

function buildTapRows(core: CoreData | undefined, ratioParts: ParsedRatio): string[] {
  if (!core) return [];

  const burden = normalizeBurden(core.burden_va);
  const tapValues = getTapTurnValues(core, ratioParts);
  const terminalPairs = getTapTerminalPairs(core, tapValues.length);

  if (tapValues.length && ratioParts.secondary) {
    return tapValues.map((turns, index) => {
      const accuracy = getAccuracyForTap(core.accuracy_class, turns, index, tapValues.length);
      const suffix = [burden, accuracy && `CL ${accuracy}`].filter(Boolean).join(" / ");
      const suffixText = suffix ? `, ${suffix}` : "";
      return `${terminalPairs[index] || `S1-S${index + 2}`} : ${formatNumber(turns)} / ${ratioParts.secondary}${suffixText}`;
    });
  }

  const ratio = formatRatioText(core.ratio);
  if (ratio) {
    const accuracy = getAccuracyForTap(core.accuracy_class, null, 0, 1);
    const suffix = [burden, accuracy && `CL ${accuracy}`].filter(Boolean).join(" / ");
    const suffixText = suffix ? `, ${suffix}` : "";
    return [`${terminalPairs[0] || "S1-S2"} : ${ratio}${suffixText}`];
  }
  return [];
}

function getTapTurnValues(core: CoreData, ratioParts: ParsedRatio): number[] {
  const totalTurns = parseNumber(core.sec_total_turns);
  const segmentTurns = [
    core.sec_turns_s1s2,
    core.sec_turns_s2s3,
    core.sec_turns_s3s4,
    core.sec_turns_s4s5,
  ].map(parseNumber).filter((value): value is number => Number.isFinite(value) && value > 0);
  const terminalTapCount = Math.max(getTerminalNames(core, 0).length - 1, 0);
  const tapCount = Math.max(terminalTapCount, segmentTurns.length, totalTurns ? 1 : 0);

  if (tapCount > 0) {
    let cumulativeTurns = 0;
    return Array.from({ length: tapCount }, (_, index) => {
      cumulativeTurns += segmentTurns[index] || 0;
      if (tapCount === 1) return totalTurns || cumulativeTurns || segmentTurns[0];
      if (index === tapCount - 1 && totalTurns) return totalTurns;
      return cumulativeTurns || totalTurns || segmentTurns[index];
    }).filter((value): value is number => Number.isFinite(value) && value > 0);
  }

  return ratioParts.primaryValues.length > 1
    ? [...ratioParts.primaryValues].sort((a, b) => a - b).slice(0, 4)
    : ratioParts.primaryValues.slice(0, 1);
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

function getTapTerminalPairs(core: CoreData | undefined, count: number): string[] {
  const terminalNames = getTerminalNames(core, Math.max(count + 1, 3));
  const firstTerminal = terminalNames[0] || "S1";
  return Array.from({ length: count }, (_, index) => {
    const endTerminal = terminalNames[index + 1] || fallbackTerminalName(firstTerminal, index + 2);
    return `${firstTerminal}-${endTerminal}`;
  });
}

function getTerminalNames(core: CoreData | undefined, minimumCount = 3): string[] {
  const terminalText = `${core?.sec_ter_marking || ""} ${core?.wire_colour || ""}`;
  const parsed = parseTerminalNames(terminalText);
  const minimum = minimumCount > 0 ? Math.max(minimumCount, 3) : 0;
  const count = Math.min(Math.max(parsed.length, minimum), 5);
  if (parsed.length >= count) return parsed.slice(0, count);
  if (count === 0) return [];

  const firstTerminal = parsed[0] || "S1";
  const names = [...parsed];
  while (names.length < count) {
    names.push(fallbackTerminalName(firstTerminal, names.length + 1));
  }
  return names;
}

function parseTerminalNames(value: string): string[] {
  const terminals = cleanValue(value).match(/\d*S[1-5]/gi) || [];
  return terminals
    .map((terminal) => terminal.toUpperCase())
    .filter((terminal, index, items) => items.indexOf(terminal) === index);
}

function fallbackTerminalName(firstTerminal: string, terminalNumber: number): string {
  const match = firstTerminal.match(/^(\d*)S\d+$/i);
  return `${match?.[1] || ""}S${terminalNumber}`;
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

  return (
    compact.match(/\b\d+(?:\.\d+)?P\d+\b/)?.[0] ||
    compact.match(/\b(?:PS|PX|PR|TPX|TPY|TPZ)\b/)?.[0] ||
    compact.match(/\b\d+(?:\.\d+)?S\b/)?.[0] ||
    text.match(/\b\d+(?:\.\d+)?\b(?!\s*(?:VA|A|V|KV|KA|HZ|SEC)\b)/i)?.[0] ||
    compact
  );
}

function hasCoreData(core: CoreData): boolean {
  return Boolean(core.ratio || core.burden_va || core.accuracy_class || core.sec_ter_marking || core.wire_colour);
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
  return burden.replace(/\s*VA\b/i, " VA");
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
  const compact = standard.replace(/\s+/g, "").toUpperCase();
  const iecStandard = compact.match(/^IEC:?(\d+)/);
  if (iecStandard) return `IEC ${iecStandard[1]}`;
  const isStandard = compact.match(/^IS:?(\d+)/);
  if (isStandard) return `IS ${isStandard[1]}`;
  return standard.replace(/\s*:\s*/g, " ").replace(/\s+/g, " ");
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

function mmToPt(value: number): number {
  return value * MM_TO_PT;
}

const styles = StyleSheet.create({
  page: {
    padding: 0,
    fontFamily: "Helvetica",
    color: "#000000",
    backgroundColor: "#ffffff",
  },
  label: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: "#000000",
    borderStyle: "solid",
    justifyContent: "center",
    minHeight: "100%",
    maxHeight: "100%",
    borderRadius: 20,
    position: "relative",
    overflow: "hidden",
  },
  content: {
    paddingLeft: 5,
    paddingRight: 43,
    paddingTop: 4,
    paddingBottom: 4,
  },
  mfg: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.6,
    lineHeight: 1.05,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  identityLeft: {
    width: "53%",
    fontFamily: "Helvetica-Bold",
    fontSize: 9.2,
    lineHeight: 1.05,
  },
  identityRight: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.8,
    lineHeight: 1.05,
  },
  ctrLine: {
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.7,
    lineHeight: 1.02,
  },
  tapRows: {
    marginTop: 2,
  },
  tapRow: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.7,
    lineHeight: 1.04,
  },
  wireColour: {
    marginTop: 2,
    fontFamily: "Helvetica-Bold",
    fontSize: 7.8,
    lineHeight: 1.02,
  },
  electricalRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  electricalText: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.4,
    lineHeight: 1.02,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  iecText: {
    flex: 1,
    fontFamily: "Helvetica-Bold",
    fontSize: 8.4,
    lineHeight: 1.02,
  },
  madeInIndia: {
    width: "48%",
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 8.4,
    lineHeight: 1.02,
  },
  terminalWrap: {
    position: "absolute",
    right: 6,
    top: 31,
    width: 34,
    alignItems: "center",
  },
  terminalPrimary: {
    fontSize: 8.8,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1,
  },
  terminalBox: {
    width: 34,
    height: 24,
    borderWidth: 1.2,
    borderColor: "#000000",
    borderStyle: "solid",
    marginTop: 2,
    marginBottom: 2,
    paddingTop: 4,
    paddingHorizontal: 4,
  },
  terminalSquares: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  terminalSquare: {
    width: 4.5,
    height: 4.5,
    borderWidth: 1,
    borderColor: "#000000",
    borderStyle: "solid",
  },
  terminalNames: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 4,
  },
  terminalName: {
    fontSize: 10,
    fontFamily: TERMINAL_FONT_FAMILY,
    fontWeight: 875,
    lineHeight: 1,
  },
});

function TerminalDiagram({ terminalNames }: { terminalNames: string[] }) {
  const names = terminalNames.length ? terminalNames : ["S1", "S2", "S3"];
  return (
    <View style={styles.terminalWrap}>
      <Text style={styles.terminalPrimary}>P1</Text>
      <View style={styles.terminalBox}>
        <View style={styles.terminalSquares}>
          {names.map((name) => <View key={`${name}-square`} style={styles.terminalSquare} />)}
        </View>
        <View style={styles.terminalNames}>
          {names.map((name) => <Text key={name} style={styles.terminalName}>{name}</Text>)}
        </View>
      </View>
      <Text style={styles.terminalPrimary}>P2</Text>
    </View>
  );
}

import type { ItemInput } from "@/api-client";

type ParsedItem = Partial<ItemInput>;

const FIELD_PATTERNS: Array<[keyof ItemInput, RegExp[]]> = [
  ["ct_type", [/\bCT\s*TYPE\b/i, /\bTYPE\s+OF\s+CT\b/i]],
  ["cust_part_code", [/\bCUSTOMER\s*(?:PART|ITEM)\s*(?:CODE|NO\.?|NUMBER)\b/i, /\bCUST\.?\s*PART\s*(?:CODE|NO\.?)\b/i]],
  ["ratio", [/\b(?:CURRENT\s+)?RATIO\b/i]],
  ["rated_voltage", [/\bRATED\s+VOLTAGE\b/i, /\bSYSTEM\s+VOLTAGE\b/i]],
  ["stc", [/\bSTC\b/i, /\bSHORT\s+TIME\s+CURRENT\b/i]],
  ["insulation_level", [/\bINSULATION\s+LEVEL\b/i, /\bINS\.?\s+LEVEL\b/i]],
  ["frequency", [/\bFREQUENCY\b/i, /\bFREQ\.?\b/i]],
  ["ref_std", [/\bREF\.?\s*(?:STD|STANDARD)\b/i, /\bAPPLICABLE\s+STANDARD\b/i]],
  ["ct_final_dim", [/\bCT\s+FINAL\s+DIM(?:ENSION)?S?\b/i, /\bOVERALL\s+DIM(?:ENSION)?S?\b/i]],
  ["ga_drg", [/\bGA\s*(?:DRG|DRAWING)(?:\s*NO\.?)?\b/i, /\bDRAWING\s*NO\.?\b/i]],
  ["ins_class", [/\bINS(?:ULATION)?\s+CLASS\b/i]],
  ["pri_turns", [/\bPRI(?:MARY)?\s+(?:TOTAL\s+)?TURNS?\b/i]],
  ["pri_copper", [/\bPRI(?:MARY)?\s+COPPER\b/i]],
  ["former", [/\bFORMER\b/i]],
  ["pri_length", [/\bPRI(?:MARY)?\s+(?:WIRE\s+)?LENGTH\b/i]],
  ["pri_weight", [/\bPRI(?:MARY)?\s+(?:COPPER\s+)?WEIGHT\b/i]],
  ["sec_terminal", [/\bSEC(?:ONDARY)?\s+TERMINALS?\b/i]],
  ["total_weight", [/\bTOTAL\s+WEIGHT\b/i]],
];

const CORE_PATTERNS: Array<[string, RegExp[]]> = [
  ["burden_va", [/\bBURDEN(?:\s*\(VA\))?\b/i]],
  ["accuracy_class", [/\bACCURACY\s+CLASS\b/i]],
  ["isf", [/\bISF\b/i]],
  ["min_knee_pt_volt", [/\bMIN\.?\s*KNEE\s*(?:PT\.?|POINT)?\s*VOLT(?:AGE)?\b/i]],
  ["max_rct_75c", [/\bMAX\.?\s*RCT(?:\s*@?\s*75\s*°?C)?\b/i]],
  ["max_exc_vk2", [/\bMAX\.?\s*EXC(?:ITATION)?\s*(?:C\/N|CURRENT)?\b/i]],
  ["bare_core_dim", [/\b(?:BARE\s+)?CORE\s+DIM(?:ENSION)?S?\b/i]],
  ["core_material", [/\bCORE\s+MATERIAL\b/i]],
  ["core_weight_kg", [/\bCORE\s+WEIGHT\b/i]],
  ["sec_total_turns", [/\bSEC(?:ONDARY)?\s+TOTAL\s+TURNS?\b/i]],
  ["sec_ter_marking", [/\bSEC(?:ONDARY)?\s+(?:TER\.?|TERMINAL)\s+MARKING\b/i]],
  ["sec_cond_s1s2", [/\bSEC(?:ONDARY)?\s+CONDUCTOR(?:\s*\(S1\s*[-–]\s*S2\))?\b/i]],
  ["finished_core_dim", [/\bFINISHED\s+CORE\s+DIM(?:ENSION)?S?\b/i]],
  ["sec_connection", [/\bSEC(?:ONDARY)?\s+CONNECTION\b/i]],
  ["wire_length", [/\bWIRE\s+LENGTH\b/i]],
  ["wire_colour", [/\bWIRE\s+COLOU?R\b/i]],
];

export function parseDrawingItemFields(rawText: string): ParsedItem {
  const lines = rawText
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const result: ParsedItem = {};

  for (const [key, patterns] of FIELD_PATTERNS) {
    const value = findLabelValue(lines, patterns, (candidate) => validateItemField(key, candidate));
    if (value) (result as any)[key] = value;
  }

  const core1: Record<string, string> = {};
  for (const [key, patterns] of CORE_PATTERNS) {
    const value = findLabelValue(lines, patterns, (candidate) => validateCoreField(key, candidate));
    if (value) core1[key] = value;
  }
  if (result.ratio) core1.ratio = result.ratio;
  if (Object.keys(core1).length) result.core1 = core1;
  applyCompactCtSpecification(rawText, result);
  applyStructuredCtDetailRows(lines, result);
  return result;
}

function applyStructuredCtDetailRows(lines: string[], result: ParsedItem): void {
  const candidates = [lines.join(" "), ...lines.flatMap((line, index) => [
    line,
    `${line} ${lines[index + 1] || ""}`,
    `${line} ${lines[index + 1] || ""} ${lines[index + 2] || ""}`,
  ])];
  for (const rawLine of candidates) {
    const line = normalizeEngineeringOcr(rawLine).toUpperCase().replace(/\s+/g, " ");
    const coreMatch = line.match(/\bCORE\s*([123])\b/);
    const ratioMatch = line.match(/\b(\d+(?:\s*[-/]\s*\d+){0,4}\s*[/ :]\s*\d+(?:\.\d+)?\s*A)\b/);
    const burdenMatch = line.match(/\b(\d+(?:[.,]\d+)?)\s*VA\b/);
    if (!coreMatch || !ratioMatch || !burdenMatch) continue;

    const coreNumber = Number(coreMatch[1]);
    const ratio = normalizeRatio(ratioMatch[1]);
    const afterRatio = line.slice((ratioMatch.index || 0) + ratioMatch[0].length);
    const accuracy = afterRatio.match(/\b(PX|PS|\d+(?:\.\d+)?S?(?:P\d+)?)\b/)?.[1] || "";
    const frequency = line.match(/\b(50\s*\/\s*60|50|60)\s*(?:HZ)?\b/)?.[1]?.replace(/\s+/g, "") || "";
    const insulationMatch = line.match(/\b(\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?(?:\s*\/\s*-?)?)\s*KV(?:P)?\b/);
    const insulation = insulationMatch ? `${insulationMatch[1].replace(/\s+/g, "")}kV` : "";
    let insulationClass = "";
    let weight = "";
    if (insulationMatch && insulationMatch.index !== undefined) {
      const tail = line.slice(insulationMatch.index + insulationMatch[0].length).trim();
      const tailMatch = tail.match(/^([A-Z])\b(?:\s+(\d+(?:\.\d+)?))?/);
      insulationClass = tailMatch?.[1] || "";
      weight = tailMatch?.[2] || "";
    }

    const coreKey = `core${coreNumber}` as "core1" | "core2" | "core3";
    const core = { ...(result[coreKey] || {}) };
    if (ratio) core.ratio = ratio;
    if (accuracy) core.accuracy_class = accuracy;
    core.burden_va = `${burdenMatch[1].replace(",", ".")}VA`;
    result[coreKey] = core;
    if (coreNumber === 1 && ratio) result.ratio = ratio;
    if (frequency) result.frequency = `${frequency}Hz`;
    if (insulation) result.insulation_level = insulation;
    if (insulationClass) result.ins_class = insulationClass;
    if (weight) result.total_weight = `${weight}kg`;
  }

  const text = lines.join(" ").toUpperCase();
  if (/\bRESIN\s+CAST\s+RING\s+TYPE\b/.test(text)) result.ct_type = "RESIN CAST CT";
  else if (/\bPVC\s+TAPE\s+INSULATED\b/.test(text)) result.ct_type = "PVC TAPE INSULATED CT";
  else if (/\bFG\s+TAPE\s+INSULATED\b/.test(text)) result.ct_type = "FG TAPE INSULATED CT";
  else if (/\bVARNISHED\s+INSULATED\b/.test(text)) result.ct_type = "VARNISHED INSULATED CT";
}

function applyCompactCtSpecification(rawText: string, result: ParsedItem): void {
  const text = normalizeEngineeringOcr(rawText)
    .toUpperCase()
    .replace(/[‐‑–—]/g, "-")
    .replace(/\b0D\b/g, "OD")
    .replace(/\b1D\b/g, "ID")
    .replace(/\s+/g, " ");
  const core1 = { ...(result.core1 || {}) } as Record<string, string>;

  const compactRatio = text.match(
    /\b(?:PROTECTION|METERING|MEASURING)?\s*CT\s*[:=-]?\s*(\d+(?:\s*[\/-]\s*\d+){0,4})\s*[:/]\s*(\d+(?:\.\d+)?)\s*A\b/
  );
  const standaloneRatio = text.match(
    /\b(\d{2,5}(?:\s*[\/-]\s*\d{1,5}){0,4})\s*[:/]\s*(\d+(?:[.,]\d+)?)\s*A\b/
  );
  const conventionalRatio = text.match(
    /\b(\d+(?:\s*-\s*\d+){0,4})\s*\/\s*(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?){0,2})\s*A\b/
  );
  const ratioMatch = compactRatio || standaloneRatio || conventionalRatio;
  if (ratioMatch) {
    const primary = ratioMatch[1].replace(/\s*[\/-]\s*/g, "-");
    const secondary = ratioMatch[2].replace(",", ".").replace(/\s*-\s*/g, "-");
    result.ratio = `${primary}/${secondary}A`;
    core1.ratio = result.ratio;
  }

  const burden = text.match(/\b(\d+(?:\.\d+)?)\s*VA\b/);
  if (burden) core1.burden_va = `${burden[1]}VA`;

  const accuracy = text.match(/\bCL(?:ASS)?\.?\s*[:=-]?\s*(PX|PS|\d+(?:\.\d+)?S?(?:P\d+)?)\b/);
  if (accuracy) core1.accuracy_class = accuracy[1];

  const frequency = text.match(/\b(50\s*\/\s*60|50|60)\s*HZ\b/);
  if (frequency) result.frequency = `${frequency[1].replace(/\s+/g, "")}Hz`;

  const kneePoints = Array.from(text.matchAll(/\bVK(?:FP|P)?\s*[:=>-]?\s*((?:\d+(?:[.,]\d+)?\s*\/?\s*)+)V\b/g));
  const kneeSequences = kneePoints
    .map((match) => match[1].match(/\d+(?:[.,]\d+)?/g)?.map((value) => Number(value.replace(",", "."))) || [])
    .filter((values) => values.length);
  if (kneeSequences.length) {
    const length = Math.max(...kneeSequences.map((values) => values.length));
    const values = Array.from({ length }, (_, index) =>
      Math.max(...kneeSequences.map((sequence) => sequence[index] || 0))
    ).filter((value) => value > 0).map(formatDimension);
    if (values.length) core1.min_knee_pt_volt = `VK>${values.join("/")}V`;
  }

  const dimensions = extractIdOdHeight(text);
  if (dimensions) result.ct_final_dim = dimensions;

  const insulation = text.match(/\b(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*KV(?:P)?\b/);
  if (insulation) result.insulation_level = `${insulation[1]}/${insulation[2]}kV`;

  const ratedVoltage = text.match(/\b(?:RATED|SYSTEM)\s+(?:VOLTAGE|VOLT\.?)\s*[:=-]?\s*(\d+(?:\.\d+)?)\s*KV\b/);
  if (ratedVoltage) result.rated_voltage = `${ratedVoltage[1]}kV`;

  const stc = text.match(/\b(\d+(?:\.\d+)?)\s*KA\s*[/@]?\s*(\d+(?:\.\d+)?)\s*(?:SEC|S)\b/);
  if (stc) result.stc = `${stc[1]}kA/${stc[2]}sec`;

  const standard = text.match(/\b(?:IEC|IS)\s*[: -]?\s*\d{4,6}(?:\s*[-&/]\s*\d+)*\b/);
  if (standard) result.ref_std = standard[0].replace(/\s+/g, "");

  if (Object.keys(core1).length) result.core1 = core1;
}

function extractIdOdHeight(text: string): string {
  const labelledId = findDimensionValues(text, /\bI\s*D\s*[:=@]?\s*(\d+(?:\.\d+)?(?:\s*[X*]\s*\d+(?:\.\d+)?)?)/);
  const labelledOd = findDimensionValues(text, /\bO\s*D\s*[:=@]?\s*(\d+(?:\.\d+)?(?:\s*[X*]\s*\d+(?:\.\d+)?)?)/);
  const labelledHeights = findDimensionValues(text, /\b(?:LGH|LGHT|LGT|HGT|HT|HEIGHT|LENGTH|H)\s*[:=@]?\s*(\d+(?:\.\d+)?)/);
  if (labelledId.length && labelledOd.length && labelledHeights.length) {
    if (labelledId.length === 1 && labelledOd.length === 1) {
      return `${formatDimension(labelledId[0])}X${formatDimension(labelledOd[0])}X${formatDimension(labelledHeights[0])}`;
    }
    return `ID:${labelledId.map(formatDimension).join("X")}, OD:${labelledOd.map(formatDimension).join("X")}, HT:${formatDimension(labelledHeights[0])}`;
  }

  const sequence = text.match(
    /(?:\bID|\bD)\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b[\s\S]{0,120}?\bOD\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b[\s\S]{0,120}?\b(?:LGH|LGHT|LGT|HGT|HT|HEIGHT|LENGTH|H|D)\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b/
  );
  if (sequence) {
    return `${formatDimension(Number(sequence[1]))}X${formatDimension(Number(sequence[2]))}X${formatDimension(Number(sequence[3]))}`;
  }
  const id = findDimension(text, /\bI\s*D\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b/);
  const od = findDimension(text, /\bO\s*D\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b/);
  const labelledHeight = findDimension(text, /\b(?:LGH|LGHT|LGT|HGT|HT|HEIGHT|LENGTH|H)\s*[:=@]?\s*(\d+(?:\.\d+)?)\s*(?:MM)?\b/);
  const calloutHeight = findDimension(text, /\bMAXIMUM\s+(?!O\s*D\b)(?:L\s*)?(\d+(?:\.\d+)?)\s*(?:MM)?\b/);
  const height = labelledHeight || calloutHeight;
  if (id && od && height) {
    return `${formatDimension(id)}X${formatDimension(od)}X${formatDimension(height)}`;
  }

  const qualified = extractMinMaxRingDimensions(text);
  if (qualified) return qualified;
  return "";
}

function findDimensionValues(text: string, pattern: RegExp): number[] {
  const expression = text.match(pattern)?.[1];
  return expression?.match(/\d+(?:\.\d+)?/g)?.map(Number).filter((value) => value > 0) || [];
}

function extractMinMaxRingDimensions(text: string): string {
  const normalized = text
    .replace(/\)XAM\(\s*(\d+(?:\.\d+)?)/g, (_match, value) => `${reverseNumericToken(value)} MAX`)
    .replace(/\)NIM\(\s*(\d+(?:\.\d+)?)/g, (_match, value) => `${reverseNumericToken(value)} MIN`);
  const minimums = collectQualifiedNumbers(normalized, "MIN");
  const maximums = collectQualifiedNumbers(normalized, "MAX");
  if (!minimums.length || maximums.length < 2) return "";

  const od = Math.max(...maximums);
  const idCandidates = minimums.filter((value) => value > 5 && value < od);
  if (!idCandidates.length) return "";
  const id = Math.max(...idCandidates);
  const heightCandidates = maximums.filter((value) => value !== od && value > 5);
  if (!heightCandidates.length) return "";
  const height = Math.max(...heightCandidates);
  if (!(id < od) || height > 1000) return "";
  return `${formatDimension(id)}X${formatDimension(od)}X${formatDimension(height)}`;
}

function reverseNumericToken(value: string): string {
  return value.split("").reverse().join("");
}

function collectQualifiedNumbers(text: string, qualifier: "MIN" | "MAX"): number[] {
  const values: number[] = [];
  const afterNumber = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:MM)?\\s*\\(?${qualifier}(?:IMUM)?\\)?`, "g");
  const opposite = qualifier === "MIN" ? "MAX" : "MIN";
  const beforeNumber = new RegExp(`\\b${qualifier}(?:IMUM)?\\s*(?:I?D|O?D|DIA(?:METER)?)?\\s*[@:=Ø]?\\s*(\\d+(?:\\.\\d+)?)(?![\\d.])(?!\\s*(?:MM)?\\s*\\(?${opposite})`, "g");
  for (const match of text.matchAll(afterNumber)) values.push(Number(match[1]));
  for (const match of text.matchAll(beforeNumber)) values.push(Number(match[1]));
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0)));
}

function findDimension(text: string, pattern: RegExp): number | null {
  const value = Number(text.match(pattern)?.[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatDimension(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function normalizeEngineeringOcr(value: string): string {
  return value
    .replace(/PROTECT[!|1IL]ON/gi, "PROTECTION")
    .replace(/(?:\[|\||\()\s*D(?=\s*[:=@]?\s*\d)/gi, "ID")
    .replace(/\bMAX\s*T?MUM\b/gi, "MAXIMUM")
    .replace(/\bMIN\s*T?MUM\b/gi, "MINIMUM")
    .replace(/\bI\s*D\s*[@:=]?\s*(\d)\s*&\s*(\d)\b/gi, "ID:$1$2")
    .replace(/\bC\s+T\b/gi, "CT")
    .replace(/\bV\s+A\b/gi, "VA")
    .replace(/\bH\s+Z\b/gi, "HZ")
    .replace(/(\d)O(?=\d|[.\/:A-Z])/gi, (_match, prefix) => `${prefix}0`)
    .replace(/([\/:.-])O(?=\d)/gi, (_match, prefix) => `${prefix}0`);
}

function findLabelValue(
  lines: string[],
  patterns: RegExp[],
  validate: (candidate: string) => string
): string {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match || match.index === undefined) continue;
      const after = line
        .slice(match.index + match[0].length)
        .replace(/^[\s:;=|.\-–]+/, "")
        .trim();
      const inline = validate(cleanValue(after));
      if (inline) return inline;
      for (let offset = 1; offset <= 3; offset += 1) {
        const next = cleanValue(lines[index + offset] || "");
        if (next && !looksLikeLabel(next)) {
          const accepted = validate(next);
          if (accepted) return accepted;
        }
      }
    }
  }
  return "";
}

function validateItemField(key: keyof ItemInput, rawValue: string): string {
  const value = rawValue.trim();
  const upper = value.toUpperCase();
  switch (key) {
    case "ct_type":
      return /^(?:PVC|FG|RESIN|VARNISHED|TAPE)[ A-Z-]*(?:CT|CURRENT TRANSFORMER)$/.test(upper) ? upper : "";
    case "cust_part_code":
      return /^[A-Z]{1,8}[A-Z0-9 /.-]*\d[A-Z0-9 /.-]*$/i.test(value) ? value : "";
    case "ratio":
      return normalizeRatio(value);
    case "rated_voltage":
      return /^\d+(?:\.\d+)?\s*KV$/i.test(value) ? value.replace(/\s+/g, "") : "";
    case "stc":
      return /\d+(?:\.\d+)?\s*KA.*\d+(?:\.\d+)?\s*(?:S|SEC)\b/i.test(value) ? value : "";
    case "insulation_level":
      return /^\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*KV(?:P)?$/i.test(value) ? value.replace(/\s+/g, "") : "";
    case "frequency": {
      const match = upper.match(/^(50\s*\/\s*60|50|60)\s*HZ$/);
      return match ? `${match[1].replace(/\s+/g, "")}Hz` : "";
    }
    case "ref_std":
      return /^(?:BS\s*EN\s*)?(?:IEC|IS)\s*[: -]?\s*\d{4,6}(?:\s*[-&/]\s*\d+)*\.?$/i.test(value) ? value : "";
    case "ct_final_dim":
      return normalizeDimensionValue(value);
    case "ga_drg":
      return /^(?=.*\d)[A-Z0-9][A-Z0-9 /().-]{3,50}$/i.test(value) ? value : "";
    case "ins_class":
      return /^[A-Z]$/i.test(value) ? upper : "";
    case "pri_turns":
      return /^\d+(?:\.\d+)?$/.test(value) ? value : "";
    case "pri_length":
      return /^\d+(?:\.\d+)?\s*(?:MM|M|METER|METRE)$/i.test(value) ? value : "";
    case "pri_weight":
    case "total_weight":
      return /^\d+(?:\.\d+)?\s*KG$/i.test(value) ? value : "";
    case "pri_copper":
      return /(?:SWG|SQMM|MM2|MM²|COPPER|CU\b)/i.test(value) ? value : "";
    case "former":
      return /(?:FORMER|BAKELITE|PVC|NYLON|RESIN|\d+\s*[X*]\s*\d+)/i.test(value) ? value : "";
    case "sec_terminal":
      return /(?:TERMINAL|INSERT|CONNECTOR|\bM\d+\b|\bS\d\b)/i.test(value) ? value : "";
    default:
      return "";
  }
}

function validateCoreField(key: string, rawValue: string): string {
  const value = rawValue.trim();
  const upper = value.toUpperCase();
  switch (key) {
    case "burden_va": {
      const match = upper.match(/^(\d+(?:[.,]\d+)?)\s*VA$/);
      return match ? `${match[1].replace(",", ".")}VA` : "";
    }
    case "accuracy_class":
      return /^(?:PX|PS|\d+(?:\.\d+)?S?(?:P\d+)?)$/.test(upper) ? upper : "";
    case "isf":
      return /^(?:ISF\s*)?\d+(?:\.\d+)?$/.test(upper) ? value : "";
    case "min_knee_pt_volt":
      return /(?:VK|VKP|VOLT)|\d+(?:\.\d+)?\s*V\b/i.test(value) ? value : "";
    case "max_rct_75c":
      return /(?:RCT|OHM|Ω)/i.test(value) ? value : "";
    case "max_exc_vk2":
      return /(?:VK|MA|EXC|IMAG)/i.test(value) ? value : "";
    case "bare_core_dim":
    case "finished_core_dim":
      return normalizeDimensionValue(value);
    case "core_material":
      return /\b(?:M3|M4|NANO|CRGO|ZDKH|MU-METAL|SILICON STEEL)\b/i.test(value) ? value : "";
    case "core_weight_kg":
    case "sec_copper_wt":
      return /^\d+(?:\.\d+)?\s*KG$/i.test(value) ? value : "";
    case "sec_total_turns":
    case "sec_turns_s1s2":
    case "sec_turns_s2s3":
    case "sec_turns_s3s4":
    case "sec_turns_s4s5":
      return /^\d+$/.test(value) ? value : "";
    case "sec_ter_marking":
      return /^(?:\d?[A-Z]*S\d)(?:\s*-\s*\d?[A-Z]*S\d){1,4}$/i.test(value) ? value : "";
    case "sec_cond_s1s2":
      return /(?:SWG|SQMM|MM²|MM2)/i.test(value) ? value : "";
    case "wire_length":
      return /^\d+(?:\.\d+)?\s*(?:MM|M|METER|METRE)$/i.test(value) ? value : "";
    case "wire_colour":
      return /^(?:RED|BLACK|WHITE|BLUE|YELLOW|GREY|GRAY|GREEN|BROWN)(?:\s*[,/&-]\s*(?:RED|BLACK|WHITE|BLUE|YELLOW|GREY|GRAY|GREEN|BROWN))*$/i.test(value) ? upper : "";
    case "sec_connection":
      return /(?:INSERT|TERMINAL|CONNECTOR|WIRE|CABLE|M\d)/i.test(value) ? value : "";
    default:
      return "";
  }
}

function normalizeRatio(value: string): string {
  const match = value.toUpperCase().match(/^(\d+(?:\s*[\/-]\s*\d+){0,4})\s*[:/]\s*(\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)*)\s*A?$/);
  if (!match) return "";
  return `${match[1].replace(/\s*[\/-]\s*/g, "-")}/${match[2].replace(/,/g, ".").replace(/\s+/g, "")}A`;
}

function normalizeDimensionValue(value: string): string {
  const numbers = value.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 3 || numbers.length > 5) return "";
  if (!/[X*×]|\b(?:ID|OD|HT|HGT|LGH|HEIGHT)\b/i.test(value)) return "";
  return numbers.map((number) => formatDimension(Number(number))).join("X");
}

function cleanValue(value: string): string {
  let cleaned = value
    .replace(/\s*[|]\s*.*$/, "")
    .replace(/\s{2,}.*$/, "")
    .trim();
  const nextLabelAt = [...FIELD_PATTERNS, ...CORE_PATTERNS]
    .flatMap(([, patterns]) => patterns.map((pattern) => cleaned.search(pattern)))
    .filter((index) => index > 0)
    .sort((a, b) => a - b)[0];
  if (nextLabelAt !== undefined) cleaned = cleaned.slice(0, nextLabelAt).trim();
  if (!cleaned || cleaned.length > 80 || /^[\W_]+$/.test(cleaned)) return "";
  return cleaned;
}

function looksLikeLabel(value: string): boolean {
  return [...FIELD_PATTERNS, ...CORE_PATTERNS].some(([, patterns]) =>
    patterns.some((pattern) => pattern.test(value))
  );
}

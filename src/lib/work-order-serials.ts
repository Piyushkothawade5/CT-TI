type WorkOrderSerialRecord = {
  id?: string | null;
  sr_no?: string | null;
};

type BuildWorkOrderSerialRangeArgs = {
  ctType?: string | null;
  quantity?: string | null;
  records?: WorkOrderSerialRecord[];
  currentRecordId?: string | null;
  date?: Date;
};

const CT_TYPE_SERIAL_CODES: Record<string, string> = {
  "FG INSULATED CT": "TPC",
  "FG TAPE INSULATED CT": "TPC",
  "PLASIC CASE CT": "PCT",
  "PLASTIC CASE CT": "PCT",
  "PVC TAPE INSULATED CT": "TPC",
  "RED COLOUR TAPE INSULATED CT": "TPC",
  "RESIN CAST CT": "RCC",
  "RESIN CASTCT": "RCC",
  "RESIN INSULATED CT": "RCC",
  "TAPE INSULATED CT": "TPC",
  "TAPE WOUND CT": "TPC",
  "TAPE WOUNDC CT": "TPC",
  "VARNISHED INSULATED CT": "TPC",
};

export function buildWorkOrderSerialRange({
  ctType,
  quantity,
  records = [],
  currentRecordId,
  date = new Date(),
}: BuildWorkOrderSerialRangeArgs): string {
  const ctCode = getWorkOrderSerialCtCode(ctType);
  const count = parseWorkOrderQuantity(quantity);
  if (!ctCode || !count) return "";

  const yearMonth = formatSerialYearMonth(date);
  const startSequence = getNextWorkOrderSerialSequence(records, yearMonth, currentRecordId);
  const endSequence = startSequence + count - 1;
  const startSerial = formatWorkOrderSerial(yearMonth, ctCode, startSequence);

  if (count === 1) return startSerial;

  return `${startSerial} to ${formatWorkOrderSerial(yearMonth, ctCode, endSequence)}`;
}

export function getWorkOrderSerialCtCode(ctType?: string | null): string {
  const normalized = normalizeSerialCtType(ctType);
  if (!normalized) return "";

  if (CT_TYPE_SERIAL_CODES[normalized]) return CT_TYPE_SERIAL_CODES[normalized];
  if (normalized.includes("RESIN CAST")) return "RCC";
  if (normalized.includes("PLASTIC CASE") || normalized.includes("PLASIC CASE")) return "PCT";
  if (
    normalized.includes("TAPE INSULATED") ||
    normalized.includes("TAPE WOUND") ||
    normalized.includes("VARNISHED INSULATED")
  ) {
    return "TPC";
  }

  return "";
}

export function parseWorkOrderQuantity(quantity?: string | null): number {
  const match = String(quantity || "").match(/\d[\d,]*/);
  const value = match ? Number(match[0].replace(/,/g, "")) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function getNextWorkOrderSerialSequence(
  records: WorkOrderSerialRecord[],
  yearMonth: string,
  currentRecordId?: string | null
): number {
  const maxSequence = records.reduce((max, record) => {
    if (currentRecordId && record.id === currentRecordId) return max;
    return Math.max(max, getMaxSerialSequence(record.sr_no, yearMonth));
  }, 0);

  return maxSequence + 1;
}

function getMaxSerialSequence(serialRange?: string | null, yearMonth?: string): number {
  const serialText = String(serialRange || "");
  const pattern = /(\d{4})(?:00)?[A-Z]{3}(\d{5,})/gi;
  let maxSequence = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(serialText)) !== null) {
    if (yearMonth && match[1] !== yearMonth) continue;
    const sequence = Number(match[2]);
    if (Number.isFinite(sequence)) maxSequence = Math.max(maxSequence, sequence);
  }

  return maxSequence;
}

function formatSerialYearMonth(date: Date): string {
  const year = date.getFullYear() % 100;
  const month = date.getMonth() + 1;
  return `${String(year).padStart(2, "0")}${String(month).padStart(2, "0")}`;
}

function formatWorkOrderSerial(yearMonth: string, ctCode: string, sequence: number): string {
  return `${yearMonth}${ctCode}${String(sequence).padStart(5, "0")}`;
}

function normalizeSerialCtType(value?: string | null): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .toUpperCase();
}

import { parseWorkOrderQuantity } from "@/lib/work-order-serials";

export type LabelProgress =
  | { kind: "none" }
  | { kind: "pending"; total: number }
  | { kind: "partial"; issued: number; total: number; seq: string }
  | { kind: "done" };

// The minimal per-TI label fields this needs — satisfied by both TiLabelStatus
// and TiLabelSummary from the api-client.
export type LabelStatusLike = { label_qty: number | null; labels_issued: number };

// The serial at print position `count` (1-based) for a serial range like
// "2609TPC00641 to 2609TPC00643" — returns just the zero-padded sequence, e.g.
// "00641". Empty string when the range can't be parsed.
export function serialSequenceAt(srNo: string | null | undefined, count: number): string {
  const match = String(srNo || "").match(/\d{4}(?:00)?[A-Za-z]{3}(\d{5,})/);
  if (!match) return "";
  const startSeq = Number(match[1]);
  if (!Number.isFinite(startSeq)) return "";
  const seq = startSeq + Math.max(1, count) - 1;
  return String(seq).padStart(match[1].length, "0");
}

// Print progress for one record from its TI's label status. `total` prefers the
// explicit label quota and falls back to the record quantity. No status row (TI
// reserved but not generated, or offline) resolves to "none" (unknown).
export function computeLabelProgress(
  qty: string | null | undefined,
  srNo: string | null | undefined,
  status: LabelStatusLike | null | undefined
): LabelProgress {
  if (!status) return { kind: "none" };

  const total =
    status.label_qty != null && status.label_qty > 0 ? status.label_qty : parseWorkOrderQuantity(qty);
  if (!total) return { kind: "none" };

  const issued = status.labels_issued;
  if (issued >= total) return { kind: "done" };
  if (issued <= 0) return { kind: "pending", total };
  return { kind: "partial", issued, total, seq: serialSequenceAt(srNo, issued) };
}

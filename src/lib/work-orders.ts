import type { TiRecordInput } from "@/api-client";
import { normalizeItemNo, normalizeItemTiFormat, type ItemTiFormat } from "@/lib/item-ti-compatibility";

export type WorkOrderFormData = {
  work_order: string;
  customer: string;
  po_no: string;
  po_date: string;
  po_line_no: string;
  item_code: string;
  our_item_code: string;
  specification: string;
  qty: string;
  sr_no: string;
  ti_no: string;
  traceability_sr_no: string;
};

export type WorkOrderRecord = WorkOrderFormData & {
  id: string;
  created_by?: string;
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  ti_synced_at?: string | null;
};

export const WORK_ORDER_STORAGE_KEY = "ct_work_order_records";

export const EMPTY_WORK_ORDER: WorkOrderFormData = {
  work_order: "",
  customer: "",
  po_no: "",
  po_date: "",
  po_line_no: "",
  item_code: "",
  our_item_code: "",
  specification: "",
  qty: "",
  sr_no: "",
  ti_no: "",
  traceability_sr_no: "",
};

export function readWorkOrderRecords(): WorkOrderRecord[] {
  try {
    return JSON.parse(localStorage.getItem(WORK_ORDER_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeWorkOrderRecords(records: WorkOrderRecord[]) {
  localStorage.setItem(WORK_ORDER_STORAGE_KEY, JSON.stringify(records));
}

export function previewNextWorkOrderTiNo() {
  return formatTiNo(getTiCounter() + 1);
}

export function finalizeWorkOrderTiNo(tiNo?: string | null) {
  const trimmedTiNo = String(tiNo || "").trim();
  if (!trimmedTiNo) return formatTiNo(incrementTiCounter());
  if (trimmedTiNo === previewNextWorkOrderTiNo()) incrementTiCounter();
  return trimmedTiNo;
}

export function getPendingWorkOrderSummaryFromRecords(
  workOrderRecords: WorkOrderRecord[],
  existingTiNos?: Set<string>,
  itemTiFormats?: Record<string, ItemTiFormat>
) {
  const sortedRecords = [...workOrderRecords].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pending = sortedRecords.filter((record) => !isWorkOrderSynced(record, existingTiNos));
  const fetchable = pending.filter((record) => {
    const normalizedItemNo = normalizeItemNo(record.our_item_code);
    return Boolean(normalizedItemNo) && itemTiFormats?.[normalizedItemNo] === "standard";
  });
  const blocked = pending.filter((record) => {
    const normalizedItemNo = normalizeItemNo(record.our_item_code);
    return !normalizedItemNo || itemTiFormats?.[normalizedItemNo] !== "standard";
  });
  return {
    pending,
    fetchable,
    blocked,
    pendingCount: pending.length,
    fetchableCount: fetchable.length,
    blockedCount: blocked.length,
  };
}

export function mapWorkOrderToTiDraft(record: WorkOrderRecord): TiRecordInput {
  const traceabilityNote = record.traceability_sr_no
    ? `Traceability Sr. No.: ${record.traceability_sr_no}`
    : "";

  return {
    ti_no: record.ti_no,
    ti_date: new Date().toISOString().split("T")[0],
    item_no: record.our_item_code,
    customer_name: record.customer,
    cust_part_code: record.item_code,
    cus_order_no: record.po_no,
    cus_order_date: record.po_date,
    wo_number: record.work_order,
    po_item_no: record.po_line_no,
    serial_number: record.sr_no || record.traceability_sr_no,
    quantity: record.qty,
    note: traceabilityNote,
    approval_status: "pending_check",
    rejection_items: [],
  };
}

function isWorkOrderSynced(record: WorkOrderRecord, existingTiNos?: Set<string>) {
  if (record.ti_synced_at) return true;
  return Boolean(record.ti_no && existingTiNos?.has(record.ti_no));
}

type TiNumberParts = {
  prefix: string;
  financialYearStart: number;
  financialYearEnd: number;
  sequence: number;
};

function parseTiNumber(tiNo?: string | null): TiNumberParts | null {
  const match = tiNo?.trim().match(/^LTCT-(\d{2})-(\d{2})-(\d+)$/i);
  if (!match) return null;
  return {
    prefix: `LTCT-${match[1]}-${match[2]}-`,
    financialYearStart: Number(match[1]),
    financialYearEnd: Number(match[2]),
    sequence: Number(match[3]),
  };
}

function currentFinancialYearPrefix() {
  return formatTiNo(0).replace(/\d+$/, "");
}

function currentTiCounterKey() {
  return `ct_ti_counter_${currentFinancialYearPrefix()}`;
}

function getTiCounter() {
  const stored = parseInt(localStorage.getItem(currentTiCounterKey()) || "0", 10);
  const currentPrefix = currentFinancialYearPrefix();
  const recordMax = getLocalTiRecords().reduce((max, record) => {
    const parts = parseTiNumber(record.ti_no);
    return parts?.prefix === currentPrefix ? Math.max(max, parts.sequence) : max;
  }, 0);
  const workOrderMax = readWorkOrderRecords().reduce((max, record) => {
    const parts = parseTiNumber(record.ti_no);
    return parts?.prefix === currentPrefix ? Math.max(max, parts.sequence) : max;
  }, 0);
  return Math.max(Number.isFinite(stored) ? stored : 0, recordMax, workOrderMax);
}

function incrementTiCounter() {
  const next = getTiCounter() + 1;
  localStorage.setItem(currentTiCounterKey(), String(next));
  return next;
}

function formatTiNo(seq: number) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear() % 100;
  const financialYearStart = month >= 4 ? year : year - 1;
  const financialYearEnd = financialYearStart + 1;
  return `LTCT-${String(financialYearStart).padStart(2, "0")}-${String(financialYearEnd).padStart(2, "0")}-${String(seq).padStart(4, "0")}`;
}

function getLocalTiRecords(): Array<{ ti_no: string }> {
  try {
    return JSON.parse(localStorage.getItem("ct_ti_records") || "[]");
  } catch {
    return [];
  }
}

import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { TiRecordInput, CoreData } from "@/api-client";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS — fixed A4 layout, mathematically fitted
// A4 = 841.89pt. Fixed sections ≈ 277pt. 37 row slots → rowHeight = 15.3pt
// ─────────────────────────────────────────────────────────────────────────────
const BLACK      = "#000000";
const FONT_SIZE  = 9;
const LABEL_SIZE = 8;
const PAD_H      = 4;
const PAD_V      = 2;
const PAGE_PAD_H = 20;
const PAGE_PAD_V = 16;
const ROW_H      = 15.3;   // calculated to fill A4 exactly
const SEP_H      = 6.1;    // separator row

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const B = { fontFamily: "Helvetica-Bold" } as const;

const s = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: FONT_SIZE,
    paddingTop: PAGE_PAD_V,
    paddingBottom: PAGE_PAD_V,
    paddingLeft: PAGE_PAD_H,
    paddingRight: PAGE_PAD_H,
    color: BLACK,
  },

  // ── Header ──────────────────────────────────────────────────────────────
  headerRow: {
    flexDirection: "row",
    borderWidth: 1, borderColor: BLACK, borderStyle: "solid",
    paddingHorizontal: PAD_H + 4,
    paddingVertical: PAD_V + 2,
    alignItems: "center",
  },
  headerLeft:  { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 11, ...B, letterSpacing: 0.5 },
  headerSub:   { fontSize: 9, marginTop: 2 },
  headerRight: { flex: 1, alignItems: "flex-end" },
  headerField: { flexDirection: "row", marginBottom: 2 },
  headerLabel: { ...B, marginRight: 4, fontSize: FONT_SIZE },

  // ── Info table (5 rows, inline LABEL : value) ────────────────────────────
  infoTable: {
    borderLeftWidth: 1, borderRightWidth: 1,
    borderBottomWidth: 1, borderTopWidth: 0,
    borderColor: BLACK, borderStyle: "solid",
  },
  infoRow:     { flexDirection: "row", borderBottomWidth: 1, borderColor: BLACK, borderStyle: "solid" },
  infoRowLast: { flexDirection: "row" },
  infoCell: {
    flex: 1,
    paddingHorizontal: PAD_H + 1,
    paddingVertical: PAD_V,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
  },
  infoCellLast: {
    flex: 1,
    paddingHorizontal: PAD_H + 1,
    paddingVertical: PAD_V,
  },
  infoInline: { flexDirection: "row", alignItems: "center" },
  infoLabel:  { ...B, fontSize: LABEL_SIZE },
  infoColon:  { ...B, fontSize: LABEL_SIZE, marginHorizontal: 2 },
  infoValue:  { fontSize: FONT_SIZE, flex: 1 },

  // ── Electric row ─────────────────────────────────────────────────────────
  electricRow: {
    flexDirection: "row",
    borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
    borderColor: BLACK, borderStyle: "solid",
  },
  eCell: {
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
    justifyContent: "center",
  },
  eCellLast: {
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    justifyContent: "center",
  },
  eCellLabel: { ...B, fontSize: LABEL_SIZE },
  eCellValue: { fontSize: FONT_SIZE, marginTop: 1 },

  // ── Core table ───────────────────────────────────────────────────────────
  coreTable: {
    borderLeftWidth: 1, borderRightWidth: 1,
    borderTopWidth: 1, borderBottomWidth: 0,
    borderColor: BLACK, borderStyle: "solid",
    marginTop: 4,
  },
  coreHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#cccccc",
    borderBottomWidth: 1, borderColor: BLACK, borderStyle: "solid",
  },
  coreHeaderCell: {
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    fontSize: LABEL_SIZE,
    backgroundColor: "#cccccc",
  },
  coreRow: {
    flexDirection: "row",
    minHeight: ROW_H,
  },
  // Separator row: has bottom border to act as top border of next row,
  // and internal cell borders to maintain vertical lines
  coreSepRow: {
    flexDirection: "row",
    minHeight: SEP_H,
    borderBottomWidth: 1,
    borderColor: BLACK,
    borderStyle: "solid",
  },
  colLabel: {
    width: "34%",
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
    fontSize: LABEL_SIZE,
  },
  colCore: {
    flex: 1,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
    fontSize: FONT_SIZE,
  },
  colCoreLast: {
    flex: 1,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    fontSize: FONT_SIZE,
  },
  // Separator variant — no internal vertical borders by default (overridden inline)
  colLabelSep: {
    width: "34%",
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    fontSize: LABEL_SIZE,
  },
  colCoreSep: {
    flex: 1,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    fontSize: FONT_SIZE,
  },
  colSpanned: {
    flex: 3,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
    fontSize: FONT_SIZE,
  },

  // ── Note & Rev ───────────────────────────────────────────────────────────
  noteTable: {
    flexDirection: "row",
    borderWidth: 1, borderColor: BLACK, borderStyle: "solid",
    marginTop: 4,
    minHeight: 28,
  },
  noteCell: {
    flex: 4,
    paddingHorizontal: PAD_H + 1,
    paddingVertical: PAD_V,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
  },
  revCell: { flex: 1, paddingHorizontal: PAD_H + 1, paddingVertical: PAD_V },
  noteLabel: { ...B, fontSize: LABEL_SIZE, marginBottom: 1 },
  noteValue:  { fontSize: FONT_SIZE, lineHeight: 1.3 },

  // ── Signatures (inline row) ───────────────────────────────────────────────
  sigRow: {
    flexDirection: "row",
    marginTop: 4,
    borderWidth: 1, borderColor: BLACK, borderStyle: "solid",
  },
  sigCell: {
    flex: 1,
    paddingHorizontal: PAD_H + 2,
    paddingVertical: PAD_V + 1,
    borderRightWidth: 1, borderColor: BLACK, borderStyle: "solid",
    flexDirection: "row",
    alignItems: "center",
  },
  sigCellLast: {
    flex: 1,
    paddingHorizontal: PAD_H + 2,
    paddingVertical: PAD_V + 1,
    flexDirection: "row",
    alignItems: "center",
  },
  sigLabel: { ...B, fontSize: LABEL_SIZE },
  sigColon: { ...B, fontSize: LABEL_SIZE, marginHorizontal: 2 },
  sigName:  { fontSize: FONT_SIZE, flex: 1 },

  bold:   B,
  center: { textAlign: "center" },
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function v(val?: string | null): string { return val ?? ""; }

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${String(d.getDate()).padStart(2,"0")}-${months[d.getMonth()]}-${d.getFullYear()}`;
  } catch { return dateStr; }
}

/**
 * Determine whether @VK/2 is checked for ANY of the three cores.
 * If any core has max_exc_is_vk2 === "true", the PDF label gets the suffix.
 */
function isVK2Checked(c1: CoreData, c2: CoreData, c3: CoreData): boolean {
  return (
    (c1 as any).max_exc_is_vk2 === "true" ||
    (c1 as any).max_exc_is_vk2 === true ||
    (c2 as any).max_exc_is_vk2 === "true" ||
    (c2 as any).max_exc_is_vk2 === true ||
    (c3 as any).max_exc_is_vk2 === "true" ||
    (c3 as any).max_exc_is_vk2 === true
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW DEFINITIONS  (fixed — never changes)
// ─────────────────────────────────────────────────────────────────────────────
type CoreRow =
  | { type: "core";      label: string; key: keyof CoreData }
  | { type: "single";    label: string; value: string }
  | { type: "separator" };

function buildRows(data: TiRecordInput, maxExcLabel: string): CoreRow[] {
  return [
    // ── 7 core-specific rows ────────────────────────────────────────────────
    { type: "core",   label: "RATIO",                  key: "ratio" },
    { type: "core",   label: "Burden (VA)",            key: "burden_va" },
    { type: "core",   label: "Accuracy Class",         key: "accuracy_class" },
    { type: "core",   label: "ISF",                    key: "isf" },
    { type: "core",   label: "Min. Knee pt. volt.",    key: "min_knee_pt_volt" },
    { type: "core",   label: "Max. Rct @ 75°c",        key: "max_rct_75c" },
    { type: "core",   label: maxExcLabel,              key: "max_exc_vk2" },
    // ── separator ───────────────────────────────────────────────────────────
    { type: "separator" },
    // ── 18 more core rows ───────────────────────────────────────────────────
    { type: "core",   label: "Core Dimensions",         key: "bare_core_dim" },
    { type: "core",   label: "Core Material",           key: "core_material" },
    { type: "core",   label: "Core weight (Kg)",        key: "core_weight_kg" },
    { type: "core",   label: "Sec. Total Turns",        key: "sec_total_turns" },
    { type: "core",   label: "Sec. Ter. Marking",       key: "sec_ter_marking" },
    { type: "core",   label: "Sec. Conductor (S1-S2)",  key: "sec_cond_s1s2" },
    { type: "core",   label: "Sec. Turns (S1-S2)",      key: "sec_turns_s1s2" },
    { type: "core",   label: "Sec. Conductor (S2-S3)",  key: "sec_cond_s2s3" },
    { type: "core",   label: "Sec. Turns (S2-S3)",      key: "sec_turns_s2s3" },
    { type: "core",   label: "Sec. Conductor (S3-S4)",  key: "sec_cond_s3s4" },
    { type: "core",   label: "Sec. Turns (S3-S4)",      key: "sec_turns_s3s4" },
    { type: "core",   label: "Sec. Conductor (S4-S5)",  key: "sec_cond_s4s5" },
    { type: "core",   label: "Sec. Turns (S4-S5)",      key: "sec_turns_s4s5" },
    { type: "core",   label: "Sec. Copper weight (kg)", key: "sec_copper_wt" },
    { type: "core",   label: "Finished Core Dim. (mm)", key: "finished_core_dim" },
    { type: "core",   label: "Sec Connection",          key: "sec_connection" },
    { type: "core",   label: "Wire Length",             key: "wire_length" },
    { type: "core",   label: "Wire Colour",             key: "wire_colour" },
    // ── 11 single rows ──────────────────────────────────────────────────────
    { type: "single", label: "CT final dim",  value: v(data.ct_final_dim) },
    { type: "single", label: "GA Drg",        value: v(data.ga_drg) },
    { type: "single", label: "INS CLASS",     value: v(data.ins_class) },
    { type: "single", label: "PRI Turns",     value: v(data.pri_turns) },
    { type: "single", label: "PRI Copper",    value: v(data.pri_copper) },
    { type: "single", label: "Former",        value: v(data.former) },
    { type: "single", label: "PRI Length",    value: v(data.pri_length) },
    { type: "single", label: "PRI Weight",    value: v(data.pri_weight) },
    { type: "single", label: "Sec. Terminal", value: v(data.sec_terminal) },
    { type: "single", label: "Total Weight",  value: v(data.total_weight) },
    { type: "single", label: "Ref TI",        value: v(data.ref_ti) },
    // Total: 7 + 1sep + 18 + 11 = 37 slots × 15.3pt = 566pt ✅
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
type Props = {
  data: TiRecordInput & { ti_no?: string | null };
};

export function TiPdfDocument({ data }: Props) {
  const c1 = (data.core1 ?? {}) as CoreData;
  const c2 = (data.core2 ?? {}) as CoreData;
  const c3 = (data.core3 ?? {}) as CoreData;

  // Determine PDF label for Max. Exc. C/n based on checkbox state
  const vk2Checked  = isVK2Checked(c1, c2, c3);
  const maxExcLabel = vk2Checked
    ? "Max. Exc. C/n. :- @VK/2"
    : "Max. Exc. C/n.";

  const rows = buildRows(data, maxExcLabel);

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.headerTitle}>TECHNICAL INSTRUCTION</Text>
            <Text style={s.headerSub}>CURRENT TRANSFORMER</Text>
          </View>
          <View style={s.headerRight}>
            <View style={s.headerField}>
              <Text style={s.headerLabel}>TI no : </Text>
              <Text style={{ fontSize: FONT_SIZE }}>{v(data.ti_no)}</Text>
            </View>
            <View style={s.headerField}>
              <Text style={s.headerLabel}>TI DATE : </Text>
              <Text style={{ fontSize: FONT_SIZE }}>{formatDate(data.ti_date)}</Text>
            </View>
          </View>
        </View>

        {/* ── INFO TABLE — 5 inline rows ──────────────────────────────────── */}
        <View style={s.infoTable}>
          {([
            [
              { label: "CUSTOMER NAME",            val: v(data.customer_name),           last: false },
              { label: "CUS. ORDER. NO.",          val: v(data.cus_order_no),            last: true  },
            ],
            [
              { label: "CUS. ORDER DATE",          val: formatDate(data.cus_order_date), last: false },
              { label: "Cust. Item No / Part code", val: v(data.cust_part_code),         last: true  },
            ],
            [
              { label: "W.O. NO.",                 val: v(data.wo_number),               last: false },
              { label: "PO ITEM NO.",              val: v(data.po_item_no),              last: true  },
            ],
            [
              { label: "ITEM NO",                  val: v(data.item_no),                 last: false },
              { label: "CT TYPE",                  val: v(data.ct_type),                 last: true  },
            ],
            [
              { label: "QTY",                      val: v(data.quantity),                last: false },
              { label: "Sr. No.",                  val: v(data.serial_number),           last: true  },
            ],
          ] as Array<Array<{ label: string; val: string; last: boolean }>>).map((rowCells, ri, arr) => (
            <View key={ri} style={ri === arr.length - 1 ? s.infoRowLast : s.infoRow}>
              {rowCells.map((cell) => (
                <View key={cell.label} style={cell.last ? s.infoCellLast : s.infoCell}>
                  <View style={s.infoInline}>
                    <Text style={s.infoLabel}>{cell.label}</Text>
                    <Text style={s.infoColon}> :</Text>
                    <Text style={s.infoValue}> {cell.val}</Text>
                  </View>
                </View>
              ))}
            </View>
          ))}
        </View>

        {/* ── ELECTRIC ROW ────────────────────────────────────────────────── */}
        <View style={s.electricRow}>
          {([
            { label: "RATIO",         value: v(data.ratio),            flex: 1.2, last: false },
            { label: "RATED VOLTAGE", value: v(data.rated_voltage),    flex: 1.5, last: false },
            { label: "STC",           value: v(data.stc),              flex: 1.7, last: false },
            { label: "I.L.",          value: v(data.insulation_level), flex: 1.0, last: false },
            { label: "FREQ.",         value: v(data.frequency),        flex: 0.9, last: false },
            { label: "REF. STD.",     value: v(data.ref_std),          flex: 1.7, last: true  },
          ] as Array<{ label: string; value: string; flex: number; last: boolean }>).map((f) => (
            <View key={f.label} style={[f.last ? s.eCellLast : s.eCell, { flex: f.flex }]}>
              <Text style={s.eCellLabel}>{f.label}</Text>
              <Text style={s.eCellValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {/* ── CORE PARTICULARS TABLE ──────────────────────────────────────── */}
        <View style={s.coreTable}>

          {/* Header */}
          <View style={s.coreHeaderRow}>
            <View style={[s.colLabel, s.coreHeaderCell]}>
              <Text style={[s.bold, s.center]}>PARTICULARS</Text>
            </View>
            <View style={[s.colCore, s.coreHeaderCell]}>
              <Text style={[s.bold, s.center]}>Core 1</Text>
            </View>
            <View style={[s.colCore, s.coreHeaderCell]}>
              <Text style={[s.bold, s.center]}>Core 2</Text>
            </View>
            <View style={[s.colCoreLast, s.coreHeaderCell]}>
              <Text style={[s.bold, s.center]}>Core 3</Text>
            </View>
          </View>

{/* Rows */}
{rows.map((row, idx) => {
  if (row.type === "separator") {
    return (
      <View key={`sep-${idx}`} style={{ minHeight: SEP_H }} />
    );
  }

  if (row.type === "core") {
    const isCoreDimensionsRow = row.label === "Core Dimensions";

    return (
      <View
        key={idx}
        style={[
          s.coreRow,
          {
            borderBottomWidth: 1,
            borderColor: BLACK,
            borderStyle: "solid",
          },
          isCoreDimensionsRow && {
            borderTopWidth: 1,
            borderColor: BLACK,
            borderStyle: "solid",
          },
        ]}
      >
        <View style={s.colLabel}>
          <Text>{row.label}</Text>
        </View>
        <View style={s.colCore}>
          <Text>{v(c1[row.key])}</Text>
        </View>
        <View style={s.colCore}>
          <Text>{v(c2[row.key])}</Text>
        </View>
        <View style={s.colCoreLast}>
          <Text>{v(c3[row.key])}</Text>
        </View>
      </View>
    );
  }

  return (
    <View
      key={idx}
      style={[
        s.coreRow,
        {
          borderBottomWidth: 1,
          borderColor: BLACK,
          borderStyle: "solid",
        },
      ]}
    >
      <View style={s.colLabel}>
        <Text>{row.label}</Text>
      </View>
      <View style={s.colSpanned}>
        <Text>{row.value}</Text>
      </View>
    </View>
  );
})}

        </View>

        {/* ── NOTE & REV ──────────────────────────────────────────────────── */}
        <View style={s.noteTable}>
          <View style={s.noteCell}>
            <Text style={s.noteLabel}>NOTE</Text>
            <Text style={s.noteValue}>{v(data.note)}</Text>
          </View>
          <View style={s.revCell}>
            <Text style={s.noteLabel}>REV NO.</Text>
            <Text style={s.noteValue}>{v(data.rev_no)}</Text>
          </View>
        </View>

        {/* ── SIGNATURES — inline LABEL : Name ────────────────────────────── */}
        <View style={s.sigRow}>
          {([
            { name: data.created_by,  label: "CREATED BY",  last: false },
            { name: data.checked_by,  label: "CHECKED BY",  last: false },
            { name: data.approved_by, label: "APPROVED BY", last: true  },
          ] as Array<{ name?: string | null; label: string; last: boolean }>).map((sig) => (
            <View key={sig.label} style={sig.last ? s.sigCellLast : s.sigCell}>
              <Text style={s.sigLabel}>{sig.label}</Text>
              <Text style={s.sigColon}> : </Text>
              <Text style={s.sigName}>{v(sig.name)}</Text>
            </View>
          ))}
        </View>

      </Page>
    </Document>
  );
}

import { strToU8, zipSync } from "fflate";
import type { CoreData, TiRecordInput } from "@/api-client";
import { formatDisplayDate } from "@/lib/date-format";

type TiExportData = TiRecordInput & { ti_no?: string | null };
type CellStyle = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type CellInput = string | number | boolean | null | undefined | { value?: unknown; style?: CellStyle };

const CORE_ROWS: Array<{ label: string; key: keyof CoreData }> = [
  { label: "RATIO", key: "ratio" },
  { label: "Burden (VA)", key: "burden_va" },
  { label: "Accuracy Class", key: "accuracy_class" },
  { label: "ISF", key: "isf" },
  { label: "Min. Knee pt. volt.", key: "min_knee_pt_volt" },
  { label: "Max. Rct @ 75degC", key: "max_rct_75c" },
  { label: "Max. Exc. C/n.", key: "max_exc_vk2" },
  { label: "Core Dimensions", key: "bare_core_dim" },
  { label: "Core Material", key: "core_material" },
  { label: "Core weight (Kg)", key: "core_weight_kg" },
  { label: "Sec. Total Turns", key: "sec_total_turns" },
  { label: "Sec. Ter. Marking", key: "sec_ter_marking" },
  { label: "Sec. Conductor (S1-S2)", key: "sec_cond_s1s2" },
  { label: "Sec. Turns (S1-S2)", key: "sec_turns_s1s2" },
  { label: "Sec. Conductor (S2-S3)", key: "sec_cond_s2s3" },
  { label: "Sec. Turns (S2-S3)", key: "sec_turns_s2s3" },
  { label: "Sec. Conductor (S3-S4)", key: "sec_cond_s3s4" },
  { label: "Sec. Turns (S3-S4)", key: "sec_turns_s3s4" },
  { label: "Sec. Conductor (S4-S5)", key: "sec_cond_s4s5" },
  { label: "Sec. Turns (S4-S5)", key: "sec_turns_s4s5" },
  { label: "Sec. Copper weight (kg)", key: "sec_copper_wt" },
  { label: "Finished Core Dim. (mm)", key: "finished_core_dim" },
  { label: "Sec Connection", key: "sec_connection" },
  { label: "Wire Length", key: "wire_length" },
  { label: "Wire Colour", key: "wire_colour" },
];

const SINGLE_ROWS: Array<{ label: string; key: keyof TiRecordInput }> = [
  { label: "CT final dim", key: "ct_final_dim" },
  { label: "GA Drg", key: "ga_drg" },
  { label: "INS CLASS", key: "ins_class" },
  { label: "PRI Turns", key: "pri_turns" },
  { label: "PRI Copper", key: "pri_copper" },
  { label: "Former", key: "former" },
  { label: "PRI Length", key: "pri_length" },
  { label: "PRI Weight", key: "pri_weight" },
  { label: "Sec. Terminal", key: "sec_terminal" },
  { label: "Total Weight", key: "total_weight" },
  { label: "Ref TI", key: "ref_ti" },
];

export async function downloadTiExcel(data: TiExportData): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before Excel download.");
  }

  const blob = buildTiExcelBlob(data);
  downloadBlob(blob, `${safeFileName(data.ti_no || "TI")}.xlsx`);
}

function buildTiExcelBlob(data: TiExportData): Blob {
  const rows: Array<{ cells: CellInput[]; height?: number }> = [];
  const merges: string[] = [];

  const addRow = (cells: CellInput[], height?: number) => {
    rows.push({ cells, height });
    return rows.length;
  };
  const addMerge = (from: string, to: string) => merges.push(`${from}:${to}`);

  const titleRow = addRow([{ value: "TECHNICAL INSTRUCTION", style: 3 }], 24);
  addMerge(`A${titleRow}`, `F${titleRow}`);
  const subTitleRow = addRow([{ value: "CURRENT TRANSFORMER", style: 6 }], 20);
  addMerge(`A${subTitleRow}`, `F${subTitleRow}`);
  addRow([]);

  addPairRow("TI no", data.ti_no, "TI DATE", formatDate(data.ti_date));
  addPairRow("CUSTOMER NAME", data.customer_name, "CUS. ORDER. NO.", data.cus_order_no);
  addPairRow("CUS. ORDER DATE", formatDate(data.cus_order_date), "Cust. Item No / Part code", data.cust_part_code);
  addPairRow("W.O. NO.", data.wo_number, "PO ITEM NO.", data.po_item_no);
  addPairRow("ITEM NO", data.item_no, "CT TYPE", data.ct_type);
  addPairRow("QTY", formatQuantity(data.quantity), "Sr. No.", data.serial_number);

  addRow([]);
  const electricalSectionRow = addRow([{ value: "ELECTRICAL DETAILS", style: 5 }], 18);
  addMerge(`A${electricalSectionRow}`, `F${electricalSectionRow}`);
  addRow([
    { value: "RATIO", style: 4 },
    { value: "RATED VOLTAGE", style: 4 },
    { value: "STC", style: 4 },
    { value: "I.L.", style: 4 },
    { value: "FREQ.", style: 4 },
    { value: "REF. STD.", style: 4 },
  ]);
  addRow([
    { value: data.ratio, style: 2 },
    { value: data.rated_voltage, style: 2 },
    { value: data.stc, style: 2 },
    { value: data.insulation_level, style: 2 },
    { value: data.frequency, style: 2 },
    { value: data.ref_std, style: 2 },
  ]);

  addRow([]);
  const coreSectionRow = addRow([{ value: "CORE PARTICULARS", style: 5 }], 18);
  addMerge(`A${coreSectionRow}`, `F${coreSectionRow}`);
  addRow([
    { value: "PARTICULARS", style: 4 },
    { value: "Core 1", style: 4 },
    { value: "Core 2", style: 4 },
    { value: "Core 3", style: 4 },
  ]);

  const c1 = data.core1 || {};
  const c2 = data.core2 || {};
  const c3 = data.core3 || {};
  const maxExcLabel = isVK2Checked(c1, c2, c3) ? "Max. Exc. C/n. :- @VK/2" : "Max. Exc. C/n.";

  CORE_ROWS.forEach((row, index) => {
    const label = row.key === "max_exc_vk2" ? maxExcLabel : row.label;
    if (index === 7) addRow([]);
    addRow([
      { value: label, style: 1 },
      { value: c1[row.key], style: 2 },
      { value: c2[row.key], style: 2 },
      { value: c3[row.key], style: 2 },
    ]);
  });

  SINGLE_ROWS.forEach((row) => {
    const rowNumber = addRow([
      { value: row.label, style: 1 },
      { value: data[row.key], style: 2 },
    ]);
    addMerge(`B${rowNumber}`, `F${rowNumber}`);
  });

  addRow([]);
  const noteRow = addRow([
    { value: "Note", style: 1 },
    { value: data.note, style: 2 },
    null,
    null,
    { value: "Rev. No.", style: 1 },
    { value: data.rev_no, style: 2 },
  ], 30);
  addMerge(`B${noteRow}`, `D${noteRow}`);

  addRow([
    { value: "Created By", style: 1 },
    { value: data.created_by, style: 2 },
    { value: "Checked By", style: 1 },
    { value: data.checked_by, style: 2 },
    { value: "Approved By", style: 1 },
    { value: data.approved_by, style: 2 },
  ]);

  function addPairRow(labelA: string, valueA: unknown, labelB: string, valueB: unknown) {
    addRow([
      { value: labelA, style: 1 },
      { value: valueA, style: 2 },
      null,
      { value: labelB, style: 1 },
      { value: valueB, style: 2 },
    ]);
    const rowNumber = rows.length;
    addMerge(`B${rowNumber}`, `C${rowNumber}`);
    addMerge(`E${rowNumber}`, `F${rowNumber}`);
  }

  const sheetXml = buildWorksheetXml(rows, merges);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml()),
    "_rels/.rels": strToU8(rootRelsXml()),
    "docProps/app.xml": strToU8(appXml()),
    "docProps/core.xml": strToU8(coreXml(data.ti_no || "TI")),
    "xl/workbook.xml": strToU8(workbookXml()),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRelsXml()),
    "xl/styles.xml": strToU8(stylesXml()),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml),
  };

  return new Blob([zipSync(files)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function buildWorksheetXml(rows: Array<{ cells: CellInput[]; height?: number }>, merges: string[]): string {
  const sheetRows = rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 1;
    const heightAttrs = row.height ? ` ht="${row.height}" customHeight="1"` : "";
    const cells = row.cells
      .map((cell, colIndex) => buildCellXml(cell, `${columnName(colIndex + 1)}${rowNumber}`))
      .join("");
    return `<row r="${rowNumber}"${heightAttrs}>${cells}</row>`;
  }).join("");
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="4" width="22" customWidth="1"/>
    <col min="5" max="6" width="18" customWidth="1"/>
  </cols>
  <sheetData>${sheetRows}</sheetData>
  ${mergeXml}
  <pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
</worksheet>`;
}

function buildCellXml(cell: CellInput, ref: string): string {
  if (cell === null || cell === undefined) return "";
  const normalized = typeof cell === "object" && !Array.isArray(cell)
    ? { value: cell.value, style: cell.style ?? 0 }
    : { value: cell, style: 0 as CellStyle };
  const text = valueToString(normalized.value);
  if (!text && normalized.style === 0) return "";
  const style = normalized.style ? ` s="${normalized.style}"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function valueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatDate(dateStr?: string | null): string {
  return formatDisplayDate(dateStr);
}

function formatQuantity(value?: string | null): string {
  const quantity = valueToString(value).trim();
  if (!quantity) return "";
  return /\bNOS\.?$/i.test(quantity) ? quantity : `${quantity} NOS`;
}

function isVK2Checked(c1: CoreData, c2: CoreData, c3: CoreData): boolean {
  return (
    isCheckedValue((c1 as Record<string, unknown>).max_exc_is_vk2) ||
    isCheckedValue((c2 as Record<string, unknown>).max_exc_is_vk2) ||
    isCheckedValue((c3 as Record<string, unknown>).max_exc_is_vk2)
  );
}

function isCheckedValue(value: unknown): boolean {
  return value === true || value === "true";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]+/g, "_").trim() || "TI";
}

function columnName(index: number): string {
  let name = "";
  let current = index;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - remainder) / 26);
  }
  return name;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Technical Instruction" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function workbookRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="14"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF4A6FA5"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function appXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>CT-TI-App</Application>
</Properties>`;
}

function coreXml(title: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>CT-TI-App</dc:creator>
  <cp:lastModifiedBy>CT-TI-App</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

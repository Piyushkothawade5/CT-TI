import React from "react";
import { pdf } from "@react-pdf/renderer";
import { TiPdfDocument } from "./TiPdf";
import type { TiRecordInput } from "@/api-client";
import { buildBarTenderLabelRows, type BarTenderLabelRow } from "@/lib/ti-label-model";
import { buildBarTenderBtwDownload } from "@/lib/bartender-btw";
import { downloadTiExcel } from "./downloadTiExcel";

export async function downloadTiPdf(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before PDF download.");
  }
  const blob = await pdf(<TiPdfDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.ti_no || "TI"}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  await new Promise((resolve) => window.setTimeout(resolve, 250));
  // The Excel export is intentionally downloaded alongside the PDF. If it fails,
  // surface a message that makes clear the PDF already succeeded so the user
  // isn't told "PDF failed" for a file that actually downloaded.
  try {
    await downloadTiExcel(data);
  } catch (excelError) {
    const detail = excelError instanceof Error ? excelError.message : String(excelError);
    throw new Error(`PDF downloaded, but the Excel export failed: ${detail}`);
  }
}

export async function printTiPdf(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before printing.");
  }
  const blob = await pdf(<TiPdfDocument data={data} />).toBlob();
  openPrintWindow(URL.createObjectURL(blob));
}

export async function downloadTiLabelsPdf(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before label download.");
  }
  const { TiLabelPdfDocument } = await import("./TiLabelPdf");
  const blob = await pdf(<TiLabelPdfDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${data.ti_no || "TI"}-labels.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function printTiLabelsPdf(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before label printing.");
  }
  const { TiLabelPdfDocument } = await import("./TiLabelPdf");
  const blob = await pdf(<TiLabelPdfDocument data={data} />).toBlob();
  openPrintWindow(URL.createObjectURL(blob));
}

export async function downloadTiLabelsBtw(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
  if (data.approval_status !== "checked") {
    throw new Error("TI must be checked before label download.");
  }

  const rows = buildBarTenderLabelRows(data);
  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error("No label rows were created for this TI.");
  }

  await downloadBarTenderLabelRowBtw({
    tiNo: data.ti_no || "TI",
    itemNo: data.item_no || firstRow.ITEM_NO || "",
    row: firstRow,
  });
}

export async function downloadBarTenderLabelRowBtw({
  tiNo,
  itemNo,
  row,
}: {
  tiNo?: string | null;
  itemNo?: string | null;
  row: BarTenderLabelRow;
}): Promise<void> {
  const download = await buildBarTenderBtwDownload({
    tiNo: tiNo || "TI",
    itemNo: itemNo || row.ITEM_NO || "",
    row,
  });
  for (const extraDownload of download.extraDownloads) {
    downloadBlob(extraDownload.blob, extraDownload.fileName);
  }
  if (download.extraDownloads.length) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }
  downloadBlob(download.blob, download.fileName);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function openPrintWindow(url: string) {
  const newWindow = window.open(url, "_blank");
  if (!newWindow) {
    URL.revokeObjectURL(url);
    throw new Error("Browser blocked the print preview window.");
  }

  try {
    newWindow.opener = null;
  } catch {
    // Best effort only.
  }

  const cleanup = () => URL.revokeObjectURL(url);
  newWindow.addEventListener("afterprint", cleanup, { once: true });
  window.setTimeout(cleanup, 60_000);

  // A blob URL can finish loading before this handler is attached, in which case
  // the "load" event never fires for us. Trigger print on load AND via a timed
  // fallback, guarded so it only runs once.
  let printed = false;
  const triggerPrint = () => {
    if (printed) return;
    printed = true;
    try {
      newWindow.focus();
    } catch {
      // Best effort only.
    }
    newWindow.print();
  };
  newWindow.addEventListener("load", triggerPrint);
  window.setTimeout(triggerPrint, 800);
}

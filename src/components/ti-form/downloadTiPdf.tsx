import React from "react";
import { pdf } from "@react-pdf/renderer";
import { TiPdfDocument } from "./TiPdf";
import type { TiRecordInput } from "@/api-client";
import { buildBarTenderLabelRows, type BarTenderLabelRow } from "@/lib/ti-label-model";
import { buildBarTenderBtwDownload } from "@/lib/bartender-btw";

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
  newWindow.onload = () => {
    newWindow.print();
  };
}

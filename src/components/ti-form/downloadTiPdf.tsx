import React from "react";
import { pdf } from "@react-pdf/renderer";
import { TiPdfDocument } from "./TiPdf";
import type { TiRecordInput } from "@/api-client";

export async function downloadTiPdf(
  data: TiRecordInput & { ti_no?: string | null }
): Promise<void> {
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
  const blob = await pdf(<TiPdfDocument data={data} />).toBlob();
  const url = URL.createObjectURL(blob);
  const newWindow = window.open(url, "_blank");
  if (newWindow) {
    newWindow.onload = () => {
      newWindow.print();
    };
  }
}

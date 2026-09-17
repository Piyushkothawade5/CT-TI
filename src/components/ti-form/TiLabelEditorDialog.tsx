import React from "react";
import { Loader2, Printer, Save, Lock, Unlock, Pencil, KeyRound } from "lucide-react";
import type { TiRecordInput } from "@/api-client";
import {
  useTiLabelStatus,
  useBeginPrint,
  useCancelPrint,
  useUnlockTiLabels,
  useEnqueuePrintJob,
  useSavedLabelExists,
  useRequestUnlock,
  useUnlockRequests,
} from "@/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { buildBarTenderBtwDownload } from "@/lib/bartender-btw";
import {
  TAP_FIELD_NAMES,
  buildBarTenderLabelRows,
  getWireColourLabelLine,
  type BarTenderLabelRow,
  type BarTenderTapField,
} from "@/lib/ti-label-model";

type TiLabelEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: (TiRecordInput & { ti_no?: string | null }) | null;
};

const MAIN_FIELDS: Array<{ key: keyof BarTenderLabelRow; label: string }> = [
  { key: "MFG", label: "Mfg" },
  { key: "SR_NO", label: "Sr No" },
  { key: "ITEM_NO", label: "Item No" },
  { key: "CTR", label: "CTR" },
  { key: "STC", label: "STC" },
  { key: "IL", label: "I.L" },
  { key: "FREQ", label: "Freq" },
  { key: "INS_CLASS", label: "INS CL" },
  { key: "REF_STD", label: "Ref. Std" },
  { key: "WIRE_COLOUR", label: "Wire Color" },
  { key: "MFG_YEAR", label: "Mfg Year" },
];

export function TiLabelEditorDialog({ open, onOpenChange, data }: TiLabelEditorDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const role = String(profile?.role || "").toLowerCase();
  const canPrint = role === "user";
  const isAdmin = role === "admin";

  const [row, setRow] = React.useState<BarTenderLabelRow | null>(null);
  const [busy, setBusy] = React.useState<null | "save" | "edit" | "print" | "unlock">(null);

  const tiNo = String(data?.ti_no || "");
  const itemCode = String(data?.item_no || data?.cust_part_code || "").trim();

  const labelStatus = useTiLabelStatus(tiNo, { query: { enabled: open && !!tiNo } });
  const savedExists = useSavedLabelExists(itemCode, { query: { enabled: open && !!itemCode } });
  const beginPrint = useBeginPrint();
  const cancelPrint = useCancelPrint();
  const unlockLabels = useUnlockTiLabels();
  const enqueueJob = useEnqueuePrintJob();
  const requestUnlock = useRequestUnlock();
  const [unlockReason, setUnlockReason] = React.useState("");

  const templateExists = savedExists.data === true;
  const status = labelStatus.data;
  const qty = status?.label_qty ?? parseQtyText(status?.quantity);
  const issued = status?.labels_issued ?? 0;
  const remaining = qty != null ? Math.max(qty - issued, 0) : null;
  const locked = Boolean(status?.labels_locked);

  // For an operator on a locked TI, surface whether they already have a pending
  // label-unlock request so the button reflects "already sent".
  const myRequests = useUnlockRequests({
    query: { enabled: open && locked && canPrint },
  });
  const hasPendingRequest = (myRequests.data || []).some(
    (request) => request.ti_no === tiNo && request.request_type === "label"
  );

  React.useEffect(() => {
    if (!open || !data) return;
    setRow(buildBarTenderLabelRows(data)[0] || null);
    setUnlockReason("");
  }, [data, open]);

  const tapRowCount = row?.tapRows.filter(Boolean).length || 0;

  const updateField = (key: keyof BarTenderLabelRow, value: string) => {
    setRow((current) => current ? { ...current, [key]: value } : current);
  };

  const updateTapRow = (index: number, value: string) => {
    setRow((current) => {
      if (!current) return current;
      const tapRows = [...current.tapRows];
      tapRows[index] = value;
      const tapFields = Object.fromEntries(
        TAP_FIELD_NAMES.map((field, fieldIndex) => [field, tapRows[fieldIndex] || ""])
      ) as Record<BarTenderTapField, string>;
      return { ...current, tapRows, ...tapFields };
    });
  };

  const handleSaveLabel = async () => {
    if (!data || !row) return;
    if (!itemCode) {
      toast({ variant: "destructive", title: "Missing item code", description: "This TI has no item code to key the saved label folder." });
      return;
    }
    setBusy("save");
    try {
      // Only the main .btw is shipped for the library. Multi-tap templates that
      // reference an external diagram BMP will show a broken image until the
      // operator re-links/inserts the diagram during their one-time correction.
      const download = await buildBarTenderBtwDownload({
        tiNo: tiNo || "TI",
        itemNo: row.ITEM_NO || itemCode,
        row,
      });
      const btw_base64 = await blobToBase64(download.blob);
      await enqueueJob.mutateAsync({ action: "save", ti_no: tiNo, item_code: itemCode, btw_base64 });
      toast({
        title: "Saved to label library",
        description: "The print PC will open it in BarTender — correct it, then press Ctrl+S to keep your changes.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Save failed", description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleEdit = async () => {
    if (!itemCode) return;
    setBusy("edit");
    try {
      // Open the saved label for this item code. On the PC that has it, the agent opens
      // the existing (corrected) file and never overwrites it. If THIS print PC doesn't
      // have it yet (a different machine), the agent creates it from the template below
      // and opens that — so Edit never fails with "label not found" on a fresh PC.
      let btw_base64: string | undefined;
      if (row) {
        const download = await buildBarTenderBtwDownload({
          tiNo: tiNo || "TI",
          itemNo: row.ITEM_NO || itemCode,
          row,
        });
        btw_base64 = await blobToBase64(download.blob);
      }
      await enqueueJob.mutateAsync({ action: "edit", ti_no: tiNo, item_code: itemCode, btw_base64 });
      toast({
        title: "Opening saved label to edit",
        description: "The print PC opens its saved label (or creates it here if this PC doesn't have it) — adjust it, then press Ctrl+S.",
      });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Edit failed", description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handlePrint = async () => {
    if (!data || !tiNo) return;
    if (!itemCode) {
      toast({ variant: "destructive", title: "Missing item code", description: "This TI has no item code to locate the saved label." });
      return;
    }
    if (!templateExists) {
      toast({ variant: "destructive", title: "No saved template", description: "Save the label template for this item code first, then print." });
      return;
    }
    setBusy("print");
    try {
      // begin_print opens a print session (fixes the starting serial + queues the
      // job). The agent opens the label in BarTender; the operator prints, and the
      // ACTUAL number of labels the printer produced is read back and counted here.
      await startPrintSession();
    } catch (error) {
      const message = getErrorMessage(error);
      // Shop-floor recovery: an operator can open a print and close BarTender
      // without printing, which leaves the session "in progress" and blocks the
      // next Print. Offer to release that open session and reopen a fresh print.
      if (/already in progress/i.test(message)) {
        const reopen = window.confirm(
          "A print for this TI is still open on the print PC.\n\n" +
            "• If you already printed some labels, click Cancel and let the count finish first.\n" +
            "• If you closed BarTender without printing, click OK to release it and open a fresh print.",
        );
        if (reopen) {
          try {
            await cancelPrint.mutateAsync({ tiNo });
            await startPrintSession();
          } catch (retryError) {
            toast({ variant: "destructive", title: "Could not reopen print", description: getErrorMessage(retryError) });
          }
        }
      } else {
        toast({ variant: "destructive", title: "Could not start printing", description: message });
      }
    } finally {
      setBusy(null);
    }
  };

  // Queue one print session and confirm it to the operator. Shared by the first
  // Print click and the "release & reopen" recovery path above.
  const startPrintSession = async () => {
    const result = await beginPrint.mutateAsync({ tiNo, itemCode });
    toast({
      title: "Label sent to BarTender",
      description: `Starts at serial ${result.serial_start}. Print up to ${result.remaining}. The actual printed count updates here automatically.`,
    });
    await labelStatus.refetch();
  };

  const handleUnlock = async () => {
    if (!tiNo) return;
    setBusy("unlock");
    try {
      await unlockLabels.mutateAsync({ tiNo });
      toast({ title: "Labels unlocked", description: "Printed count reset to 0 — labels reprint from the first serial." });
      await labelStatus.refetch();
    } catch (error) {
      toast({ variant: "destructive", title: "Unlock failed", description: getErrorMessage(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleRequestUnlock = async () => {
    if (!tiNo) return;
    try {
      await requestUnlock.mutateAsync({ tiNo, type: "label", reason: unlockReason.trim() || null });
      toast({
        title: "Unlock request sent",
        description: "An admin has been notified and can unlock these labels.",
      });
      await myRequests.refetch();
    } catch (error) {
      toast({ variant: "destructive", title: "Request failed", description: getErrorMessage(error) });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <DialogTitle>Label Editor</DialogTitle>
        </DialogHeader>

        {(canPrint || isAdmin) && (
          <div className="flex flex-wrap items-center gap-4 border-b border-gray-200 bg-gray-50 px-6 py-3">
            <div className="text-sm">
              <span className="font-semibold text-[#2a4080]">{issued}</span>
              <span className="text-gray-500"> / {qty ?? "—"} printed</span>
              {remaining != null && (
                <span className="ml-2 text-gray-500">({remaining} remaining)</span>
              )}
            </div>
            {locked && (
              <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                <Lock className="h-3 w-3" /> Locked — admin must unlock
              </span>
            )}
            {locked && canPrint && (
              hasPendingRequest ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                  <KeyRound className="h-3 w-3" /> Unlock request sent
                </span>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    value={unlockReason}
                    onChange={(event) => setUnlockReason(event.target.value)}
                    placeholder="Reason (optional)"
                    className="h-8 w-48 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 border-amber-400 text-amber-700 hover:bg-amber-50"
                    onClick={handleRequestUnlock}
                    disabled={requestUnlock.isPending}
                  >
                    {requestUnlock.isPending ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <KeyRound className="mr-1 h-3.5 w-3.5" />
                    )}
                    Request Unlock
                  </Button>
                </div>
              )
            )}
            {canPrint && !savedExists.isLoading && !templateExists && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                No saved template for this item code — click Save Label first
              </span>
            )}
            {labelStatus.isLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
        )}

        {row ? (
          <div className="grid gap-5 px-6 py-5 lg:grid-cols-[1fr_1.2fr]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {MAIN_FIELDS.map((field) => (
                  <div key={String(field.key)} className={field.key === "MFG" ? "sm:col-span-2" : ""}>
                    <Label className="text-xs font-semibold uppercase text-gray-600">{field.label}</Label>
                    <Input
                      value={String(row[field.key] || "")}
                      onChange={(event) => updateField(field.key, event.target.value)}
                      className="mt-1"
                    />
                  </div>
                ))}
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <Label className="text-xs font-semibold uppercase text-gray-600">Tap Rows</Label>
                  <span className="text-xs font-semibold text-[#2a4080]">rows-{String(Math.max(tapRowCount, 1)).padStart(2, "0")}</span>
                </div>
                <div className="space-y-2">
                  {row.tapRows.map((tapRow, index) => (
                    <Textarea
                      key={`${index}-${TAP_FIELD_NAMES[index]}`}
                      value={tapRow}
                      rows={1}
                      onChange={(event) => updateTapRow(index, event.target.value)}
                      className="min-h-9 resize-none font-mono text-sm"
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <LabelPreview row={row} />
            </div>
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-gray-500">No label data found.</div>
        )}

        <DialogFooter className="flex-wrap gap-2 border-t border-gray-200 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy != null}>
            Cancel
          </Button>
          {isAdmin && locked && (
            <Button
              variant="outline"
              className="border-amber-400 text-amber-700 hover:bg-amber-50"
              onClick={handleUnlock}
              disabled={busy != null}
            >
              {busy === "unlock" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
              Unlock
            </Button>
          )}
          {canPrint && (
            <>
              {templateExists ? (
                <Button variant="outline" onClick={handleEdit} disabled={busy != null}>
                  {busy === "edit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
                  Edit
                </Button>
              ) : (
                <Button variant="outline" onClick={handleSaveLabel} disabled={!row || busy != null}>
                  {busy === "save" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Label
                </Button>
              )}
              {templateExists && (
                <Button
                  className="bg-[#2a4080] hover:bg-[#22366f]"
                  onClick={handlePrint}
                  disabled={busy != null || locked || !remaining}
                >
                  {busy === "print" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Printer className="mr-2 h-4 w-4" />}
                  Print
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type LabelLine =
  | { kind: "full"; text: string }
  // `alignEnd` right-aligns the last cell. `endAuto` lets the leading cell grow to
  // fill the row while the last cell only takes its content width (hugged right).
  | { kind: "cols"; cells: string[]; alignEnd?: boolean; endAuto?: boolean };

function LabelPreview({ row }: { row: BarTenderLabelRow }) {
  const wireColourLine = getWireColourLabelLine(row.WIRE_COLOUR);
  const tapRows = row.tapRows.filter(isPresent);

  // Build the label as a simple, uniform stack of lines. Every line shares one
  // font size and one gap, so spacing and size stay consistent no matter how many
  // tap rows there are. Column lines (Sr No/Item No etc.) split evenly.
  const lines: LabelLine[] = [];
  lines.push({ kind: "full", text: row.MFG });
  lines.push({ kind: "cols", cells: [`Sr No : ${row.SR_NO}`, `Item No : ${row.ITEM_NO}`] });
  if (isPresent(row.CTR)) lines.push({ kind: "full", text: `CTR : ${row.CTR}` });
  for (const tapRow of tapRows) lines.push({ kind: "full", text: tapRow });
  const electrical = [
    isPresent(row.IL) ? `I.L : ${row.IL}` : "",
    isPresent(row.FREQ) ? `Freq : ${row.FREQ}` : "",
    isPresent(row.INS_CLASS) ? `INS CL : ${row.INS_CLASS}` : "",
  ];
  if (electrical.some(Boolean)) lines.push({ kind: "cols", cells: electrical });
  // Bottom rows use three equal columns so Ref. Std / STC / Made in India line up
  // vertically with the I.L / Freq / INS CL row above, with equal spacing. The Mfg
  // Year row keeps the same columns so it aligns under Made in India.
  const refStd = isPresent(row.REF_STD) ? row.REF_STD : "";
  const stcText = isPresent(row.STC) ? `STC : ${row.STC}` : "";
  const madeInIndia = isPresent(row.MADE_IN_INDIA) ? row.MADE_IN_INDIA : "";
  if (refStd || stcText || madeInIndia) {
    lines.push({ kind: "cols", cells: [refStd, stcText, madeInIndia], alignEnd: true });
  }
  const mfgYear = isPresent(row.MFG_YEAR) ? `Mfg Year : ${row.MFG_YEAR}` : "";
  if (isPresent(wireColourLine) || mfgYear) {
    // Wire Color grows to use the whole width; Mfg Year stays hugged to the right.
    lines.push({ kind: "cols", cells: [wireColourLine, mfgYear], alignEnd: true, endAuto: true });
  }

  // One font size for the whole label, derived from the line count so everything
  // fits the fixed 100×35 label. More rows → smaller font (never below 6px); few
  // rows are capped so the text doesn't balloon. `cqh` = 1% of the label height.
  const totalLines = Math.max(lines.length, 1);
  const fontPref = 100 / (totalLines * 1.85 + 2);
  const fontSize = `clamp(6px, ${fontPref.toFixed(2)}cqh, 20px)`;

  return (
    <div className="flex min-w-0 items-start justify-center bg-[#aec7dd] p-5">
      <div
        className="w-full max-w-[760px] overflow-hidden rounded-[14px] bg-white shadow-lg"
        style={{ aspectRatio: "100 / 35", containerType: "size" }}
      >
        <div
          className="flex h-full flex-col justify-between font-sans font-extrabold leading-[1.15] text-black"
          style={{ fontSize, rowGap: "0.25em", padding: "3.5cqh 3.5%" }}
        >
          {lines.map((line, index) =>
            line.kind === "full" ? (
              <div key={index} className="truncate">
                {line.text}
              </div>
            ) : (
              <div key={index} className="flex" style={{ columnGap: "0.6em" }}>
                {line.cells.map((cell, cellIndex) => {
                  const isLast = cellIndex === line.cells.length - 1;
                  const isEnd = line.alignEnd && isLast;
                  const hug = line.endAuto && isLast;
                  return (
                    <div
                      key={cellIndex}
                      className={`min-w-0 truncate ${hug ? "flex-none" : "flex-1"} ${
                        isEnd ? "text-right" : "text-left"
                      }`}
                      // Left-aligned columns (Item No, etc.) keep a steady right gap so
                      // the text looks consistent whatever its length; right-aligned
                      // notes hug the edge.
                      style={{ paddingRight: isEnd ? undefined : "1.1em" }}
                    >
                      {cell}
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function isPresent(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseQtyText(value?: string | null): number | null {
  const match = String(value ?? "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

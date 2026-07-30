import React from "react";
import { Download, Loader2 } from "lucide-react";
import type { TiRecordInput } from "@/api-client";
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
import { downloadBarTenderLabelRowBtw } from "@/components/ti-form/downloadTiPdf";
import {
  TAP_FIELD_NAMES,
  buildBarTenderLabelRows,
  getOrderedLabelDiagramCores,
  getWireColourLabelLine,
  type BarTenderLabelRow,
  type BarTenderTapField,
  type LabelDiagramOrientation,
  type LabelDiagramP1Position,
  type LabelDiagramTerminalPosition,
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
  const [row, setRow] = React.useState<BarTenderLabelRow | null>(null);
  const [isDownloading, setIsDownloading] = React.useState(false);

  React.useEffect(() => {
    if (!open || !data) return;
    setRow(buildBarTenderLabelRows(data)[0] || null);
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

  const handleDownload = async () => {
    if (!data || !row) return;
    setIsDownloading(true);
    try {
      await downloadBarTenderLabelRowBtw({
        tiNo: data.ti_no || "TI",
        itemNo: row.ITEM_NO || data.cust_part_code || data.item_no || "",
        row,
      });
      toast({ title: "Label downloaded", description: `Template rows: ${String(Math.max(tapRowCount, 1)).padStart(2, "0")}` });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Label download failed", description: getErrorMessage(error) });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <DialogTitle>Label Editor</DialogTitle>
        </DialogHeader>

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
              <DiagramControls row={row} updateField={updateField} />
              <LabelPreview row={row} />
              <DiagramOrderControls row={row} updateField={updateField} />
            </div>
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-sm text-gray-500">No label data found.</div>
        )}

        <DialogFooter className="border-t border-gray-200 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDownloading}>
            Cancel
          </Button>
          <Button className="bg-[#2a4080] hover:bg-[#22366f]" onClick={handleDownload} disabled={!row || isDownloading}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download BTW
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiagramControls({
  row,
  updateField,
}: {
  row: BarTenderLabelRow;
  updateField: (key: keyof BarTenderLabelRow, value: string) => void;
}) {
  const orientation = row.DIAGRAM_ORIENTATION || "vertical";
  const p1Position = row.DIAGRAM_P1_POSITION || (orientation === "horizontal" ? "start" : "end");
  const applyOrientationDefaults = (value: LabelDiagramOrientation) => {
    updateField("DIAGRAM_ORIENTATION", value);
    updateField("DIAGRAM_P1_POSITION", value === "horizontal" ? "start" : "end");
    updateField("DIAGRAM_TERMINAL_POSITION", "end");
    updateField("DIAGRAM_TERMINAL_ORDER", value === "horizontal" ? "start" : "end");
    updateField("DIAGRAM_CORE_ORDER", "start");
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-blue-100 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-gray-600">Diagram</span>
        <SegmentedChoice
          options={[
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
          ]}
          value={orientation}
          onChange={applyOrientationDefaults}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-gray-600">P1</span>
        <SegmentedChoice
          options={[
            { value: "start", label: "Upper / Left" },
            { value: "end", label: "Lower / Right" },
          ]}
          value={p1Position}
          onChange={(value) => updateField("DIAGRAM_P1_POSITION", value)}
        />
      </div>

    </div>
  );
}

function DiagramOrderControls({
  row,
  updateField,
}: {
  row: BarTenderLabelRow;
  updateField: (key: keyof BarTenderLabelRow, value: string) => void;
}) {
  const orientation = row.DIAGRAM_ORIENTATION || "vertical";
  const terminalPosition = row.DIAGRAM_TERMINAL_POSITION || "end";
  const terminalOrder = row.DIAGRAM_TERMINAL_ORDER || (orientation === "horizontal" ? "start" : "end");
  const coreOrder = row.DIAGRAM_CORE_ORDER || "start";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-blue-100 bg-white px-3 py-2 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-gray-600">S1 Side</span>
        <SegmentedChoice
          options={[
            { value: "start", label: "Left / Top" },
            { value: "end", label: "Right / Bottom" },
          ]}
          value={terminalPosition}
          onChange={(value) => updateField("DIAGRAM_TERMINAL_POSITION", value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-gray-600">S Order</span>
        <SegmentedChoice
          options={[
            { value: "start", label: "S1 First" },
            { value: "end", label: "Last First" },
          ]}
          value={terminalOrder}
          onChange={(value) => updateField("DIAGRAM_TERMINAL_ORDER", value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase text-gray-600">Core Order</span>
        <SegmentedChoice
          options={[
            { value: "start", label: "1 First" },
            { value: "end", label: "Last First" },
          ]}
          value={coreOrder}
          onChange={(value) => updateField("DIAGRAM_CORE_ORDER", value)}
        />
      </div>
    </div>
  );
}

function SegmentedChoice<TValue extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: TValue; label: string }>;
  value: TValue;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-[#2a4080] bg-white">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`px-3 py-1 text-xs font-semibold transition ${
              isActive
                ? "bg-[#2a4080] text-white"
                : "bg-white text-[#2a4080] hover:bg-blue-50"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function LabelPreview({ row }: { row: BarTenderLabelRow }) {
  const wireColourLine = getWireColourLabelLine(row.WIRE_COLOUR);
  const diagramCores = getOrderedLabelDiagramCores(row);
  const tapRows = row.tapRows.filter(isPresent);
  const layout = getPreviewLayout(tapRows.length);

  return (
    <div className="flex min-w-0 items-start justify-center bg-[#aec7dd] p-5">
      <div
        className="relative w-full max-w-[820px] overflow-hidden rounded-[22px] bg-white px-[1.5%] py-[1.2%] font-sans font-extrabold text-black shadow-lg"
        style={{ aspectRatio: layout.previewAspectRatio }}
      >
        <div className="absolute left-[1.5%] right-[1.5%] top-[4%] truncate leading-none" style={{ fontSize: layout.titleFontSize }}>
          {row.MFG}
        </div>

        <div className="absolute left-[1.5%] top-[17%] w-[42%] truncate leading-none" style={{ fontSize: layout.mainFontSize }}>
          Sr No : {row.SR_NO}
        </div>
        <div className="absolute left-[45%] top-[17%] w-[35%] truncate leading-none" style={{ fontSize: layout.mainFontSize }}>
          Item No : {row.ITEM_NO}
        </div>

        {isPresent(row.CTR) && (
          <div className="absolute left-[1.5%] top-[29%] w-[42%] truncate leading-none" style={{ fontSize: layout.mainFontSize }}>
            CTR : {row.CTR}
          </div>
        )}
        {isPresent(row.STC) && (
          <div className="absolute left-[45%] top-[29%] w-[25%] truncate leading-none" style={{ fontSize: layout.mainFontSize }}>
            STC : {row.STC}
          </div>
        )}

        <div
          className="absolute left-[1.5%] w-[70%] overflow-hidden"
          style={{
            top: layout.tapTop,
            maxHeight: layout.tapMaxHeight,
            fontSize: layout.tapFontSize,
            lineHeight: layout.tapLineHeight,
          }}
        >
          {tapRows.map((tapRow, index) => (
            <div key={`${index}-${tapRow}`} className="truncate">{tapRow}</div>
          ))}
        </div>

        <DiagramPreview row={row} diagramCores={diagramCores} layout={layout} />

        <div
          className="absolute left-[1.5%] right-[24%] grid grid-cols-[.86fr_.74fr_.9fr] gap-[4%] leading-none"
          style={{ top: layout.electricalTop, fontSize: layout.footerFontSize }}
        >
          <div className="truncate">{isPresent(row.IL) ? `I.L : ${row.IL}` : ""}</div>
          <div className="truncate">{isPresent(row.FREQ) ? `Freq : ${row.FREQ}` : ""}</div>
          <div className="truncate">{isPresent(row.INS_CLASS) ? `INS CL : ${row.INS_CLASS}` : ""}</div>
        </div>

        <div
          className="absolute left-[1.5%] w-[36%] truncate leading-none"
          style={{ top: layout.refStdTop, fontSize: layout.noteFontSize }}
        >
          {isPresent(row.REF_STD) ? row.REF_STD : ""}
        </div>
        <div
          className="absolute left-[1.5%] w-[70%] truncate leading-none"
          style={{ bottom: layout.bottomInset, fontSize: layout.noteFontSize }}
        >
          {wireColourLine}
        </div>

        <div
          className="absolute right-[3%] w-[18%] truncate text-right leading-none"
          style={{ top: layout.madeInIndiaTop, fontSize: layout.noteFontSize }}
        >
          {isPresent(row.MADE_IN_INDIA) ? row.MADE_IN_INDIA : ""}
        </div>
        <div
          className="absolute right-[3%] w-[22%] truncate text-right leading-none"
          style={{ bottom: layout.bottomInset, fontSize: layout.noteFontSize }}
        >
          {isPresent(row.MFG_YEAR) ? `Mfg Year : ${row.MFG_YEAR}` : ""}
        </div>
      </div>
    </div>
  );
}

type PreviewLayout = {
  previewAspectRatio: string;
  titleFontSize: string;
  mainFontSize: string;
  tapFontSize: string;
  tapLineHeight: number;
  tapTop: string;
  tapMaxHeight: string;
  footerFontSize: string;
  noteFontSize: string;
  electricalTop: string;
  refStdTop: string;
  madeInIndiaTop: string;
  bottomInset: string;
  diagramFontSize: string;
  horizontalDiagramTop: string;
  horizontalDiagramWidth: string;
  verticalDiagramTop: string;
  verticalDiagramWidth: string;
};

function getPreviewLayout(tapRowCount: number): PreviewLayout {
  const extraRows = Math.max(0, tapRowCount - 2);
  const previewHeight = Math.min(90, 35 + extraRows * 5);
  const hasManyRows = tapRowCount >= 5;
  const hasSeveralRows = tapRowCount >= 3;

  return {
    previewAspectRatio: `100 / ${previewHeight}`,
    titleFontSize: "clamp(11px, 1.38vw, 17px)",
    mainFontSize: "clamp(10px, 1.28vw, 16px)",
    tapFontSize: "clamp(10px, 1.22vw, 15px)",
    tapLineHeight: 1.08,
    tapTop: hasManyRows ? "37%" : hasSeveralRows ? "39%" : "41%",
    tapMaxHeight: hasManyRows ? "36%" : hasSeveralRows ? "28%" : "22%",
    footerFontSize: "clamp(9px, 1.12vw, 14px)",
    noteFontSize: "clamp(7px, .95vw, 11px)",
    electricalTop: hasManyRows ? "77%" : hasSeveralRows ? "69%" : "66%",
    refStdTop: hasManyRows ? "86%" : hasSeveralRows ? "80%" : "79%",
    madeInIndiaTop: hasManyRows ? "84%" : hasSeveralRows ? "78%" : "77%",
    bottomInset: "6%",
    diagramFontSize: "clamp(8px, 1.05vw, 13px)",
    horizontalDiagramTop: hasManyRows ? "18%" : hasSeveralRows ? "20%" : "21%",
    horizontalDiagramWidth: hasManyRows ? "30%" : hasSeveralRows ? "24%" : "14%",
    verticalDiagramTop: "31%",
    verticalDiagramWidth: hasManyRows ? "25%" : "24%",
  };
}

function DiagramPreview({
  row,
  diagramCores,
  layout,
}: {
  row: BarTenderLabelRow;
  diagramCores: ReturnType<typeof getOrderedLabelDiagramCores>;
  layout: PreviewLayout;
}) {
  const orientation = (row.DIAGRAM_ORIENTATION || "vertical") as LabelDiagramOrientation;
  const p1Position = (row.DIAGRAM_P1_POSITION || (orientation === "horizontal" ? "start" : "end")) as LabelDiagramP1Position;
  const terminalPosition = (row.DIAGRAM_TERMINAL_POSITION || "end") as LabelDiagramTerminalPosition;
  const startLabel = p1Position === "end" ? "P2" : "P1";
  const endLabel = p1Position === "end" ? "P1" : "P2";

  if (orientation === "horizontal") {
    return (
      <div
        className="absolute right-[4%] flex flex-col items-center leading-none"
        style={{
          top: layout.horizontalDiagramTop,
          width: layout.horizontalDiagramWidth,
          fontSize: layout.diagramFontSize,
        }}
      >
        <div>{startLabel}</div>
        <TerminalStackBlock diagramCores={diagramCores} className="mt-[1%] w-full px-[6%] py-[6%]" />
        <div className="mt-[3%]">{endLabel}</div>
      </div>
    );
  }

  return (
    <div
      className="absolute right-[2.5%] flex items-center justify-center gap-[4%] leading-none"
      style={{
        top: layout.verticalDiagramTop,
        width: layout.verticalDiagramWidth,
        fontSize: layout.diagramFontSize,
      }}
    >
      <div className="rotate-90 whitespace-nowrap">{startLabel}</div>
      <TerminalBlock diagramCores={diagramCores} terminalPosition={terminalPosition} className="flex-1 px-[7%] py-[8%]" />
      <div className="rotate-90 whitespace-nowrap">{endLabel}</div>
    </div>
  );
}

function TerminalStackBlock({
  diagramCores,
  className = "",
}: {
  diagramCores: ReturnType<typeof getOrderedLabelDiagramCores>;
  className?: string;
}) {
  return (
    <div className={`border-2 border-black ${className}`}>
      <div
        className="grid items-center"
        style={{
          gridTemplateColumns: `repeat(${Math.max(diagramCores.length, 1)}, minmax(0, 1fr))`,
          columnGap: "clamp(3px, .45vw, 7px)",
          rowGap: "clamp(3px, .45vw, 7px)",
        }}
      >
        {diagramCores.map((core) => (
          <div
            key={core.coreNumber}
            className="grid min-w-0 justify-items-center"
            style={{
              rowGap: "clamp(3px, .4vw, 6px)",
            }}
          >
            {core.terminals.map((terminal) => (
              <div key={`stack-${core.coreNumber}-${terminal}`} className="flex flex-col items-center gap-[2px]">
                <span className="block aspect-square w-[clamp(8px,.95vw,13px)] border-2 border-black" />
                <span className="text-center text-[clamp(7px,.9vw,12px)] leading-none">{terminal}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TerminalBlock({
  diagramCores,
  terminalPosition,
  className = "",
}: {
  diagramCores: ReturnType<typeof getOrderedLabelDiagramCores>;
  terminalPosition: LabelDiagramTerminalPosition;
  className?: string;
}) {
  const labelsAtStart = terminalPosition !== "end";

  return (
    <div className={`border-2 border-black ${className}`}>
      {diagramCores.map((core) => (
        <div key={core.coreNumber} className="mb-[5%] last:mb-0">
          <div className="flex justify-center gap-[10%]">
            {core.terminals.map((terminal) => (
              <div
                key={`box-${core.coreNumber}-${terminal}`}
                className={`flex items-center gap-[2px] ${labelsAtStart ? "flex-row-reverse" : ""}`}
              >
                <span className="block aspect-square w-[clamp(7px,.9vw,12px)] border-2 border-black" />
                <span className={`${labelsAtStart ? "-rotate-90" : "rotate-90"} text-[clamp(6px,.9vw,11px)] leading-none`}>
                  {terminal}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function isPresent(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import React from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Download, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { downloadDrgBtw, type DrgTextRotation, type DrgTextSide } from "@/lib/drg-btw";

const GRID_SIZE = 5;
const BOXES = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
  const row = Math.floor(index / GRID_SIZE) + 1;
  const col = (index % GRID_SIZE) + 1;
  return { id: `Box_R${row}_C${col}`, row, col };
});

const SIDE_OPTIONS: Array<{ value: DrgTextSide; label: string; icon: React.ReactNode }> = [
  { value: "up", label: "Up", icon: <ArrowUp className="h-4 w-4" /> },
  { value: "down", label: "Down", icon: <ArrowDown className="h-4 w-4" /> },
  { value: "left", label: "Left", icon: <ArrowLeft className="h-4 w-4" /> },
  { value: "right", label: "Right", icon: <ArrowRight className="h-4 w-4" /> },
];

const ROTATIONS: DrgTextRotation[] = [0, 90, 180, 270];
const SEQUENCE_OPTIONS = [
  { value: "default", label: "1S1 2S1" },
  { value: "normal", label: "1S1 1S2" },
  { value: "flipX", label: "1S5 1S4" },
  { value: "flipBoth", label: "5S5 5S4" },
  { value: "flipY", label: "5S1 5S2" },
] as const;

type SequenceMode = typeof SEQUENCE_OPTIONS[number]["value"];

type DrgTemplateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tiNo?: string | null;
};

export function DrgTemplateDialog({ open, onOpenChange, tiNo }: DrgTemplateDialogProps) {
  const { toast } = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [textSide, setTextSide] = React.useState<DrgTextSide>("down");
  const [textRotation, setTextRotation] = React.useState<DrgTextRotation>(0);
  const [textByBox, setTextByBox] = React.useState<Record<string, string>>(() => buildTextByBox("default"));
  const [isDownloading, setIsDownloading] = React.useState(false);

  React.useEffect(() => {
    if (!open) setIsDownloading(false);
  }, [open]);

  const toggleBox = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelected = () => setSelected(new Set());

  const applySequence = (mode: SequenceMode) => {
    setTextByBox(buildTextByBox(mode));
  };

  const updateText = (boxId: string, value: string) => {
    setTextByBox((current) => ({
      ...current,
      [boxId]: normalizeTextInput(value),
    }));
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      await downloadDrgBtw({ selectedBoxes: [...selected], tiNo, textSide, textRotation, textByBox });
      toast({ title: "Drg downloaded", description: `${selected.size} box${selected.size === 1 ? "" : "es"} selected.` });
      onOpenChange(false);
    } catch (error) {
      toast({ variant: "destructive", title: "Drg download failed", description: getErrorMessage(error) });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-0">
        <DialogHeader className="border-b border-gray-200 px-6 py-4">
          <DialogTitle>Drg</DialogTitle>
        </DialogHeader>

        <div className="grid gap-5 px-6 py-5 lg:grid-cols-[1fr_220px]">
          <DrgGridPreview
            selected={selected}
            textByBox={textByBox}
            textSide={textSide}
            textRotation={textRotation}
            onToggleBox={toggleBox}
            onTextChange={updateText}
          />

          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {SIDE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  variant={textSide === option.value ? "default" : "outline"}
                  className={textSide === option.value ? "bg-[#2a4080] hover:bg-[#22366f]" : ""}
                  onClick={() => setTextSide(option.value)}
                  title={option.label}
                >
                  {option.icon}
                </Button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-2">
              {ROTATIONS.map((rotation) => (
                <Button
                  key={rotation}
                  type="button"
                  variant={textRotation === rotation ? "default" : "outline"}
                  className={textRotation === rotation ? "bg-[#2a4080] hover:bg-[#22366f]" : ""}
                  onClick={() => setTextRotation(rotation)}
                >
                  {rotation}°
                </Button>
              ))}
            </div>

            <div className="grid gap-2">
              {SEQUENCE_OPTIONS.map((option) => (
                <Button key={option.value} type="button" variant="outline" onClick={() => applySequence(option.value)}>
                  {option.label}
                </Button>
              ))}
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-[#2a4080]">Selected: {selected.size}</span>
              <Button type="button" variant="outline" size="sm" onClick={clearSelected} disabled={isDownloading || selected.size === 0}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Clear
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-gray-200 px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isDownloading}>
            Cancel
          </Button>
          <Button className="bg-[#2a4080] hover:bg-[#22366f]" onClick={handleDownload} disabled={selected.size === 0 || isDownloading}>
            {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Download BTW
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DrgGridPreview({
  selected,
  textByBox,
  textSide,
  textRotation,
  onToggleBox,
  onTextChange,
}: {
  selected: Set<string>;
  textByBox: Record<string, string>;
  textSide: DrgTextSide;
  textRotation: DrgTextRotation;
  onToggleBox: (boxId: string) => void;
  onTextChange: (boxId: string, value: string) => void;
}) {
  return (
    <div className="flex justify-center">
      <div
        title="OuterBox"
        aria-label="OuterBox"
        className="grid rounded-sm border-2 border-gray-200 bg-white p-3"
        style={{
          gridTemplateColumns: "repeat(11, minmax(26px, 36px))",
          gridTemplateRows: "repeat(11, minmax(22px, 34px))",
          gap: "4px",
        }}
      >
        {BOXES.map((box) => {
          const isSelected = selected.has(box.id);
          return (
            <button
              key={box.id}
              type="button"
              aria-label={box.id}
              aria-pressed={isSelected}
              title={box.id}
              onClick={() => onToggleBox(box.id)}
              className={`h-full w-full rounded-sm border-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[#2a4080] focus:ring-offset-2 ${
                isSelected
                  ? "border-black bg-black text-white"
                  : "border-gray-200 bg-gray-50 text-gray-300 hover:border-gray-400 hover:bg-gray-100"
              }`}
              style={{ gridColumn: box.col * 2, gridRow: box.row * 2 }}
            />
          );
        })}

        {BOXES.filter((box) => selected.has(box.id)).map((box) => {
          const placement = getPreviewTextPlacement(box.row, box.col, textSide);
          return (
            <input
              key={`${box.id}-${textSide}`}
              value={textByBox[box.id] || defaultLabelForBox(box.row, box.col, "default")}
              maxLength={3}
              onChange={(event) => onTextChange(box.id, event.target.value)}
              className="h-full w-full border-0 bg-transparent p-0 text-center text-[11px] font-bold uppercase text-black outline-none focus:bg-blue-50"
              style={{
                gridColumn: placement.column,
                gridRow: placement.row,
                transform: `rotate(${textRotation}deg)`,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function getPreviewTextPlacement(row: number, col: number, side: DrgTextSide): { row: number; column: number } {
  switch (side) {
    case "up": return { row: row * 2 - 1, column: col * 2 };
    case "down": return { row: row * 2 + 1, column: col * 2 };
    case "left": return { row: row * 2, column: col * 2 - 1 };
    case "right": return { row: row * 2, column: col * 2 + 1 };
  }
}

function buildTextByBox(mode: SequenceMode): Record<string, string> {
  return Object.fromEntries(BOXES.map((box) => [box.id, defaultLabelForBox(box.row, box.col, mode)]));
}

function defaultLabelForBox(row: number, col: number, mode: SequenceMode): string {
  switch (mode) {
    case "default": return `${col}S${row}`;
    case "normal": return `${row}S${col}`;
    case "flipX": return `${row}S${GRID_SIZE - col + 1}`;
    case "flipBoth": return `${GRID_SIZE - row + 1}S${GRID_SIZE - col + 1}`;
    case "flipY": return `${GRID_SIZE - row + 1}S${col}`;
  }
}

function normalizeTextInput(value: string): string {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 3);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}



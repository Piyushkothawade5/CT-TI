import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RotateCw,
  ScanText,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

type Point = { x: number; y: number };
type Selection = { x: number; y: number; width: number; height: number };
type TextBox = Selection & { text: string };
type SelectionMode = "point" | "area" | "horizontal-line" | "vertical-line";
type OcrCropSpec = {
  cropArea: Selection;
  selectionInCrop: Selection;
  mode: SelectionMode;
};

export function DrawingFieldExtractor({
  file,
  activeFieldLabel,
  onApply,
  onAutoText,
  onClose,
}: {
  file: File;
  activeFieldLabel: string;
  onApply: (text: string) => void;
  onAutoText?: (text: string) => number | void | Promise<number | void>;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<any>(null);
  const pageRef = useRef<any>(null);
  const textBoxesRef = useRef<TextBox[]>([]);
  const dragStartRef = useRef<Point | null>(null);
  const autoExtractedRef = useRef("");

  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [documentVersion, setDocumentVersion] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [status, setStatus] = useState("Loading drawing...");
  const [isExtracting, setIsExtracting] = useState(false);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);

  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    let cancelled = false;
    pdfRef.current = null;
    pageRef.current = null;
    textBoxesRef.current = [];
    setImageElement(null);
    setPageNumber(1);
    setSelection(null);
    setExtractedText("");
    setRotation(0);
    setZoom(1);
    setStatus("Loading drawing...");
    autoExtractedRef.current = "";

    if (isPdf) {
      file.arrayBuffer().then((data) => pdfjs.getDocument({ data }).promise).then((pdf) => {
        if (cancelled) return;
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
        setDocumentVersion((version) => version + 1);
        setStatus("Drag over text to capture it");
      }).catch((error) => {
        if (!cancelled) setStatus(`Could not open PDF: ${String(error)}`);
      });
    } else {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        if (cancelled) return;
        setImageElement(image);
        setPageCount(1);
        setStatus("Drag over text to capture it");
        URL.revokeObjectURL(url);
      };
      image.onerror = () => setStatus("Could not open image");
      image.src = url;
      return () => {
        cancelled = true;
        URL.revokeObjectURL(url);
      };
    }

    return () => { cancelled = true; };
  }, [file, isPdf]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: any;

    async function render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

      setSelection(null);
      setExtractedText("");
      textBoxesRef.current = [];
      let sourceRendered = false;

      if (isPdf) {
        if (!pdfRef.current) return;
        const page = await pdfRef.current.getPage(pageNumber);
        if (cancelled) return;
        pageRef.current = page;
        const viewport = page.getViewport({ scale: 1.25 * zoom, rotation });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        if (cancelled) return;
        sourceRendered = true;

        const textContent = await page.getTextContent();
        textBoxesRef.current = textContent.items.flatMap((item: any) => {
          if (!item.str?.trim()) return [];
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const height = Math.max(8, Math.hypot(transform[2], transform[3]));
          return splitPdfTextIntoWordBoxes(
            item.str,
            transform[4],
            transform[5] - height,
            Math.max(2, item.width * viewport.scale),
            height
          );
        });
        setStatus(textBoxesRef.current.length
          ? "Reading PDF text and drawing dimensions..."
          : "Scanned drawing - selected areas will use OCR");
      } else {
        if (!imageElement) return;
        const rotated = rotation % 180 !== 0;
        const sourceWidth = imageElement.naturalWidth;
        const sourceHeight = imageElement.naturalHeight;
        canvas.width = Math.round((rotated ? sourceHeight : sourceWidth) * zoom);
        canvas.height = Math.round((rotated ? sourceWidth : sourceHeight) * zoom);
        context.save();
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate((rotation * Math.PI) / 180);
        context.scale(zoom, zoom);
        context.drawImage(imageElement, -sourceWidth / 2, -sourceHeight / 2);
        context.restore();
        sourceRendered = true;
        setStatus("Image drawing - selected areas will use OCR");
      }

      if (sourceRendered && !autoExtractedRef.current) {
        autoExtractedRef.current = `${file.name}:${file.size}:${file.lastModified}`;
        const embeddedText = textBoxesRef.current
          .sort((a, b) => Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x)
          .map((box) => box.text)
          .join("\n");
        await autoExtractCanvas(canvas, embeddedText);
      }
    }

    async function autoExtractCanvas(canvas: HTMLCanvasElement, embeddedText = "") {
      setIsExtracting(true);
      setStatus("Reading drawing and filling recognized fields...");
      try {
        const scan = await createHighResolutionScan(canvas);
        const originalScan = cloneCanvas(scan);
        improveDrawingContrast(scan);
        const { createWorker } = await import("tesseract.js");
        const worker = await createWorker("eng", 1, {
          logger: (message: any) => {
            if (message.status === "recognizing text") setOcrProgress(message.progress || 0);
          },
        });
        await worker.setParameters({ tessedit_pageseg_mode: "11" as any, preserve_interword_spaces: "1" });
        const result = await worker.recognize(scan);
        const originalResult = await worker.recognize(originalScan);
        const titleBand = cropCanvas(scan, 0, 0.55, 1, 0.45);
        await worker.setParameters({ tessedit_pageseg_mode: "6" as any, preserve_interword_spaces: "1" });
        const titleResult = await worker.recognize(titleBand);
        await worker.terminate();
        if (cancelled) return;
        const recognizedCount = await onAutoText?.(
          `${embeddedText}\n${result.data.text}\n${originalResult.data.text}\n${titleResult.data.text}`
        ) || 0;
        setStatus(recognizedCount
          ? `Drawing read - ${recognizedCount} field${recognizedCount === 1 ? "" : "s"} filled`
          : "Drawing read - no reliable fields found");
      } catch (error) {
        setStatus(`Automatic drawing read failed: ${String(error)}`);
      } finally {
        setIsExtracting(false);
        setOcrProgress(null);
      }
    }

    async function createHighResolutionScan(preview: HTMLCanvasElement): Promise<HTMLCanvasElement> {
      const scan = document.createElement("canvas");
      if (isPdf && pageRef.current) {
        const base = pageRef.current.getViewport({ scale: 1, rotation });
        const recognitionScale = Math.min(5, Math.max(3, 4200 / base.width));
        const viewport = pageRef.current.getViewport({ scale: recognitionScale, rotation });
        scan.width = Math.ceil(viewport.width);
        scan.height = Math.ceil(viewport.height);
        const scanContext = scan.getContext("2d", { willReadFrequently: true });
        if (!scanContext) return preview;
        await pageRef.current.render({ canvasContext: scanContext, viewport }).promise;
        return scan;
      }

      const sourceWidth = imageElement?.naturalWidth || preview.width;
      const sourceHeight = imageElement?.naturalHeight || preview.height;
      const scale = Math.min(3, Math.max(1, 3600 / sourceWidth));
      scan.width = Math.round(sourceWidth * scale);
      scan.height = Math.round(sourceHeight * scale);
      const scanContext = scan.getContext("2d", { willReadFrequently: true });
      if (imageElement) scanContext?.drawImage(imageElement, 0, 0, scan.width, scan.height);
      else scanContext?.drawImage(preview, 0, 0, scan.width, scan.height);
      return scan;
    }

    render().catch((error) => {
      if (!cancelled && error?.name !== "RenderingCancelledException") {
        setStatus(`Drawing render failed: ${String(error)}`);
      }
    });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [documentVersion, file, imageElement, isPdf, onAutoText, pageNumber, rotation, zoom]);

  const pointFromEvent = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const overlay = overlayRef.current!;
    const rect = overlay.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(overlay.offsetWidth, event.clientX - rect.left)),
      y: Math.max(0, Math.min(overlay.offsetHeight, event.clientY - rect.top)),
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isExtracting) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);
    dragStartRef.current = point;
    setSelection({ ...point, width: 0, height: 0 });
    setExtractedText("");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const point = pointFromEvent(event);
    setSelection({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  };

  const handlePointerUp = async (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    const point = pointFromEvent(event);
    const finalSelection = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    };
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setSelection(finalSelection);
    await extractSelection(finalSelection);
  };

  const extractSelection = async (area: Selection) => {
    setIsExtracting(true);
    setOcrProgress(null);
    try {
      const embedded = extractEmbeddedText(area, textBoxesRef.current);
      if (embedded) {
        setExtractedText(extractValueForField(embedded, activeFieldLabel));
        setStatus("Text captured - review before applying");
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ratioX = canvas.width / (overlayRef.current?.offsetWidth || canvas.width);
      const ratioY = canvas.height / (overlayRef.current?.offsetHeight || canvas.height);
      const sourceSelection = {
        x: area.x * ratioX,
        y: area.y * ratioY,
        width: Math.max(1, area.width * ratioX),
        height: Math.max(1, area.height * ratioY),
      };
      const cropSpec = buildOcrCropSpec(sourceSelection, canvas.width, canvas.height);
      const sourceX = Math.round(cropSpec.cropArea.x);
      const sourceY = Math.round(cropSpec.cropArea.y);
      const sourceWidth = Math.max(1, Math.round(cropSpec.cropArea.width));
      const sourceHeight = Math.max(1, Math.round(cropSpec.cropArea.height));
      const ocrScale = sourceHeight < 120 ? 3 : 2;
      const crop = document.createElement("canvas");
      crop.width = sourceWidth * ocrScale;
      crop.height = sourceHeight * ocrScale;
      const context = crop.getContext("2d");
      if (context) {
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.fillStyle = "white";
        context.fillRect(0, 0, crop.width, crop.height);
      }
      context?.drawImage(
        canvas,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        crop.width,
        crop.height
      );

      setStatus("Running OCR on selected area...");
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message: any) => {
          if (message.status === "recognizing text") setOcrProgress(message.progress || 0);
        },
      });
      await worker.setParameters({
        tessedit_pageseg_mode: "11" as any,
        preserve_interword_spaces: "1",
      });
      const result = await worker.recognize(crop);
      await worker.terminate();
      const selectedOcrText = extractSelectedOcrText(result.data, scaleSelection(cropSpec.selectionInCrop, ocrScale), cropSpec.mode);
      const text = extractValueForField(cleanExtractedText(selectedOcrText || result.data.text), activeFieldLabel);
      setExtractedText(text);
      setStatus(text ? "OCR complete - review before applying" : "No text detected; select near the word and try again");
    } catch (error) {
      setStatus(`Text extraction failed: ${String(error)}`);
    } finally {
      setIsExtracting(false);
      setOcrProgress(null);
    }
  };

  return (
    <section className="h-full min-w-0 bg-[#202733] flex flex-col text-white">
      <header className="h-14 px-3 flex items-center gap-2 border-b border-white/10 bg-[#293241]">
        <div className="min-w-0 mr-auto">
          <p className="text-xs font-semibold truncate">{file.name}</p>
          <p className="text-[10px] text-white/55 truncate">Target: {activeFieldLabel || "Select a form field"}</p>
        </div>
        <ToolButton title="Previous page" disabled={pageNumber <= 1} onClick={() => setPageNumber((page) => page - 1)}><ChevronLeft /></ToolButton>
        <span className="text-[10px] tabular-nums">{pageNumber}/{pageCount}</span>
        <ToolButton title="Next page" disabled={pageNumber >= pageCount} onClick={() => setPageNumber((page) => page + 1)}><ChevronRight /></ToolButton>
        <ToolButton title="Zoom out" onClick={() => setZoom((value) => Math.max(0.5, value - 0.15))}><ZoomOut /></ToolButton>
        <span className="text-[10px] w-9 text-center">{Math.round(zoom * 100)}%</span>
        <ToolButton title="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, value + 0.15))}><ZoomIn /></ToolButton>
        <ToolButton title="Rotate" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw /></ToolButton>
        <ToolButton title="Close drawing" onClick={onClose}><X /></ToolButton>
      </header>

      <div className="flex-1 min-h-0 overflow-auto p-4 bg-[#161c25]">
        <div className="relative w-fit mx-auto shadow-2xl bg-white select-none">
          <canvas ref={canvasRef} className="block max-w-none" />
          <div
            ref={overlayRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute inset-0 cursor-crosshair touch-none"
          >
            {selection && (
              <div
                className="absolute border-2 border-cyan-400 bg-cyan-300/20 shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
                style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}
              />
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-white/10 bg-[#293241] p-3 space-y-2">
        <div className="flex items-center gap-2 min-h-5 text-[11px] text-white/70">
          {isExtracting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanText className="w-3.5 h-3.5" />}
          <span className="truncate">{status}</span>
          {ocrProgress !== null && <span className="ml-auto">{Math.round(ocrProgress * 100)}%</span>}
        </div>
        {extractedText && (
          <div className="flex gap-2">
            <Input
              value={extractedText}
              onChange={(event) => setExtractedText(event.target.value)}
              className="h-9 bg-white text-gray-900 border-0"
            />
            <Button
              type="button"
              disabled={!activeFieldLabel}
              onClick={() => {
                onApply(extractedText.trim());
                setStatus(`Applied to ${activeFieldLabel}`);
                setSelection(null);
                setExtractedText("");
              }}
              className="h-9 bg-cyan-600 hover:bg-cyan-500 whitespace-nowrap"
            >
              <Check className="w-4 h-4 mr-1.5" /> Apply
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function extractEmbeddedText(area: Selection, boxes: TextBox[]): string {
  const mode = getSelectionMode(area);
  const selected = mode === "point"
    ? selectNearestTextBox(area, boxes)
    : boxes.filter((box) => isTextBoxSelected(box, area, mode));
  if (!selected.length) return "";

  selected.sort((a, b) => Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);
  const lines: Array<{ y: number; values: string[] }> = [];
  for (const box of selected) {
    const line = lines.find((candidate) => Math.abs(candidate.y - box.y) <= 6);
    if (line) line.values.push(box.text);
    else lines.push({ y: box.y, values: [box.text] });
  }
  return cleanExtractedText(lines.map((line) => line.values.join(" ")).join("\n"));
}

function splitPdfTextIntoWordBoxes(
  text: string,
  x: number,
  y: number,
  width: number,
  height: number
): TextBox[] {
  const matches = Array.from(text.matchAll(/\S+/g));
  if (!matches.length) return [];
  return matches.map((match) => {
    const start = match.index || 0;
    const word = match[0];
    return {
      text: word,
      x: x + width * (start / text.length),
      y,
      width: Math.max(2, width * (word.length / text.length)),
      height,
    };
  });
}

function getSelectionMode(area: Selection): SelectionMode {
  const width = Math.abs(area.width);
  const height = Math.abs(area.height);
  if (width < 6 && height < 6) return "point";
  if (height < 6) return "horizontal-line";
  if (width < 6) return "vertical-line";
  return "area";
}

function selectNearestTextBox(area: Selection, boxes: TextBox[]): TextBox[] {
  const point = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  const containing = boxes.find((box) => pointInsideExpandedBox(point, box, Math.max(3, box.height * 0.25)));
  if (containing) return [containing];

  let closest: TextBox | null = null;
  let closestDistance = Infinity;
  for (const box of boxes) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const distance = Math.hypot(centerX - point.x, centerY - point.y);
    if (distance < closestDistance) {
      closest = box;
      closestDistance = distance;
    }
  }
  return closest && closestDistance <= Math.max(20, closest.height * 2.2) ? [closest] : [];
}

function isTextBoxSelected(box: TextBox, area: Selection, mode: SelectionMode): boolean {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const left = Math.min(area.x, area.x + area.width);
  const right = Math.max(area.x, area.x + area.width);
  const top = Math.min(area.y, area.y + area.height);
  const bottom = Math.max(area.y, area.y + area.height);

  if (mode === "horizontal-line") {
    const lineY = area.y + area.height / 2;
    return centerX >= left && centerX <= right && lineY >= box.y - box.height * 0.4 && lineY <= box.y + box.height * 1.4;
  }
  if (mode === "vertical-line") {
    const lineX = area.x + area.width / 2;
    return centerY >= top && centerY <= bottom && lineX >= box.x - box.width * 0.25 && lineX <= box.x + box.width * 1.25;
  }

  if (centerX >= left && centerX <= right && centerY >= top && centerY <= bottom) return true;
  const overlapX = Math.max(0, Math.min(box.x + box.width, right) - Math.max(box.x, left));
  const overlapY = Math.max(0, Math.min(box.y + box.height, bottom) - Math.max(box.y, top));
  const overlapRatio = (overlapX * overlapY) / Math.max(1, box.width * box.height);
  return overlapRatio >= 0.45;
}

function pointInsideExpandedBox(point: Point, box: Selection, padding: number): boolean {
  return (
    point.x >= box.x - padding &&
    point.x <= box.x + box.width + padding &&
    point.y >= box.y - padding &&
    point.y <= box.y + box.height + padding
  );
}

function extractValueForField(text: string, fieldLabel: string): string {
  const value = cleanExtractedText(text);
  const field = fieldLabel.toUpperCase();
  const rules: Array<[boolean, RegExp]> = [
    [field.includes("INSULATION LEVEL"), /(\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?(?:\s*\/\s*-?\s*|\s*)K\s*V(?:P)?)/i],
    [field.includes("FREQUENCY"), /((?:50\s*\/\s*60|50|60)\s*HZ)/i],
    [field.includes("BURDEN"), /(\d+(?:[.,]\d+)?\s*VA)/i],
    [field.includes("ACCURACY CLASS"), /(?:CLASS|CL)?\s*(PX|PS|\d+(?:\.\d+)?S?(?:P\d+)?)/i],
    [field === "RATIO" || field.startsWith("RATIO -"), /(\d+(?:\s*[\/-]\s*\d+){0,4}\s*[:/]\s*\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)*\s*A?)/i],
    [field.includes("RATED VOLTAGE"), /(\d+(?:\.\d+)?\s*KV)/i],
    [field.includes("STC"), /(\d+(?:\.\d+)?\s*KA\s*[/@]?\s*\d+(?:\.\d+)?\s*(?:S|SEC))/i],
    [field.includes("WIRE LENGTH") || field.includes("PRI LENGTH"), /(\d+(?:\.\d+)?\s*(?:MM|METER|METRE|M)\b)/i],
    [field.includes("WEIGHT"), /(\d+(?:\.\d+)?\s*KG)/i],
  ];
  for (const [applies, pattern] of rules) {
    if (!applies) continue;
    const match = value.match(pattern)?.[1];
    if (match) return match.replace(/\s+/g, "").replace(/,$/, "").toUpperCase();
  }
  return value.replace(/^\s*[,;:]|[,;:]\s*$/g, "").trim();
}

function buildOcrCropSpec(selection: Selection, maxWidth: number, maxHeight: number): OcrCropSpec {
  const mode = getSelectionMode(selection);
  let paddingX = 4;
  let paddingY = 4;

  if (mode === "point") {
    paddingX = Math.max(90, maxWidth * 0.035);
    paddingY = Math.max(28, maxHeight * 0.018);
  } else if (mode === "horizontal-line") {
    paddingX = 4;
    paddingY = Math.max(30, maxHeight * 0.018);
  } else if (mode === "vertical-line") {
    paddingX = Math.max(45, maxWidth * 0.018);
    paddingY = 4;
  }

  const left = Math.min(selection.x, selection.x + selection.width);
  const top = Math.min(selection.y, selection.y + selection.height);
  const right = Math.max(selection.x, selection.x + selection.width);
  const bottom = Math.max(selection.y, selection.y + selection.height);
  const cropX = Math.max(0, left - paddingX);
  const cropY = Math.max(0, top - paddingY);
  const cropRight = Math.min(maxWidth, right + paddingX);
  const cropBottom = Math.min(maxHeight, bottom + paddingY);

  return {
    mode,
    cropArea: {
      x: cropX,
      y: cropY,
      width: Math.max(1, cropRight - cropX),
      height: Math.max(1, cropBottom - cropY),
    },
    selectionInCrop: {
      x: left - cropX,
      y: top - cropY,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    },
  };
}

function scaleSelection(selection: Selection, scale: number): Selection {
  return {
    x: selection.x * scale,
    y: selection.y * scale,
    width: Math.max(1, selection.width * scale),
    height: Math.max(1, selection.height * scale),
  };
}

function extractSelectedOcrText(data: any, selection: Selection, mode: SelectionMode): string {
  const words = normalizeOcrWords(data?.words);
  if (!words.length) return mode === "area" ? cleanExtractedText(data?.text || "") : "";

  const selected = mode === "point"
    ? selectNearestTextBox(selection, words)
    : words.filter((box) => isTextBoxSelected(box, selection, mode));

  return selected.length ? joinTextBoxes(selected) : mode === "area" ? cleanExtractedText(data?.text || "") : "";
}

function normalizeOcrWords(words: any): TextBox[] {
  if (!Array.isArray(words)) return [];
  return words.flatMap((word): TextBox[] => {
    const text = cleanExtractedText(word?.text || "");
    const bbox = word?.bbox || {};
    const x0 = Number(bbox.x0 ?? word?.x0);
    const y0 = Number(bbox.y0 ?? word?.y0);
    const x1 = Number(bbox.x1 ?? word?.x1);
    const y1 = Number(bbox.y1 ?? word?.y1);
    if (!text || !Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(x1) || !Number.isFinite(y1)) {
      return [];
    }
    return [{
      text,
      x: Math.min(x0, x1),
      y: Math.min(y0, y1),
      width: Math.abs(x1 - x0),
      height: Math.abs(y1 - y0),
    }];
  });
}

function joinTextBoxes(boxes: TextBox[]): string {
  const ordered = [...boxes].sort((a, b) => Math.abs(a.y - b.y) > Math.max(8, Math.min(a.height, b.height) * 0.6)
    ? a.y - b.y
    : a.x - b.x);
  const lines: Array<{ y: number; height: number; values: string[] }> = [];
  for (const box of ordered) {
    const line = lines.find((candidate) => Math.abs(candidate.y - box.y) <= Math.max(8, Math.min(candidate.height, box.height) * 0.65));
    if (line) line.values.push(box.text);
    else lines.push({ y: box.y, height: box.height, values: [box.text] });
  }
  return cleanExtractedText(lines.map((line) => line.values.join(" ")).join("\n"));
}

function improveDrawingContrast(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < image.data.length; index += 4) {
    const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
    const value = gray < 205 ? 0 : 255;
    image.data[index] = value;
    image.data[index + 1] = value;
    image.data[index + 2] = value;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
}

function cropCanvas(
  source: HTMLCanvasElement,
  xRatio: number,
  yRatio: number,
  widthRatio: number,
  heightRatio: number
): HTMLCanvasElement {
  const crop = document.createElement("canvas");
  const sourceX = Math.round(source.width * xRatio);
  const sourceY = Math.round(source.height * yRatio);
  crop.width = Math.max(1, Math.round(source.width * widthRatio));
  crop.height = Math.max(1, Math.round(source.height * heightRatio));
  crop.getContext("2d")?.drawImage(
    source,
    sourceX,
    sourceY,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  );
  return crop;
}

function cloneCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const clone = document.createElement("canvas");
  clone.width = source.width;
  clone.height = source.height;
  clone.getContext("2d")?.drawImage(source, 0, 0);
  return clone;
}

function cleanExtractedText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
}

function ToolButton({ children, title, onClick, disabled }: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="w-8 h-8 flex items-center justify-center rounded-md text-white/75 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:pointer-events-none [&>svg]:w-4 [&>svg]:h-4"
    >
      {children}
    </button>
  );
}

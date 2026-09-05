import { unzlibSync } from "fflate";
import { deflate } from "pako";
import {
  MAX_LABEL_TAP_ROWS,
  SECONDARY_OPEN_CIRCUIT_WARNING,
  TAP_FIELD_NAMES,
  getLabelDiagramCores,
  getOrderedLabelDiagramCores,
  type BarTenderLabelRow,
  type BarTenderTapField,
} from "@/lib/ti-label-model";

type LabelTemplateManifest = {
  defaultTemplate: string;
  multiTapTemplate?: string;
  rowTemplates?: Record<string, string>;
  itemTemplates?: Array<{
    itemNos: string[];
    file: string;
  }>;
};

type PatchResult = {
  bytes: Uint8Array;
  replacedFields: string[];
  warnings: string[];
};

type ExtraDownload = {
  blob: Blob;
  fileName: string;
};

type DiagramExternalFile = ExtraDownload & {
  filePath: string;
};

type LabelFitProfile = {
  name: string;
  itemNoSeparator: "" | " ";
  labelStyle: "standard" | "compact";
  tapStyle: "standard" | "slash-compact" | "compact" | "tight";
  valueStyle: "standard" | "compact";
};

type CompressionAttempt = {
  compressed: Uint8Array | null;
  closestLength: number | null;
};

const FALLBACK_TEMPLATE = "ct-ti-label-template.btw";
const FALLBACK_MULTI_TAP_TEMPLATE = "38400191-50-100.btw";
const ROW_TEMPLATE_PREFIX = "rows-";
const DIAGRAM_PLACEHOLDER_NAME = "diagram-placeholder.bmp";
const DIAGRAM_PLACEHOLDER_PATH = "C:\\Users\\SealsE12\\Desktop\\CT-TI-App\\public\\label-templates\\diagram-placeholder.bmp";
const DIAGRAM_IMAGE_WIDTH = 1700;
const DIAGRAM_IMAGE_HEIGHT = 1100;
const DIAGRAM_FONT_FAMILY = "Verdana, Arial, Helvetica, sans-serif";
const DIAGRAM_TERMINAL_FONT_SCALE = 0.95;
const DIAGRAM_HORIZONTAL_PRIMARY_FONT_SCALE = 0.09;
const DIAGRAM_HORIZONTAL_PRIMARY_TERMINAL_SCALE = 0.78;
const DIAGRAM_TERMINAL_LABEL_GAP_SCALE = 0.25;
const DIAGRAM_VERTICAL_LABEL_WIDTH_SCALE = 1.08;
const DIAGRAM_HORIZONTAL_LABEL_GAP_SCALE = 0.2;
const WINDOWS_DOWNLOADS_DIR = "C:\\Users\\SealsE12\\Downloads\\";
const ZLIB_HEADERS = new Set(["789c", "7801", "78da"]);
const utf16LeDecoder = new TextDecoder("utf-16le", { ignoreBOM: true });
const LABEL_FIT_PROFILES = buildLabelFitProfiles();

export async function buildBarTenderBtwDownload({
  tiNo,
  itemNo,
  row,
}: {
  tiNo?: string | null;
  itemNo?: string | null;
  row: BarTenderLabelRow;
}): Promise<{ blob: Blob; fileName: string; replacedFields: string[]; templateFile: string; extraDownloads: ExtraDownload[] }> {
  const manifest = await fetchTemplateManifest();
  const templateErrors: string[] = [];
  const lockedTemplateFile = row ? getPreferredRowTemplateFile(manifest, row) : null;

  for (const templateFile of chooseTemplateFiles(manifest, itemNo, row)) {
    let templateError: unknown = null;
    try {
      const templateBytes = await fetchTemplateBytes(templateFile);
      const diagramFiles = shouldPatchDiagramTemplate(templateFile)
        ? buildDiagramExternalFiles({ tiNo, itemNo, row })
        : [null];

      for (const diagramFile of diagramFiles) {
        try {
          const patch = patchBarTenderTemplate(templateBytes, row, diagramFile?.filePath);

          return {
            blob: new Blob([patch.bytes as unknown as BlobPart], { type: "application/octet-stream" }),
            fileName: `${sanitizeDownloadPart(tiNo || "TI")}-${sanitizeDownloadPart(itemNo || row.ITEM_NO || "ITEM")}-label.btw`,
            replacedFields: patch.replacedFields,
            templateFile,
            extraDownloads: diagramFile ? [{ blob: diagramFile.blob, fileName: diagramFile.fileName }] : [],
          };
        } catch (error) {
          templateError = error;
        }
      }
    } catch (error) {
      templateError = error;
    }

    templateErrors.push(`${templateFile}: ${summarizeTemplateError(templateError)}`);
    if (lockedTemplateFile && templateFile === lockedTemplateFile) {
      throw new Error(`Selected row template could not create this label: ${templateErrors[0]}`);
    }
  }

  throw new Error(`Could not create the BarTender label without cutting required text. ${templateErrors.slice(0, 2).join(" | ")}`);
}

function shouldPatchDiagramTemplate(_templateFile: string): boolean {
  // Diagram BMP placeholders were removed from the templates, so the webapp no
  // longer generates the external diagram image or patches its file path.
  return false;
}

function buildDiagramExternalFiles({
  tiNo,
  itemNo,
  row,
}: {
  tiNo?: string | null;
  itemNo?: string | null;
  row: BarTenderLabelRow;
}): DiagramExternalFile[] {
  const blob = renderDiagramBmp(row);
  const downloadStamp = Date.now().toString(36).slice(-6);
  const diagramVariant = [
    row.DIAGRAM_ORIENTATION === "horizontal" ? "h" : "v",
    row.DIAGRAM_P1_POSITION === "end" ? "p1end" : "p1start",
    row.DIAGRAM_TERMINAL_POSITION === "end" ? "tend" : "tstart",
    row.DIAGRAM_TERMINAL_ORDER === "end" ? "sdesc" : "sasc",
    row.DIAGRAM_CORE_ORDER === "end" ? "cdesc" : "casc",
    downloadStamp,
  ].join("-");
  return buildFixedLengthDiagramFileNames(tiNo, itemNo || row.ITEM_NO, row.SR_NO, diagramVariant).map((fileName) => ({
    blob,
    fileName,
    filePath: `${WINDOWS_DOWNLOADS_DIR}${fileName}`,
  }));
}

function buildFixedLengthDiagramFileNames(
  tiNo?: string | null,
  itemNo?: string | null,
  serialNo?: string | null,
  diagramVariant = "v-p1start",
): string[] {
  const maxFileNameLength = DIAGRAM_PLACEHOLDER_PATH.length - WINDOWS_DOWNLOADS_DIR.length;
  const extension = ".bmp";
  const maxStemLength = maxFileNameLength - extension.length;
  const variant = sanitizeDownloadPart(diagramVariant);
  const values = [serialNo, itemNo, tiNo]
    .map((value) => sanitizeDownloadPart(value || ""))
    .filter(Boolean);
  const compactValues = values.map((value) => value.replace(/-/g, ""));
  const stems = [
    ...values.flatMap((value) => [
      `diagram-${variant}-${value}`,
      `diagram-placeholder-${value}`,
      `diagram-placeholder_${value}`,
      `diagram-placeholder${value}`,
      `${value}-diagram-placeholder`,
    ]),
    ...compactValues.flatMap((value) => [
      `diagram-${variant}-${value}`,
      `diagram-placeholder-${value}`,
      `diagram-placeholder_${value}`,
      `diagram-placeholder${value}`,
      `${value}-diagram-placeholder`,
    ]),
    "LTCT-diagram-placeholder",
    "diagram-placeholder-LTCT",
    "diagram-placeholder",
    "ct-diagram",
  ];

  return stems
    .map((stem) => `${stem.slice(0, maxStemLength).padEnd(maxStemLength, "_")}${extension}`)
    .filter((fileName, index, fileNames) => fileName.length === maxFileNameLength && fileNames.indexOf(fileName) === index);
}

function renderDiagramBmp(row: BarTenderLabelRow): Blob {
  if (typeof document === "undefined") {
    throw new Error("Diagram image can only be generated in the browser.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = DIAGRAM_IMAGE_WIDTH;
  canvas.height = DIAGRAM_IMAGE_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create diagram image.");

  const cores = getOrderedLabelDiagramCores(row);
  const maxTerminalCount = Math.max(...cores.map((core) => core.terminals.length), 2);
  const rowCount = Math.max(cores.length, 1);
  const width = canvas.width;
  const height = canvas.height;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#000000";
  context.fillStyle = "#000000";
  context.lineWidth = getDiagramStrokeWidth(width, height);
  context.textAlign = "center";
  context.textBaseline = "middle";

  if (row.DIAGRAM_ORIENTATION === "horizontal") {
    drawStackedTerminalDiagram(context, {
      cores,
      maxTerminalCount,
      rowCount,
      width,
      height,
      p1AtStart: row.DIAGRAM_P1_POSITION !== "end",
      terminalLabelsAtStart: row.DIAGRAM_TERMINAL_POSITION !== "end",
    });
  } else {
    drawLeftRightPrimaryDiagram(context, {
      cores,
      maxTerminalCount,
      rowCount,
      width,
      height,
      p1AtStart: row.DIAGRAM_P1_POSITION !== "end",
      terminalLabelsAtStart: row.DIAGRAM_TERMINAL_POSITION !== "end",
    });
  }

  return encodeCanvasAsBmp(cropCanvasToContent(canvas, Math.ceil(getDiagramStrokeWidth(width, height) * 1.5)));
}

type DiagramDrawOptions = {
  cores: ReturnType<typeof getLabelDiagramCores>;
  maxTerminalCount: number;
  rowCount: number;
  width: number;
  height: number;
  p1AtStart: boolean;
  terminalLabelsAtStart: boolean;
};

function drawLeftRightPrimaryDiagram(
  context: CanvasRenderingContext2D,
  { cores, maxTerminalCount, rowCount, width, height, p1AtStart, terminalLabelsAtStart }: DiagramDrawOptions,
) {
  const pFontSize = height * 0.16;
  const pLabelGap = Math.max(12, pFontSize * 0.42);
  const labelReserve = pFontSize * 1.55;
  const availableOuterWidth = width - (labelReserve + pLabelGap) * 2;
  const maxOuterHeight = height * 0.9;
  const terminalGapRatio = 0.55;
  const sidePaddingRatio = terminalGapRatio;
  const terminalCellScale = 1
    + DIAGRAM_TERMINAL_FONT_SCALE * (DIAGRAM_TERMINAL_LABEL_GAP_SCALE + DIAGRAM_VERTICAL_LABEL_WIDTH_SCALE);
  const widthDenominator = maxTerminalCount
    * terminalCellScale
    + Math.max(maxTerminalCount - 1, 0) * terminalGapRatio
    + sidePaddingRatio * 2;

  let boxSize = availableOuterWidth / widthDenominator;
  let terminalFontSize = boxSize * DIAGRAM_TERMINAL_FONT_SCALE;
  let labelGap = terminalFontSize * DIAGRAM_TERMINAL_LABEL_GAP_SCALE;
  let labelSideWidth = terminalFontSize * DIAGRAM_VERTICAL_LABEL_WIDTH_SCALE;
  let labelSlotHeight = measureTerminalLabelWidth(context, cores, terminalFontSize);
  let terminalGap = boxSize * terminalGapRatio;
  let terminalCellWidth = boxSize + labelGap + labelSideWidth;
  let rowContentHeight = Math.max(boxSize, labelSlotHeight);
  let outerHeight = rowCount * rowContentHeight + (rowCount + 1) * terminalGap;

  if (outerHeight > maxOuterHeight) {
    const scale = maxOuterHeight / outerHeight;
    boxSize *= scale;
    terminalFontSize = boxSize * DIAGRAM_TERMINAL_FONT_SCALE;
    labelGap = terminalFontSize * DIAGRAM_TERMINAL_LABEL_GAP_SCALE;
    labelSideWidth = terminalFontSize * DIAGRAM_VERTICAL_LABEL_WIDTH_SCALE;
    labelSlotHeight = measureTerminalLabelWidth(context, cores, terminalFontSize);
    terminalGap = boxSize * terminalGapRatio;
    terminalCellWidth = boxSize + labelGap + labelSideWidth;
    rowContentHeight = Math.max(boxSize, labelSlotHeight);
    outerHeight = rowCount * rowContentHeight + (rowCount + 1) * terminalGap;
  }

  const sidePadding = boxSize * sidePaddingRatio;
  const outerWidth = maxTerminalCount * terminalCellWidth
    + Math.max(maxTerminalCount - 1, 0) * terminalGap
    + sidePadding * 2;
  const availableLeft = labelReserve + pLabelGap;
  const availableCenter = width - availableLeft * 2;
  const outerX = availableLeft + (availableCenter - outerWidth) / 2;
  const outerY = (height - outerHeight) / 2;

  drawRotatedText(context, p1AtStart ? "P1" : "P2", labelReserve / 2, height / 2, Math.PI / 2, pFontSize);

  context.strokeRect(outerX, outerY, outerWidth, outerHeight);

  drawTerminalRows(context, {
    cores,
    outerX,
    outerY,
    outerWidth,
    rowContentHeight,
    boxSize,
    terminalGap,
    terminalFontSize,
    terminalCellWidth,
    labelGap,
    labelSideWidth,
    labelSlotHeight,
    terminalLabelsAtStart,
  });

  drawRotatedText(context, p1AtStart ? "P2" : "P1", width - labelReserve / 2, height / 2, Math.PI / 2, pFontSize);
}

function drawStackedTerminalDiagram(
  context: CanvasRenderingContext2D,
  { cores, maxTerminalCount, rowCount, width, height, p1AtStart, terminalLabelsAtStart }: DiagramDrawOptions,
) {
  const pReserveFontSize = height * DIAGRAM_HORIZONTAL_PRIMARY_FONT_SCALE;
  const pLabelGap = Math.max(10, pReserveFontSize * 0.35);
  const terminalGapRatio = 0.72;
  const maxOuterHeight = height - pReserveFontSize * 2 - pLabelGap * 2;
  const maxOuterWidth = width * 0.92;

  const horizontalCellScale = 1 + DIAGRAM_TERMINAL_FONT_SCALE * (1 + DIAGRAM_HORIZONTAL_LABEL_GAP_SCALE);
  let boxSize = maxOuterHeight / (maxTerminalCount * horizontalCellScale + (maxTerminalCount + 1) * terminalGapRatio);
  let terminalGap = boxSize * terminalGapRatio;
  let terminalFontSize = boxSize * DIAGRAM_TERMINAL_FONT_SCALE;
  let labelBoxGap = terminalFontSize * DIAGRAM_HORIZONTAL_LABEL_GAP_SCALE;
  let labelWidth = measureTerminalLabelWidth(context, cores, terminalFontSize);
  let cellWidth = Math.max(boxSize, labelWidth);
  let cellHeight = boxSize + labelBoxGap + terminalFontSize;
  let outerWidth = rowCount * cellWidth + (rowCount + 1) * terminalGap;

  if (outerWidth > maxOuterWidth) {
    const scale = maxOuterWidth / outerWidth;
    boxSize *= scale;
    terminalGap = boxSize * terminalGapRatio;
    terminalFontSize = boxSize * DIAGRAM_TERMINAL_FONT_SCALE;
    labelBoxGap = terminalFontSize * DIAGRAM_HORIZONTAL_LABEL_GAP_SCALE;
    labelWidth = measureTerminalLabelWidth(context, cores, terminalFontSize);
    cellWidth = Math.max(boxSize, labelWidth);
    cellHeight = boxSize + labelBoxGap + terminalFontSize;
    outerWidth = rowCount * cellWidth + (rowCount + 1) * terminalGap;
  }

  const outerHeight = maxTerminalCount * cellHeight + (maxTerminalCount + 1) * terminalGap;
  const outerX = (width - outerWidth) / 2;
  const outerY = (height - outerHeight) / 2;
  const pFontSize = Math.min(pReserveFontSize, terminalFontSize * DIAGRAM_HORIZONTAL_PRIMARY_TERMINAL_SCALE);
  const topLabelY = outerY - pLabelGap - pFontSize * 0.5;
  const bottomLabelY = outerY + outerHeight + pLabelGap + pFontSize * 0.5;

  drawDiagramText(context, p1AtStart ? "P1" : "P2", width / 2, topLabelY, pFontSize);
  context.strokeRect(outerX, outerY, outerWidth, outerHeight);

  cores.forEach((core, coreIndex) => {
    core.terminals.forEach((terminal, terminalIndex) => {
      const cellX = outerX + terminalGap + coreIndex * (cellWidth + terminalGap);
      const cellY = outerY + terminalGap + terminalIndex * (cellHeight + terminalGap);
      const boxX = cellX + (cellWidth - boxSize) / 2;
      const boxY = cellY;
      const labelX = cellX + cellWidth / 2;
      const labelY = boxY + boxSize + labelBoxGap + terminalFontSize * 0.5;
      drawDiagramText(context, terminal, labelX, labelY, terminalFontSize);
      context.lineWidth = getDiagramStrokeWidth(width, height);
      context.strokeRect(boxX, boxY, boxSize, boxSize);
    });
  });

  drawDiagramText(context, p1AtStart ? "P2" : "P1", width / 2, bottomLabelY, pFontSize);
}

function measureTerminalLabelWidth(
  context: CanvasRenderingContext2D,
  cores: ReturnType<typeof getLabelDiagramCores>,
  fontSize: number,
): number {
  context.save();
  setDiagramFont(context, fontSize);
  const measuredWidth = Math.max(
    ...cores.flatMap((core) => core.terminals.map((terminal) => context.measureText(terminal).width)),
    0
  );
  context.restore();
  return measuredWidth;
}

function drawTerminalRows(
  context: CanvasRenderingContext2D,
  {
    cores,
    outerX,
    outerY,
    outerWidth,
    rowContentHeight,
    boxSize,
    terminalGap,
    terminalFontSize,
    terminalCellWidth,
    labelGap,
    labelSideWidth,
    labelSlotHeight,
    terminalLabelsAtStart,
  }: {
    cores: ReturnType<typeof getLabelDiagramCores>;
    outerX: number;
    outerY: number;
    outerWidth: number;
    rowContentHeight: number;
    boxSize: number;
    terminalGap: number;
    terminalFontSize: number;
    terminalCellWidth: number;
    labelGap: number;
    labelSideWidth: number;
    labelSlotHeight: number;
    terminalLabelsAtStart: boolean;
  },
) {
  cores.forEach((core, rowIndex) => {
    const terminalCount = core.terminals.length;
    const terminalRowWidth = terminalCount * terminalCellWidth + (terminalCount - 1) * terminalGap;
    const startX = outerX + (outerWidth - terminalRowWidth) / 2;
    const rowY = outerY + terminalGap + rowIndex * (rowContentHeight + terminalGap);
    const rowCenterY = rowY + rowContentHeight / 2;

    core.terminals.forEach((terminal, terminalIndex) => {
      const cellX = startX + terminalIndex * (terminalCellWidth + terminalGap);
      const boxX = terminalLabelsAtStart
        ? cellX + labelSideWidth + labelGap
        : cellX;
      const labelX = terminalLabelsAtStart
        ? cellX + labelSideWidth / 2
        : boxX + boxSize + labelGap + labelSideWidth / 2;
      const boxY = rowCenterY - boxSize / 2;
      context.lineWidth = getDiagramStrokeWidth(context.canvas.width, context.canvas.height);
      context.strokeRect(boxX, boxY, boxSize, boxSize);
      drawRotatedText(context, terminal, labelX, rowCenterY, terminalLabelsAtStart ? -Math.PI / 2 : Math.PI / 2, terminalFontSize);
    });
  });
}

function drawRotatedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  angle: number,
  fontSize: number,
) {
  context.save();
  setDiagramFont(context, fontSize);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.translate(x, y);
  context.rotate(angle);
  context.fillText(text, 0, 0);
  context.restore();
}

function drawDiagramText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
) {
  context.save();
  setDiagramFont(context, fontSize);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y);
  context.restore();
}

function setDiagramFont(context: CanvasRenderingContext2D, fontSize: number) {
  context.font = `1000 ${fontSize}px ${DIAGRAM_FONT_FAMILY}`;
}

function getDiagramStrokeWidth(width: number, height: number): number {
  return Math.max(2, Math.round(Math.min(width / 720, height / 300) * 7));
}

function cropCanvasToContent(sourceCanvas: HTMLCanvasElement, padding: number): HTMLCanvasElement {
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) throw new Error("Could not crop diagram image.");

  const { width, height } = sourceCanvas;
  const pixels = sourceContext.getImageData(0, 0, width, height).data;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const alpha = pixels[offset + 3];
      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) return sourceCanvas;

  const cropX = Math.max(0, minX - padding);
  const cropY = Math.max(0, minY - padding);
  const cropRight = Math.min(width, maxX + padding + 1);
  const cropBottom = Math.min(height, maxY + padding + 1);
  const cropWidth = cropRight - cropX;
  const cropHeight = cropBottom - cropY;

  const croppedCanvas = document.createElement("canvas");
  croppedCanvas.width = cropWidth;
  croppedCanvas.height = cropHeight;
  const croppedContext = croppedCanvas.getContext("2d");
  if (!croppedContext) throw new Error("Could not create cropped diagram image.");
  croppedContext.fillStyle = "#ffffff";
  croppedContext.fillRect(0, 0, cropWidth, cropHeight);
  croppedContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  return croppedCanvas;
}

function encodeCanvasAsBmp(canvas: HTMLCanvasElement): Blob {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not read diagram image.");

  const width = canvas.width;
  const height = canvas.height;
  const imageData = context.getImageData(0, 0, width, height).data;
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const bytes = new Uint8Array(fileSize);
  const view = new DataView(bytes.buffer);

  bytes[0] = 0x42;
  bytes[1] = 0x4d;
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelSize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);

  for (let y = 0; y < height; y += 1) {
    const sourceY = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (sourceY * width + x) * 4;
      const targetOffset = 54 + y * rowSize + x * 3;
      bytes[targetOffset] = imageData[sourceOffset + 2];
      bytes[targetOffset + 1] = imageData[sourceOffset + 1];
      bytes[targetOffset + 2] = imageData[sourceOffset];
    }
  }

  return new Blob([bytes], { type: "image/bmp" });
}

async function fetchTemplateManifest(): Promise<LabelTemplateManifest> {
  try {
    const response = await fetch(labelTemplateUrl("manifest.json"), { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (typeof manifest?.defaultTemplate !== "string") throw new Error("Invalid manifest.");
    return manifest;
  } catch {
    return { defaultTemplate: FALLBACK_TEMPLATE, itemTemplates: [] };
  }
}

function buildLabelFitProfiles(): LabelFitProfile[] {
  const profiles: LabelFitProfile[] = [];
  const itemNoSeparators: Array<LabelFitProfile["itemNoSeparator"]> = ["", " "];
  const labelStyles: Array<LabelFitProfile["labelStyle"]> = ["standard", "compact"];
  const tapStyles: Array<LabelFitProfile["tapStyle"]> = ["standard", "slash-compact", "compact", "tight"];
  const valueStyles: Array<LabelFitProfile["valueStyle"]> = ["standard", "compact"];

  for (const itemNoSeparator of itemNoSeparators) {
    for (const labelStyle of labelStyles) {
      for (const tapStyle of tapStyles) {
        for (const valueStyle of valueStyles) {
          profiles.push({
            name: `${itemNoSeparator ? "spaced" : "tight"}-item-${labelStyle}-labels-${tapStyle}-taps-${valueStyle}-values`,
            itemNoSeparator,
            labelStyle,
            tapStyle,
            valueStyle,
          });
        }
      }
    }
  }

  return profiles.sort((left, right) => profileScore(left) - profileScore(right));
}

function profileScore(profile: LabelFitProfile): number {
  return (
    (profile.itemNoSeparator ? 8 : 0) +
    (profile.labelStyle === "compact" ? 4 : 0) +
    (profile.tapStyle === "slash-compact" ? 1 : profile.tapStyle === "compact" ? 2 : profile.tapStyle === "tight" ? 6 : 0) +
    (profile.valueStyle === "compact" ? 3 : 0)
  );
}

function chooseTemplateFiles(manifest: LabelTemplateManifest, itemNo?: string | null, row?: BarTenderLabelRow): string[] {
  const normalizedItemNos = [itemNo || "", row?.ITEM_NO || ""]
    .map(normalizeTemplateKey)
    .filter(Boolean);
  const itemTemplate = manifest.itemTemplates?.find((entry) =>
    entry.itemNos.some((candidate) => normalizedItemNos.includes(normalizeTemplateKey(candidate)))
  );
  const rowTemplate = row ? getPreferredRowTemplateFile(manifest, row) : null;
  const hasMultipleTaps = row ? hasMultipleTapRows(row) : false;
  if (rowTemplate) return [rowTemplate];

  const candidates = [
    itemTemplate?.file,
    hasMultipleTaps ? manifest.multiTapTemplate || FALLBACK_MULTI_TAP_TEMPLATE : null,
    hasMultipleTaps ? null : manifest.defaultTemplate || FALLBACK_TEMPLATE,
    hasMultipleTaps ? null : FALLBACK_TEMPLATE,
  ];

  return candidates.filter((file, index, files): file is string =>
    Boolean(file) && files.indexOf(file) === index
  );
}

function getPreferredRowTemplateFile(manifest: LabelTemplateManifest, row: BarTenderLabelRow): string | null {
  const tapRowCount = getTemplateTapRowCount(row);
  return tapRowCount ? getRowTemplateFile(manifest, tapRowCount) : null;
}

function getTemplateTapRowCount(row: BarTenderLabelRow): number {
  return Math.max(1, Math.min(getTapRows(row).length || 1, MAX_LABEL_TAP_ROWS));
}

function getRowTemplateFile(manifest: LabelTemplateManifest, tapRowCount: number): string | null {
  const paddedKey = `${ROW_TEMPLATE_PREFIX}${String(tapRowCount).padStart(2, "0")}`;
  const plainKey = String(tapRowCount);
  return manifest.rowTemplates?.[paddedKey] || manifest.rowTemplates?.[plainKey] || `${paddedKey}.btw`;
}

async function fetchTemplateBytes(fileName: string): Promise<Uint8Array> {
  const response = await fetch(labelTemplateUrl(fileName), { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`BarTender label template was not found: ${fileName}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function patchBarTenderTemplate(templateBytes: Uint8Array, row: BarTenderLabelRow, diagramFilePath?: string): PatchResult {
  const section = findBarTenderCompressedTextSection(templateBytes);
  if (!section) {
    throw new Error("No editable compressed BarTender text section was found in the bundled .btw template.");
  }

  const diagramPathPatch = patchDiagramExternalPicturePath(section.data, diagramFilePath);
  if (diagramFilePath && !diagramPathPatch.replaced) {
    throw new Error(`${DIAGRAM_PLACEHOLDER_NAME} external picture reference was not found in this template.`);
  }

  let closestLength: number | null = null;
  let closestProfile = "";
  let closestBlockingWarning = "";

  for (const profile of LABEL_FIT_PROFILES) {
    const { data: patchedData, replacedFields, warnings } = patchBarTenderData(diagramPathPatch.data, row, profile);
    const allReplacedFields = diagramPathPatch.replaced
      ? [...new Set([...replacedFields, "DIAGRAM_IMAGE"])]
      : replacedFields;

    if (!allReplacedFields.length) {
      throw new Error("No matching label text objects or placeholders were found in the bundled .btw template.");
    }

    const missingRequiredFields = getMissingRequiredFields(row, allReplacedFields);
    if (missingRequiredFields.length) {
      throw new Error(`Template does not contain required label fields: ${missingRequiredFields.join(", ")}.`);
    }

    if (patchedData.length !== section.data.length) {
      throw new Error("Patched BarTender data length changed. Refusing to create a possibly corrupt .btw file.");
    }

    if (hasCriticalTruncationWarning(warnings)) {
      closestBlockingWarning = warnings.join(" ");
      continue;
    }

    const attempt = tryCompressToTemplateLength(patchedData, section.compressedLength);
    if (attempt.compressed) {
      return {
        bytes: concatBytes([
          templateBytes.subarray(0, section.offset),
          attempt.compressed,
          section.trailing,
        ]),
        replacedFields: allReplacedFields,
        warnings,
      };
    }

    if (
      attempt.closestLength !== null &&
      (closestLength === null || Math.abs(attempt.closestLength - section.compressedLength) < Math.abs(closestLength - section.compressedLength))
    ) {
      closestLength = attempt.closestLength;
      closestProfile = profile.name;
    }
  }

  const closestText = closestLength === null
    ? ""
    : ` Closest generated section was ${closestLength} bytes with ${closestProfile}; template expects ${section.compressedLength} bytes.`;
  throw new Error(`Generated BarTender data could not fit the bundled .btw section length.${closestText}`);
}

function patchDiagramExternalPicturePath(data: Uint8Array, diagramFilePath?: string): { data: Uint8Array; replaced: boolean } {
  if (!diagramFilePath) return { data, replaced: false };

  const pathMatch = findUtf16PathContaining(data, DIAGRAM_PLACEHOLDER_NAME);
  if (!pathMatch) return { data, replaced: false };
  if (diagramFilePath.length !== pathMatch.value.length) {
    throw new Error(`Generated diagram image path must be ${pathMatch.value.length} characters, but it is ${diagramFilePath.length}.`);
  }

  const output = data.slice();
  output.set(encodeUtf16Le(diagramFilePath), pathMatch.start);
  return { data: output, replaced: true };
}

function findUtf16PathContaining(data: Uint8Array, fileName: string): { start: number; end: number; value: string } | null {
  const fileNameBytes = encodeUtf16Le(fileName);
  const matchIndex = indexOfBytes(data, fileNameBytes, 0);
  if (matchIndex < 0) return null;

  let start = matchIndex;
  while (start >= 2 && isUtf16PathCharacter(data[start - 2], data[start - 1])) {
    start -= 2;
  }

  let end = matchIndex + fileNameBytes.length;
  while (end + 1 < data.length && isUtf16PathCharacter(data[end], data[end + 1])) {
    end += 2;
  }

  return {
    start,
    end,
    value: decodeUtf16Le(data.subarray(start, end)),
  };
}

function isUtf16PathCharacter(lowByte: number, highByte: number): boolean {
  return highByte === 0 && lowByte >= 32 && lowByte <= 126;
}

function findBarTenderCompressedTextSection(fileBytes: Uint8Array) {
  const candidates: Array<{ offset: number; compressedLength: number; data: Uint8Array; trailing: Uint8Array }> = [];

  for (let offset = 0; offset < fileBytes.length - 2; offset += 1) {
    const header = toHex(fileBytes[offset]) + toHex(fileBytes[offset + 1]);
    if (!ZLIB_HEADERS.has(header)) continue;

    try {
      const data = unzlibSync(fileBytes.subarray(offset));
      if (data.length < 5000) continue;
      const text = decodeUtf16Le(data);
      if (!text.includes("BarTender") || !text.includes("Text ")) continue;
      candidates.push({
        offset,
        compressedLength: fileBytes.length - offset,
        data,
        trailing: new Uint8Array(),
      });
    } catch {
      // This byte pair only looked like a zlib header.
    }
  }

  return candidates.at(-1) || null;
}

function tryCompressToTemplateLength(data: Uint8Array, targetLength: number): CompressionAttempt {
  const strategies = [0, 1, 2, 3, 4];
  let closest: Uint8Array | null = null;

  for (let level = 9; level >= 1; level -= 1) {
    for (let memLevel = 1; memLevel <= 9; memLevel += 1) {
      for (const strategy of strategies) {
        try {
          const compressed = deflate(data, { level, memLevel, strategy });
          if (compressed.length === targetLength) return { compressed, closestLength: compressed.length };
          if (!closest || Math.abs(compressed.length - targetLength) < Math.abs(closest.length - targetLength)) {
            closest = compressed;
          }
        } catch {
          // Some pako option combinations are not stable for all inputs.
        }
      }
    }
  }

  if (closest && closest.length < targetLength) {
    const padded = new Uint8Array(targetLength);
    padded.set(closest);
    try {
      const decompressed = unzlibSync(padded);
      if (bytesEqual(decompressed, data)) return { compressed: padded, closestLength: closest.length };
    } catch {
      // Keep the original detailed failure below.
    }
  }

  return { compressed: null, closestLength: closest?.length || null };
}

function patchBarTenderData(data: Uint8Array, row: BarTenderLabelRow, profile: LabelFitProfile) {
  const replaced = new Set<string>();
  const warnings: string[] = [];
  const text = decodeUtf16Le(data);
  const output = data.slice();
  const values = buildBarTenderEmbeddedValues(row, profile);

  if (replaceBarTenderItemNoLines(output, values.ITEM_NO, profile, warnings) > 0) {
    replaced.add("ITEM_NO");
  }

  replaceTextObjects(output, text, [
    { field: "MFG", test: (value: string) => /^MFG\s*:/i.test(value), value: values.MFG },
    { field: "SR_NO", test: (value: string) => /^S(?:R|ERIAL)\.?\s*NO\s*:?/i.test(value), value: values.SR_NO_LINE },
    { field: "ITEM_NO", test: (value: string) => /^(ITEM\s*(NO|CODE)|ITEM\s*NO)\s*:?/i.test(value), value: values.ITEM_NO_LINE },
    { field: "CTR", test: (value: string) => /^CTR\s*:/i.test(value), value: values.CTR_LINE },
    { field: "STC", test: (value: string) => /^STC\s*:/i.test(value), value: values.STC_LINE },
    { field: "TAP", test: (value: string) => countTapMarkers(value) > 1, value: values.TAP_BLOCK },
    ...TAP_FIELD_NAMES.map((field, index) => ({
      field,
      test: (value: string) => isTapPlaceholder(value, field) || matchesTapLineIndex(value, index),
      value: values[field],
    })),
    { field: "IL", test: (value: string) => /^I\.?\s*L\.?\s*:/i.test(value), value: values.IL_LINE },
    { field: "FREQ", test: (value: string) => /^FREQ\.?\s*:/i.test(value), value: values.FREQ_LINE },
    { field: "INS_CLASS", test: (value: string) => /^(INS|INSULATION)\s*(CL|CLASS)\s*:/i.test(value), value: values.INS_CLASS_LINE },
    { field: "REF_STD", test: (value: string) => /^(REF\.?\s*STD|IEC|IS)\s*:?/i.test(value), value: values.REF_STD_LINE },
    { field: "WIRE_COLOUR", test: isWireColourPlaceholderText, value: values.WIRE_COLOUR_LINE },
    { field: "MFG_YEAR", test: (value: string) => /^MFG\s*YEAR\s*:/i.test(value), value: values.MFG_YEAR_LINE },
    { field: "MADE_IN_INDIA", test: (value: string) => /MADE\s+IN\s+INDIA/i.test(value), value: values.MADE_IN_INDIA },
  ], replaced, warnings);

  if (!replaced.has("ITEM_NO") && values.ITEM_NO) {
    replaceTextObjects(output, text, [
      { field: "ITEM_NO", test: isWireColourText, value: values.ITEM_NO_LINE },
    ], replaced, warnings);
  }

  if (!replaced.has("WIRE_COLOUR") && values.WIRE_COLOUR && !replaced.has("ITEM_NO")) {
    replaceTextObjects(output, text, [
      { field: "WIRE_COLOUR", test: isWireColourText, value: values.WIRE_COLOUR },
    ], replaced, warnings);
  }

  return { data: output, replacedFields: [...replaced], warnings };
}

function buildBarTenderEmbeddedValues(row: BarTenderLabelRow, profile: LabelFitProfile) {
  const tapRows = getTapRows(row).map((value) => formatTapText(value, profile.tapStyle)).filter(Boolean);
  const tapFields = Object.fromEntries(
    TAP_FIELD_NAMES.map((field, index) => [field, tapRows[index] || ""])
  ) as Record<BarTenderTapField, string>;
  const tapBlock = tapRows.join("\r\n");
  const lineSeparator = " : ";
  const ilSeparator = " : ";
  const ctr = formatValueText(row.CTR, profile.valueStyle);
  const il = formatValueText(row.IL, profile.valueStyle);
  const stc = formatValueText(row.STC, profile.valueStyle);
  const freq = formatValueText(row.FREQ, profile.valueStyle);
  const insClass = formatValueText(row.INS_CLASS, profile.valueStyle);
  const refStd = formatValueText(row.REF_STD || row.IEC, profile.valueStyle);
  const wireColour = formatValueText(row.WIRE_COLOUR, profile.valueStyle);
  const mfgYear = formatValueText(row.MFG_YEAR, profile.valueStyle);
  return {
    MFG: cleanPrinterText(row.MFG),
    SR_NO: cleanPrinterText(row.SR_NO),
    SR_NO_LINE: cleanPrinterText(row.SR_NO) ? `Sr No${lineSeparator}${cleanPrinterText(row.SR_NO)}` : "",
    ITEM_NO: cleanPrinterText(row.ITEM_NO),
    ITEM_NO_LINE: cleanPrinterText(row.ITEM_NO) ? `Item No${lineSeparator}${cleanPrinterText(row.ITEM_NO)}` : "",
    CTR: ctr,
    CTR_LINE: ctr ? `CTR${lineSeparator}${ctr}` : "",
    TAP: tapBlock,
    TAP_BLOCK: tapBlock,
    WIRE_COLOUR: wireColour,
    WIRE_COLOUR_LINE: wireColour ? `Wire Color${lineSeparator}${wireColour}` : SECONDARY_OPEN_CIRCUIT_WARNING,
    IL: il,
    IL_LINE: il ? `I.L${ilSeparator}${il}` : "",
    STC: stc,
    STC_LINE: stc ? `STC${lineSeparator}${stc}` : "",
    FREQ: freq,
    FREQ_LINE: freq ? `Freq${lineSeparator}${freq}` : "",
    INS_CLASS: insClass,
    INS_CLASS_LINE: insClass ? `INS CL${lineSeparator}${insClass}` : "",
    REF_STD: refStd,
    REF_STD_LINE: refStd,
    IEC: refStd,
    MFG_YEAR: mfgYear,
    MFG_YEAR_LINE: mfgYear ? `Mfg Year${lineSeparator}${mfgYear}` : "",
    MADE_IN_INDIA: cleanPrinterText(row.MADE_IN_INDIA || "MADE IN INDIA"),
    ...tapFields,
  };
}

function replaceTextObjects(
  output: Uint8Array,
  text: string,
  replacements: Array<{ field: string; test: (value: string) => boolean; value: string }>,
  replaced: Set<string>,
  warnings: string[],
) {
  const printablePattern = /[A-Za-z0-9 .,:/&()*\-\r\n]{4,}/g;
  const matches = [
    ...Array.from(text.matchAll(printablePattern), (match) => match[0]),
    ...extractLengthPrefixedUtf16Text(output),
  ]
    .filter((value, index, items) => items.indexOf(value) === index)
    .sort((a, b) => b.length - a.length);

  for (const match of matches) {
    const trimmed = match.trim();
    if (!trimmed) continue;
    const replacement = replacements.find((entry) => entry.test(trimmed));
    if (!replacement) continue;
    const count = replaceAllUtf16PreservingLength(output, match, preserveOuterWhitespace(match, replacement.value), warnings, replacement.field);
    if (count > 0) replaced.add(replacement.field);
  }
}

function extractLengthPrefixedUtf16Text(data: Uint8Array): string[] {
  const strings: string[] = [];

  for (let offset = 0; offset < data.length - 8; offset += 1) {
    const charLength = data[offset];
    if (charLength < 4 || charLength > 120) continue;
    const textOffset = offset + 1;
    const byteLength = charLength * 2;
    if (textOffset + byteLength > data.length) continue;

    let text = "";
    let valid = true;
    for (let index = 0; index < charLength; index += 1) {
      const low = data[textOffset + index * 2];
      const high = data[textOffset + index * 2 + 1];
      if (high !== 0 || low < 32 || low > 126) {
        valid = false;
        break;
      }
      text += String.fromCharCode(low);
    }

    if (valid && /[A-Za-z]/.test(text)) strings.push(text);
  }

  return strings;
}

function preserveOuterWhitespace(original: string, replacement: string): string {
  const leading = original.match(/^\s*/)?.[0] || "";
  const trailing = original.match(/\s*$/)?.[0] || "";
  return `${leading}${replacement}${trailing}`;
}

function replaceBarTenderItemNoLines(output: Uint8Array, itemNo: string, profile: LabelFitProfile, warnings: string[]): number {
  const searchBytes = encodeUtf16Le("ITEM NO");
  const separatorBytes = new Uint8Array([0x01, 0xff, 0xfe]);
  let count = 0;
  let offset = 0;

  while (offset <= output.length - searchBytes.length) {
    const matchIndex = indexOfBytes(output, searchBytes, offset);
    if (matchIndex < 0) break;

    const separatorIndex = indexOfBytes(output, separatorBytes, matchIndex + searchBytes.length);
    if (separatorIndex < 0 || (separatorIndex - matchIndex) % 2 !== 0) {
      offset = matchIndex + searchBytes.length;
      continue;
    }

    const originalLine = utf16LeDecoder.decode(output.subarray(matchIndex, separatorIndex));
    const prefix = originalLine.match(/^(ITEM\s*(?:NO|CODE)\s*:\s*)/i)?.[1];
    if (!prefix) {
      offset = matchIndex + searchBytes.length;
      continue;
    }

    const separator = profile.itemNoSeparator;
    const replacementLine = `${prefix.replace(/\s+$/, "")}${separator}${itemNo}`;
    const replacementBytes = encodeUtf16Le(fitReplacementToLength(replacementLine, originalLine.length, warnings, "ITEM_NO"));
    output.set(replacementBytes, matchIndex);
    count += 1;
    offset = separatorIndex + separatorBytes.length;
  }

  return count;
}

function replaceAllUtf16PreservingLength(output: Uint8Array, search: string, replacement: string, warnings: string[], field: string): number {
  if (!search) return 0;
  const searchBytes = encodeUtf16Le(search);
  const replacementBytes = encodeUtf16Le(fitReplacementToLength(replacement, search.length, warnings, field));
  let count = 0;
  let offset = 0;

  while (offset <= output.length - searchBytes.length) {
    const matchIndex = indexOfBytes(output, searchBytes, offset);
    if (matchIndex < 0) break;
    output.set(replacementBytes, matchIndex);
    count += 1;
    offset = matchIndex + searchBytes.length;
  }

  return count;
}

function fitReplacementToLength(value: string, length: number, warnings: string[], field: string): string {
  const text = String(value ?? "");
  if (text.length === length) return text;
  if (text.length < length) return text.padEnd(length, " ");
  warnings.push(`${field} was truncated because the bundled .btw text object is too short.`);
  return text.slice(0, length);
}

function cleanPrinterText(value: unknown): string {
  return String(value ?? "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/[\x1b\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTapText(value: unknown, style: LabelFitProfile["tapStyle"]): string {
  const text = cleanPrinterText(value);
  if (!text) return text;

  const match = text.match(/^([^:]+):\s*(.+)$/);
  if (!match) return normalizeLabelTextSpacing(text);

  const terminals = match[1].replace(/\s*-\s*/g, "-").trim();
  return `${terminals} : ${normalizeLabelTextSpacing(match[2])}`;
}

function formatValueText(value: unknown, style: LabelFitProfile["valueStyle"]): string {
  const text = cleanPrinterText(value);
  if (!text) return text;

  return normalizeLabelTextSpacing(text);
}

function normalizeLabelTextSpacing(value: string): string {
  return value
    .replace(/\s*:\s*/g, " : ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s*KV\b/gi, "kV")
    .replace(/\s*KA\b/gi, "kA")
    .replace(/\s*SEC\b/gi, "SEC")
    .replace(/\s*HZ\b/gi, "Hz")
    .replace(/\s*VA\b/gi, " VA")
    .replace(/\bCL\s*/gi, "CL ")
    .replace(/\s+/g, " ")
    .trim();
}

function countTapMarkers(value: string): number {
  return (String(value || "").match(/\b\d*S1\s*-\s*\d*S[2-5]\b/gi) || []).length;
}

function hasMultipleTapRows(row: BarTenderLabelRow): boolean {
  return getTapRows(row).length > 1;
}

function isWireColourText(value: string): boolean {
  return /\bS[1-5]\s*[-:]\s*(RED|BLACK|WHITE|BLUE|YELLOW|GREEN|BROWN|GREY|GRAY)\b/i.test(value);
}

function isWireColourPlaceholderText(value: string): boolean {
  return /^WIRE\s*(COLOU?R)?\s*:/i.test(value) || /^\*?\s*SECONDARY\s+TERMINALS\b/i.test(value);
}

function hasCriticalTruncationWarning(warnings: string[]): boolean {
  return warnings.some((warning) => /^(ITEM_NO|TAP(?:_\d{2})?|TAP_BLOCK|WIRE_COLOUR)\b/.test(warning));
}

function getMissingRequiredFields(row: BarTenderLabelRow, replacedFields: string[]): string[] {
  const replaced = new Set(replacedFields);
  const hasTapBlock = replaced.has("TAP") || replaced.has("TAP_BLOCK");
  const required: string[] = [];
  const tapRows = getTapRows(row);

  if (cleanPrinterText(row.ITEM_NO) && !replaced.has("ITEM_NO")) required.push("ITEM_NO");
  if (!replaced.has("WIRE_COLOUR")) required.push("WIRE_COLOUR");
  tapRows.forEach((tapRow, index) => {
    const field = TAP_FIELD_NAMES[index];
    if (cleanPrinterText(tapRow) && field && !replaced.has(field) && !hasTapBlock) required.push(field);
  });

  return required;
}

function getTapRows(row: BarTenderLabelRow): string[] {
  const rowsFromArray = Array.isArray(row.tapRows) ? row.tapRows : [];
  const rows = rowsFromArray.length ? rowsFromArray : TAP_FIELD_NAMES.map((field) => row[field]);
  return rows.map(cleanPrinterText).filter(Boolean).slice(0, MAX_LABEL_TAP_ROWS);
}

function isTapPlaceholder(value: string, field: BarTenderTapField): boolean {
  const escaped = field.replace("_", "[_\\s-]?");
  return new RegExp(`^${escaped}\\s*:`, "i").test(value);
}

function matchesTapLineIndex(value: string, index: number): boolean {
  const match = value.match(/\b\d*S1\s*-\s*\d*S([2-5])\b/i);
  if (!match) return false;
  return Number(match[1]) === index + 2;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizeTemplateKey(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
}

function summarizeTemplateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/required label fields/i.test(message)) return message;
  if (/could not fit|section length|truncated/i.test(message)) {
    return "template space is too small for one or more required label values";
  }
  if (/not found/i.test(message)) return message;
  return "template could not be patched";
}

function labelTemplateUrl(fileName: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return `${normalizedBase}label-templates/${encodeURIComponent(fileName)}`;
}

function sanitizeDownloadPart(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "label";
}

function encodeUtf16Le(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length * 2);
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >> 8;
  }
  return bytes;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, start: number): number {
  if (!needle.length) return -1;
  for (let index = start; index <= haystack.length - needle.length; index += 1) {
    let matched = true;
    for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
      if (haystack[index + needleIndex] !== needle[needleIndex]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

function decodeUtf16Le(data: Uint8Array): string {
  const evenLength = data.length - (data.length % 2);
  return utf16LeDecoder.decode(evenLength === data.length ? data : data.subarray(0, evenLength));
}

import { unzlibSync } from "fflate";
import { deflate } from "pako";

export type DrgBoxId = `Box_R${number}_C${number}`;
export type DrgTextSide = "up" | "down" | "left" | "right";
export type DrgTextRotation = 0 | 90 | 180 | 270;

type NamedBox = {
  id: DrgBoxId;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateOffset: number;
};

type CompressedSection = {
  offset: number;
  data: Uint8Array;
};

type OuterMargins = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type Bounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type DrgPatchOptions = {
  textSide: DrgTextSide;
  textByBox: Record<string, string>;
  textRotation: DrgTextRotation;
};

type NonZeroDrgTextRotation = Exclude<DrgTextRotation, 0>;
type TextRotationDelta = { preX: number; preY: number; postX: number; postY: number };

const TEMPLATE_FILE = "drg-master-template.btw";
const GRID_SIZE = 5;
const HIDDEN_POSITION = 9000;
const TEXT_VALUE_LENGTH = 3;
const TEXT_VALUE_RELATIVE_OFFSET = 1272;
const TEXT_ROTATION_CACHE_MULTIPLIER = 100;
const TEXT_HORIZONTAL_X_PADDING = 135;
const TEXT_HORIZONTAL_Y_PADDING = 80;
const TEXT_VERTICAL_X_PADDING = 90;
const TEXT_VERTICAL_Y_PADDING = 150;
const ZLIB_HEADERS = new Set(["789c", "7801", "78da"]);
const ALL_TEXT_SLOT_NAMES = buildAllTextSlotNames();
const ZERO_TEXT_ROTATION_DELTA: TextRotationDelta = { preX: 0, preY: 0, postX: 0, postY: 0 };
const VERTICAL_TEXT_ROTATION_90_DELTAS: Record<number, Record<number, TextRotationDelta>> = {
  1: {
    2: { preX: 84, preY: -76, postX: 84, postY: -32 },
    3: { preX: -14, preY: -70, postX: -14, postY: -124 },
    4: { preX: -161, preY: -70, postX: -7, postY: -124 },
  },
  2: {
    2: { preX: -10, preY: -1, postX: -87, postY: -55 },
    3: { preX: -15, preY: -1, postX: -92, postY: -55 },
    4: { preX: -162, preY: -71, postX: -8, postY: -125 },
  },
};
const HORIZONTAL_TEXT_ROTATION_DELTAS: Record<NonZeroDrgTextRotation, Record<number, TextRotationDelta>> = {
  90: {
    1: { preX: -121, preY: 33, postX: -123, postY: 28 },
    2: { preX: -34, preY: 122, postX: -36, postY: 122 },
    3: { preX: -78, preY: 78, postX: -80, postY: 76 },
    4: { preX: -34, preY: 122, postX: -36, postY: 122 },
    5: { preX: -34, preY: 122, postX: -36, postY: 122 },
    6: { preX: -34, preY: 122, postX: -36, postY: 122 },
  },
  180: {
    1: { preX: -158, preY: 1154, postX: -160, postY: 1155 },
    2: { preX: -158, preY: 854, postX: -160, postY: 854 },
    3: { preX: -160, preY: 270, postX: -162, postY: 271 },
    4: { preX: -160, preY: -154, postX: -162, postY: -154 },
    5: { preX: -160, preY: -656, postX: -162, postY: -656 },
    6: { preX: -160, preY: -1156, postX: -162, postY: -1156 },
  },
  270: {
    1: { preX: -36, preY: -122, postX: -38, postY: -127 },
    2: { preX: -122, preY: -36, postX: -124, postY: -36 },
    3: { preX: -79, preY: -79, postX: -81, postY: -81 },
    4: { preX: -122, preY: -36, postX: -124, postY: -36 },
    5: { preX: -122, preY: -36, postX: -124, postY: -36 },
    6: { preX: -122, preY: -36, postX: -124, postY: -36 },
  },
};

export async function downloadDrgBtw({
  selectedBoxes,
  tiNo,
  textSide = "down",
  textByBox = {},
  textRotation = 0,
}: {
  selectedBoxes: string[];
  tiNo?: string | null;
  textSide?: DrgTextSide;
  textByBox?: Record<string, string>;
  textRotation?: DrgTextRotation;
}): Promise<void> {
  const selected = new Set(selectedBoxes);
  if (selected.size === 0) {
    throw new Error("Select at least one box before download.");
  }

  const response = await fetch(labelTemplateUrl(TEMPLATE_FILE));
  if (!response.ok) {
    throw new Error(`Could not load drawing template: ${TEMPLATE_FILE}`);
  }

  const templateBytes = new Uint8Array(await response.arrayBuffer());
  const output = buildDrgBtw(templateBytes, selected, { textSide, textByBox, textRotation });
  downloadBlob(
    new Blob([output], { type: "application/octet-stream" }),
    `${sanitizeDownloadPart(tiNo || "TI")}-drg.btw`,
  );
}

export function buildDrgBtw(
  templateBytes: Uint8Array,
  selected: Set<string>,
  options: DrgPatchOptions = { textSide: "down", textByBox: {}, textRotation: 0 },
): Uint8Array {
  const section = findDrgCompressedSection(templateBytes);
  if (!section) {
    throw new Error("Drawing template section was not found.");
  }

  const data = section.data.slice();
  const boxes = getNamedBoxes(data);
  const visibleBoxes: NamedBox[] = [];

  for (const box of boxes) {
    if (selected.has(box.id)) {
      visibleBoxes.push(box);
    } else {
      setU32(data, box.coordinateOffset, HIDDEN_POSITION);
      setU32(data, box.coordinateOffset + 4, HIDDEN_POSITION);
    }
  }

  if (visibleBoxes.length === 0) {
    throw new Error("Select at least one box before download.");
  }

  const activeTextSlots = patchTextSlots(data, selected, options);
  resizeOuterBox(data, boxes, visibleBoxes, activeTextSlots);
  const compressed = deflate(data, { level: 9 });

  return concatBytes([
    templateBytes.subarray(0, section.offset),
    compressed,
  ]);
}

function getNamedBoxes(data: Uint8Array): NamedBox[] {
  const boxes: NamedBox[] = [];
  for (let row = 1; row <= GRID_SIZE; row += 1) {
    for (let col = 1; col <= GRID_SIZE; col += 1) {
      const id = `Box_R${row}_C${col}` as DrgBoxId;
      const coordinateOffset = findCoordinateOffset(data, id);
      const sizeOffset = findSizeOffset(data, id);
      boxes.push({
        id,
        x: getU32(data, coordinateOffset),
        y: getU32(data, coordinateOffset + 4),
        height: getU32(data, sizeOffset),
        width: getU32(data, sizeOffset + 4),
        coordinateOffset,
      });
    }
  }
  return boxes;
}

function patchTextSlots(data: Uint8Array, selected: Set<string>, options: DrgPatchOptions): string[] {
  const activeTextBySlot = new Map<string, string>();

  for (const boxId of selected) {
    const boxPosition = parseBoxId(boxId);
    if (!boxPosition) continue;
    const slotName = getTextSlotName(boxPosition.row, boxPosition.col, options.textSide);
    const textValue = options.textByBox[boxId] || defaultBoxText(boxPosition.row, boxPosition.col);
    if (fitTextValue(textValue).trim()) activeTextBySlot.set(slotName, textValue);
  }

  for (const slotName of ALL_TEXT_SLOT_NAMES) {
    const isActive = activeTextBySlot.has(slotName);
    patchTextObjectValue(data, slotName, activeTextBySlot.get(slotName) || "");
    if (isActive) {
      patchTextObjectRotation(data, slotName, options.textRotation);
    } else {
      hideTextObject(data, slotName);
    }
  }

  return [...activeTextBySlot.keys()];
}

function patchTextObjectValue(data: Uint8Array, slotName: string, value: string) {
  const valueOffset = findTextValueOffset(data, slotName);
  data.set(encodeUtf16Le(fitTextValue(value)), valueOffset);
}

function patchTextObjectRotation(data: Uint8Array, slotName: string, rotation: DrgTextRotation) {
  if (rotation === 0) return;

  const deltas = getTextRotationDelta(slotName, rotation);
  if (!deltas) {
    throw new Error(`${slotName} rotation was not mapped in the BarTender sample.`);
  }

  const nameOffset = findNameOffset(data, slotName);
  const angleValue = storedTextRotationAngle(rotation);
  const rotationFlag = angleValue / 900;
  const cacheValue = angleValue * TEXT_ROTATION_CACHE_MULTIPLIER;

  shiftU32(data, nameOffset - 118, deltas.preX);
  shiftU32(data, nameOffset - 114, deltas.preY);
  setU32(data, nameOffset - 102, rotationFlag);
  setU32(data, nameOffset - 22, cacheValue);
  setU32(data, nameOffset + 1305, angleValue);
  setU32(data, nameOffset + 1309, angleValue);
  shiftU32(data, nameOffset + 1454, deltas.postX);
  shiftU32(data, nameOffset + 1458, deltas.postY);
  setU32(data, nameOffset + 1470, rotationFlag);
  setU32(data, nameOffset + 1522, cacheValue);
}

function getTextRotationDelta(slotName: string, rotation: NonZeroDrgTextRotation): TextRotationDelta | null {
  const horizontalSlot = parseHorizontalTextSlot(slotName);
  if (horizontalSlot) return HORIZONTAL_TEXT_ROTATION_DELTAS[rotation][horizontalSlot.rowSlot] || null;
  const verticalSlot = parseVerticalTextSlot(slotName);
  if (verticalSlot) return getVerticalTextRotationDelta(verticalSlot, rotation);
  return null;
}

function getVerticalTextRotationDelta(
  slot: { colSlot: number; row: number },
  rotation: NonZeroDrgTextRotation,
): TextRotationDelta {
  if (rotation !== 90) return ZERO_TEXT_ROTATION_DELTA;

  const rowDeltas = VERTICAL_TEXT_ROTATION_90_DELTAS[slot.row === 1 ? 1 : 2];
  const exactDelta = rowDeltas[slot.colSlot];
  if (exactDelta) return exactDelta;
  if (slot.colSlot <= 2) return rowDeltas[2];
  if (slot.colSlot >= 4 && slot.colSlot <= 5) return rowDeltas[4];
  return rowDeltas[3];
}

function hideTextObject(data: Uint8Array, slotName: string) {
  const nameOffset = findNameOffset(data, slotName);
  setU32(data, nameOffset - 118, HIDDEN_POSITION);
  setU32(data, nameOffset - 114, HIDDEN_POSITION);
  setU32(data, nameOffset + 1454, HIDDEN_POSITION);
  setU32(data, nameOffset + 1458, HIDDEN_POSITION);
}

function storedTextRotationAngle(rotation: NonZeroDrgTextRotation): number {
  return (360 - rotation) * 10;
}

function findTextValueOffset(data: Uint8Array, slotName: string): number {
  const nameOffset = findNameOffset(data, slotName);
  const expectedOffset = nameOffset + TEXT_VALUE_RELATIVE_OFFSET;
  if (looksLikeTextValue(data, expectedOffset)) return expectedOffset;

  const marker = new Uint8Array([0xff, 0xfe, 0xff, TEXT_VALUE_LENGTH]);
  const searchEnd = Math.min(data.length, nameOffset + 1700);
  for (let offset = nameOffset + 900; offset < searchEnd - marker.length; offset += 1) {
    if (indexOfBytes(data, marker, offset) !== offset) continue;
    const valueOffset = offset + marker.length;
    if (looksLikeTextValue(data, valueOffset)) return valueOffset;
  }

  throw new Error(`Text value for ${slotName} was not found.`);
}

function looksLikeTextValue(data: Uint8Array, valueOffset: number): boolean {
  return valueOffset >= 4
    && valueOffset + TEXT_VALUE_LENGTH * 2 < data.length
    && data[valueOffset - 4] === 0xff
    && data[valueOffset - 3] === 0xfe
    && data[valueOffset - 2] === 0xff
    && data[valueOffset - 1] === TEXT_VALUE_LENGTH
    && data[valueOffset + TEXT_VALUE_LENGTH * 2] === 0x01;
}

function resizeOuterBox(data: Uint8Array, allBoxes: NamedBox[], selectedBoxes: NamedBox[], activeTextSlots: string[] = []) {
  const outerCoordinateOffset = findCoordinateOffset(data, "OuterBox");
  const outerSizeOffset = findSizeOffset(data, "OuterBox");
  const originalOuter = {
    left: getU32(data, outerCoordinateOffset),
    centerY: getU32(data, outerCoordinateOffset + 4),
    height: getU32(data, outerSizeOffset),
    width: getU32(data, outerSizeOffset + 4),
  };
  const originalOuterBounds = {
    left: originalOuter.left,
    right: originalOuter.left + originalOuter.width,
    top: originalOuter.centerY - originalOuter.height / 2,
    bottom: originalOuter.centerY + originalOuter.height / 2,
  };
  const originalMargins = getOriginalOuterMargins(allBoxes, originalOuterBounds);
  const selectedBounds = mergeBounds([
    getBoxBounds(selectedBoxes),
    ...getTextObjectBounds(data, activeTextSlots),
  ]);

  const left = Math.max(0, selectedBounds.left - originalMargins.left);
  const right = selectedBounds.right + originalMargins.right;
  const top = Math.max(0, selectedBounds.top - originalMargins.top);
  const bottom = selectedBounds.bottom + originalMargins.bottom;
  const height = Math.max(0, bottom - top);
  const width = Math.max(0, right - left);

  setU32(data, outerCoordinateOffset, left);
  setU32(data, outerCoordinateOffset + 4, top + height / 2);
  setU32(data, outerSizeOffset, height);
  setU32(data, outerSizeOffset + 4, width);
}

function getOriginalOuterMargins(
  boxes: NamedBox[],
  outerBounds: Bounds,
): OuterMargins {
  const boxBounds = getBoxBounds(boxes);
  return {
    left: Math.max(0, boxBounds.left - outerBounds.left),
    right: Math.max(0, outerBounds.right - boxBounds.right),
    top: Math.max(0, boxBounds.top - outerBounds.top),
    bottom: Math.max(0, outerBounds.bottom - boxBounds.bottom),
  };
}

function getBoxBounds(boxes: NamedBox[]): Bounds {
  return {
    left: Math.min(...boxes.map((box) => box.x)),
    right: Math.max(...boxes.map((box) => box.x + box.width)),
    top: Math.min(...boxes.map((box) => box.y - box.height / 2)),
    bottom: Math.max(...boxes.map((box) => box.y + box.height / 2)),
  };
}

function getTextObjectBounds(data: Uint8Array, slotNames: string[]): Bounds[] {
  return slotNames.flatMap((slotName) => {
    const nameOffset = findNameOffset(data, slotName);
    const x = getU32(data, nameOffset - 118);
    const y = getU32(data, nameOffset - 114);
    if (x >= HIDDEN_POSITION || y >= HIDDEN_POSITION) return [];

    const angleValue = getU32(data, nameOffset + 1305);
    const isQuarterTurn = angleValue === 900 || angleValue === 2700;
    const xPadding = isQuarterTurn ? TEXT_VERTICAL_X_PADDING : TEXT_HORIZONTAL_X_PADDING;
    const yPadding = isQuarterTurn ? TEXT_VERTICAL_Y_PADDING : TEXT_HORIZONTAL_Y_PADDING;

    // This coordinate pair is the one BarTender uses for the visible text position.
    return [{
      left: x - xPadding,
      right: x + xPadding,
      top: y - yPadding,
      bottom: y + yPadding,
    }];
  });
}

function mergeBounds(bounds: Bounds[]): Bounds {
  return {
    left: Math.min(...bounds.map((bound) => bound.left)),
    right: Math.max(...bounds.map((bound) => bound.right)),
    top: Math.min(...bounds.map((bound) => bound.top)),
    bottom: Math.max(...bounds.map((bound) => bound.bottom)),
  };
}

function findDrgCompressedSection(fileBytes: Uint8Array): CompressedSection | null {
  const candidates: CompressedSection[] = [];

  for (let offset = 0; offset < fileBytes.length - 2; offset += 1) {
    const header = toHex(fileBytes[offset]) + toHex(fileBytes[offset + 1]);
    if (!ZLIB_HEADERS.has(header)) continue;

    try {
      const data = unzlibSync(fileBytes.subarray(offset));
      if (data.length < 5000) continue;
      if (!hasTemplateObject(data, "OuterBox") || !hasTemplateObject(data, "Box_R1_C1") || !hasTemplateObject(data, "Box_R5_C5")) continue;
      candidates.push({ offset, data });
    } catch {
      // This byte pair only looked like a zlib header.
    }
  }

  return candidates.at(-1) || null;
}

function hasTemplateObject(data: Uint8Array, name: string): boolean {
  return indexOfBytes(data, encodeUtf16Le(name), 0) >= 0;
}

function findCoordinateOffset(data: Uint8Array, name: string): number {
  if (name === "Box_R1_C1") {
    const boxDataOffset = indexOfBytes(data, encodeAscii("BoxData"), 0);
    if (boxDataOffset >= 0) return boxDataOffset + "BoxData".length;
  }

  const nameOffset = findNameOffset(data, name);
  for (let offset = nameOffset - 2; offset >= Math.max(0, nameOffset - 300); offset -= 1) {
    if ((data[offset] === 0x0d || data[offset] === 0x0b) && data[offset + 1] === 0x80) return offset + 2;
  }

  throw new Error(`Coordinates for ${name} were not found.`);
}

function findSizeOffset(data: Uint8Array, name: string): number {
  const nameOffset = findNameOffset(data, name);
  return nameOffset + encodeUtf16Le(name).length + 18;
}

function findNameOffset(data: Uint8Array, name: string): number {
  const offset = indexOfBytes(data, encodeUtf16Le(name), 0);
  if (offset < 0) throw new Error(`${name} was not found in the drawing template.`);
  return offset;
}

function getTextSlotName(row: number, col: number, side: DrgTextSide): string {
  switch (side) {
    case "up": return `Txt_H${row}_C${col}`;
    case "down": return `Txt_H${row + 1}_C${col}`;
    case "left": return `Txt_V${col}_R${row}`;
    case "right": return `Txt_V${col + 1}_R${row}`;
  }
}

function buildAllTextSlotNames(): string[] {
  const names: string[] = [];
  for (let rowSlot = 1; rowSlot <= GRID_SIZE + 1; rowSlot += 1) {
    for (let col = 1; col <= GRID_SIZE; col += 1) names.push(`Txt_H${rowSlot}_C${col}`);
  }
  for (let row = 1; row <= GRID_SIZE; row += 1) {
    for (let colSlot = 1; colSlot <= GRID_SIZE + 1; colSlot += 1) names.push(`Txt_V${colSlot}_R${row}`);
  }
  return names;
}

function parseBoxId(boxId: string): { row: number; col: number } | null {
  const match = boxId.match(/^Box_R(\d+)_C(\d+)$/);
  if (!match) return null;
  return { row: Number(match[1]), col: Number(match[2]) };
}

function parseHorizontalTextSlot(slotName: string): { rowSlot: number; col: number } | null {
  const match = slotName.match(/^Txt_H(\d+)_C(\d+)$/);
  if (!match) return null;
  return { rowSlot: Number(match[1]), col: Number(match[2]) };
}

function parseVerticalTextSlot(slotName: string): { colSlot: number; row: number } | null {
  const match = slotName.match(/^Txt_V(\d+)_R(\d+)$/);
  if (!match) return null;
  return { colSlot: Number(match[1]), row: Number(match[2]) };
}

function defaultBoxText(row: number, col: number): string {
  return `${col}S${row}`;
}

function fitTextValue(value: string): string {
  return String(value || "")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .slice(0, TEXT_VALUE_LENGTH)
    .padEnd(TEXT_VALUE_LENGTH, " ");
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
    .replace(/^-+|-+$/g, "") || "TI";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function encodeAscii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff;
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

function getU32(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

function setU32(data: Uint8Array, offset: number, value: number) {
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(offset, Math.round(value), true);
}

function shiftU32(data: Uint8Array, offset: number, delta: number) {
  setU32(data, offset, getU32(data, offset) + delta);
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


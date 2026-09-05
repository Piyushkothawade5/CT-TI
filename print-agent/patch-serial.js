#!/usr/bin/env node
/*
 * patch-serial.js — inject a starting serial number into a saved BarTender .btw.
 *
 * Usage:  node patch-serial.js <path-to.btw> "<new-serial>"
 *
 * It finds the zlib-compressed UTF-16LE text section (same structure the webapp
 * patches in src/lib/bartender-btw.ts), replaces the value shown after "Sr No :"
 * with <new-serial> (length-preserving), then re-compresses to the SAME byte
 * length so the file stays valid, and writes it back in place.
 *
 * Exit codes:
 *   0  serial replaced and file rewritten
 *   2  no "Sr No" serial field found (caller should fall back to letting the
 *      operator type the serial the webapp displayed)
 *   1  hard error (bad args, unreadable file, could not recompress)
 *
 * This mirrors the proven approach in the webapp. If BarTender's serialization
 * is driven by a separate data source rather than the visible "Sr No" text,
 * standardize the label so the serial IS that visible text object, or use the
 * type-the-serial fallback.
 */
const fs = require("fs");
const { unzlibSync } = require("fflate");
const { deflate } = require("pako");

const ZLIB_HEADERS = new Set(["789c", "7801", "78da"]);
const decoder = new TextDecoder("utf-16le", { ignoreBOM: true });

function toHex(value) {
  return value.toString(16).padStart(2, "0");
}

function decodeUtf16Le(data) {
  const even = data.length - (data.length % 2);
  return decoder.decode(even === data.length ? data : data.subarray(0, even));
}

function encodeUtf16Le(text) {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    bytes[i * 2] = code & 0xff;
    bytes[i * 2 + 1] = code >> 8;
  }
  return bytes;
}

function indexOfBytes(haystack, needle, start) {
  if (!needle.length) return -1;
  for (let i = start; i <= haystack.length - needle.length; i += 1) {
    let ok = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function findSection(bytes) {
  let last = null;
  for (let off = 0; off < bytes.length - 2; off += 1) {
    const header = toHex(bytes[off]) + toHex(bytes[off + 1]);
    if (!ZLIB_HEADERS.has(header)) continue;
    try {
      const data = unzlibSync(bytes.subarray(off));
      if (data.length < 5000) continue;
      const text = decodeUtf16Le(data);
      if (!text.includes("BarTender") || !text.includes("Text ")) continue;
      last = { offset: off, data, compressedLength: bytes.length - off };
    } catch {
      // Byte pair only looked like a zlib header.
    }
  }
  return last;
}

function fit(value, length) {
  if (value.length === length) return value;
  if (value.length < length) return value.padEnd(length, " ");
  return value.slice(0, length);
}

// BarTender stores text as 1-byte-length-prefixed UTF-16LE, so the text sits at
// odd byte offsets and a whole-buffer UTF-16 decode misreads it. Read the
// length-prefixed runs directly (alignment-independent), same as the webapp.
function extractLengthPrefixedUtf16Text(data) {
  const strings = [];
  for (let off = 0; off < data.length - 8; off += 1) {
    const charLength = data[off];
    if (charLength < 4 || charLength > 120) continue;
    const textOffset = off + 1;
    const byteLength = charLength * 2;
    if (textOffset + byteLength > data.length) continue;
    let text = "";
    let valid = true;
    for (let i = 0; i < charLength; i += 1) {
      const lo = data[textOffset + i * 2];
      const hi = data[textOffset + i * 2 + 1];
      if (hi !== 0 || lo < 32 || lo > 126) { valid = false; break; }
      text += String.fromCharCode(lo);
    }
    if (valid && /[A-Za-z]/.test(text)) strings.push(text);
  }
  return strings;
}

function replaceAllUtf16PreservingLength(out, search, replacement) {
  if (!search) return 0;
  const searchBytes = encodeUtf16Le(search);
  const replacementBytes = encodeUtf16Le(fit(replacement, search.length));
  let count = 0;
  let offset = 0;
  while (offset <= out.length - searchBytes.length) {
    const idx = indexOfBytes(out, searchBytes, offset);
    if (idx < 0) break;
    out.set(replacementBytes, idx);
    count += 1;
    offset = idx + searchBytes.length;
  }
  return count;
}

// Replace the serial inside the "Sr No : <serial>" data-source value, keeping the
// object's exact character length (and its trailing padding) intact.
function patchSerial(data, newSerial) {
  const out = data.slice();
  const candidates = new Set(extractLengthPrefixedUtf16Text(data));
  const full = decodeUtf16Le(data);
  for (const match of full.matchAll(/[A-Za-z0-9 .,:/&()*\-]{4,}/g)) candidates.add(match[0]);

  let replaced = 0;
  for (const value of candidates) {
    if (!/^\s*S(?:r|erial)\.?\s*No\s*:/i.test(value)) continue;
    const prefix = value.match(/^(\s*S(?:r|erial)\.?\s*No\s*:\s*)/i)?.[1] ?? "Sr No : ";
    const newValue = fit(`${prefix}${newSerial}`, value.length);
    replaced += replaceAllUtf16PreservingLength(out, value, newValue);
  }
  return { out, replaced };
}

// Set the document's "SerializedCount" (number of serialized labels a single print
// job produces) to `count`. Stored as: the UTF-16LE name "SerializedCount", then a
// `ff fe ff` value marker, then a 1-byte length + UTF-16LE digits. Returns count of
// fields changed (0 if the field is absent).
function patchSerializedCount(data, count) {
  const nameBytes = encodeUtf16Le("SerializedCount");
  const nameAt = indexOfBytes(data, nameBytes, 0);
  if (nameAt < 0) return { data, replaced: 0 };

  const marker = new Uint8Array([0xff, 0xfe, 0xff]);
  const windowStart = nameAt + nameBytes.length;
  const rel = indexOfBytes(data.subarray(windowStart, windowStart + 16), marker, 0);
  if (rel < 0) return { data, replaced: 0 };

  const lenPos = windowStart + rel + marker.length;
  const oldLen = data[lenPos];
  if (oldLen < 1 || oldLen > 10) return { data, replaced: 0 };
  const valPos = lenPos + 1;

  const newDigits = String(Math.max(1, Math.floor(count)));
  const newValBytes = encodeUtf16Le(newDigits);

  const before = data.subarray(0, lenPos);
  const after = data.subarray(valPos + oldLen * 2);
  const out = new Uint8Array(before.length + 1 + newValBytes.length + after.length);
  out.set(before, 0);
  out[before.length] = newDigits.length;
  out.set(newValBytes, before.length + 1);
  out.set(after, before.length + 1 + newValBytes.length);
  return { data: out, replaced: 1 };
}

// Recompress `data` to exactly `targetLength` bytes (mirrors bartender-btw.ts).
function compressToLength(data, targetLength) {
  let closest = null;
  for (let level = 9; level >= 1; level -= 1) {
    for (let memLevel = 1; memLevel <= 9; memLevel += 1) {
      for (const strategy of [0, 1, 2, 3, 4]) {
        try {
          const compressed = deflate(data, { level, memLevel, strategy });
          if (compressed.length === targetLength) return compressed;
          if (!closest || Math.abs(compressed.length - targetLength) < Math.abs(closest.length - targetLength)) {
            closest = compressed;
          }
        } catch {
          // Some pako option combos are unstable for certain inputs.
        }
      }
    }
  }
  if (closest && closest.length < targetLength) {
    const padded = new Uint8Array(targetLength);
    padded.set(closest);
    try {
      if (bytesEqual(unzlibSync(padded), data)) return padded;
    } catch {
      // fall through
    }
  }
  return null;
}

function main() {
  const [, , filePath, newSerial, countArg] = process.argv;
  if (!filePath || !newSerial) {
    console.error("Usage: node patch-serial.js <file.btw> <new-serial> [count]");
    process.exit(1);
  }

  const bytes = new Uint8Array(fs.readFileSync(filePath));
  const section = findSection(bytes);
  if (!section) {
    console.error("No editable BarTender text section found.");
    process.exit(1);
  }

  const serialResult = patchSerial(section.data, String(newSerial));
  if (!serialResult.replaced) {
    console.error('No "Sr No" serial field found to replace.');
    process.exit(2);
  }

  let working = serialResult.out;
  let countReplaced = 1;
  if (countArg) {
    const r = patchSerializedCount(working, Number(countArg));
    working = r.data;
    countReplaced = r.replaced;
  }

  // The zlib text section is self-terminating and runs to EOF, and nothing in the
  // file records its size (verified across templates). So prefer the original byte
  // length when we can hit it (keeps the file identical), but fall back to a plain
  // recompress of any length rather than failing — BarTender reads the stream to its
  // natural end regardless. This handles both pako- and BarTender-compressed files.
  let compressed = compressToLength(working, section.compressedLength);
  if (!compressed) {
    compressed = deflate(working, { level: 6 });
  }

  const result = new Uint8Array(section.offset + compressed.length);
  result.set(bytes.subarray(0, section.offset), 0);
  result.set(compressed, section.offset);
  fs.writeFileSync(filePath, Buffer.from(result));

  if (countArg && !countReplaced) {
    console.error(`Injected serial ${newSerial}, but SerializedCount field was not found.`);
    process.exit(3);
  }
  console.log(`Injected serial ${newSerial}${countArg ? `, SerializedCount=${countArg}` : ""}.`);
  process.exit(0);
}

main();

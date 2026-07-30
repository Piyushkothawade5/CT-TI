# Drawing Extraction Assessment

## Corpus

- Source archive: `OneDrive_2026-07-03.zip`
- PDFs: 308
- Unique PDF hashes: 292
- PDFs with useful native text: 35
- PDFs requiring OCR: 273
- PDF read errors: 0

Families represented:

- Lucy drawings
- SH01 LTCT tape wound
- SH02 LTCT resin cast
- SH03 HTCT resin cast
- SH04 HTVT resin cast
- Toshiba

## Historical Ground Truth

The imported item master contains 530 items. Drawing identifiers were matched from filenames and embedded text against `ga_drg` and `cust_part_code`.

- Unique historical dimension: 25 PDFs
- Multiple conflicting historical dimensions: 26 PDFs
- No historical match: 257 PDFs

Generic/type-table drawings commonly map to several valid dimensions. They must not be assigned one dimension unless the selected TYPE or item variant is known.

## Baseline Results

The browser OCR plus deterministic parser was evaluated against the 25 uniquely labelled drawings.

- Exact matches: 4/25
- Exact-match rate: 16%
- Blank results: 10
- Incorrect nonblank results: 11

A two-source OCR consensus strategy performed worse:

- Exact matches: 1/25
- Incorrect nonblank results: 2
- Safe abstentions: 22

Conclusion: OCR/parser dimensions are not reliable enough for silent production prefilling.

## Implemented Safety Policy

`CT Final Dim` now uses historical resolution:

1. Extract the primary drawing identifier from the uploaded filename.
2. Match it against Supabase item-master `ga_drg` and `cust_part_code` values.
3. Prefill only when all matching historical items have one distinct dimension.
4. Leave the field blank when matches conflict or no historical dimension exists.
5. Continue allowing manual selection and overwrite.

OCR-derived dimensions are not silently applied.

## Production Path

The remaining extraction service should provide:

- Native PDF words and OCR words with page coordinates.
- Drawing-family and TYPE/variant detection.
- Structured dimension candidates with source bounding boxes.
- Server-side vision-model fallback for unresolved drawings.
- Physical and product-family validation.
- High/medium/low confidence with calibrated thresholds.
- Mandatory confirmation for anything below high confidence.
- Versioned audit records and a growing human-confirmed benchmark.

Automatic prefilling should be enabled only after a representative labelled benchmark demonstrates the required precision.

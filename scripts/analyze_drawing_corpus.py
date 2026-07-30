#!/usr/bin/env python3
"""Build a drawing-to-item benchmark manifest from a local PDF corpus."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader


IDENTIFIER_PATTERNS = (
    r"SH\d{2}G\d{3,}",
    r"ER\d{6,}",
    r"THM\d{5,}",
    r"DUB\d{5,}",
    r"4CT\d{4,}",
    r"\d{9,}",
)

MANIFEST_COLUMNS = [
    "drawing_id",
    "relative_path",
    "family",
    "filename",
    "bytes",
    "sha256",
    "pages",
    "native_text_chars",
    "requires_ocr",
    "tokens",
    "item_match_count",
    "distinct_dimensions",
    "ground_truth_status",
    "ground_truth_dimension",
    "pdf_error",
]

MATCH_COLUMNS = [
    "drawing_id",
    "relative_path",
    "matched_tokens",
    "item_no",
    "customer",
    "ga_drg",
    "cust_part_code",
    "ct_final_dim",
]


def compact(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]", "", (value or "").upper())


def identifiers(value: str | None) -> set[str]:
    normalized = compact(value)
    found: set[str] = set()
    for pattern in IDENTIFIER_PATTERNS:
        found.update(re.findall(pattern, normalized))
    return {token for token in found if len(token) >= 7}


def split_sql_tuple(line: str) -> list[str]:
    value = line.strip().rstrip(",;")
    if value.startswith("(") and value.endswith(")"):
        value = value[1:-1]
    fields: list[str] = []
    buffer: list[str] = []
    quoted = False
    index = 0
    while index < len(value):
        char = value[index]
        if char == "'":
            if quoted and index + 1 < len(value) and value[index + 1] == "'":
                buffer.append("'")
                index += 2
                continue
            quoted = not quoted
            index += 1
            continue
        if char == "," and not quoted:
            fields.append("".join(buffer).strip())
            buffer = []
        else:
            buffer.append(char)
        index += 1
    fields.append("".join(buffer).strip())
    return fields


def sql_value(value: str) -> str:
    cleaned = re.sub(r"::[a-z0-9_]+$", "", value.strip(), flags=re.I)
    return "" if cleaned.lower() == "null" else cleaned


def load_item_master(sql_path: Path) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    in_item_values = False
    for line in sql_path.read_text(encoding="utf-8").splitlines():
        if line.startswith("insert into public.ct_items"):
            in_item_values = True
            continue
        if not in_item_values:
            continue
        if line.lower().startswith("on conflict"):
            break
        if not line.lstrip().startswith("("):
            continue
        fields = split_sql_tuple(line)
        if len(fields) < 24:
            continue
        offset = 1 if len(fields) >= 25 and sql_value(fields[1]) in {"standard", "non_standard"} else 0
        row = {
            "item_no": sql_value(fields[0]),
            "ct_type": sql_value(fields[1 + offset]),
            "cust_part_code": sql_value(fields[2 + offset]),
            "ratio": sql_value(fields[3 + offset]),
            "ct_final_dim": sql_value(fields[12 + offset]),
            "ga_drg": sql_value(fields[13 + offset]),
            "customer": sql_value(fields[23 + offset]),
        }
        row["tokens"] = sorted(identifiers(" ".join((row["ga_drg"], row["cust_part_code"]))))
        items.append(row)
    return items


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_pdf(path: Path) -> tuple[int, str, str]:
    try:
        reader = PdfReader(str(path))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
        return len(reader.pages), text, ""
    except Exception as error:  # Keep corrupt/encrypted files visible in the manifest.
        return 0, "", str(error)


def family_for(relative_path: Path) -> str:
    parts = relative_path.parts
    return parts[1] if len(parts) > 2 else "GA Drg root"


def match_items(tokens: set[str], items: Iterable[dict[str, str]]) -> list[dict[str, str]]:
    matches = []
    for item in items:
        shared = tokens.intersection(item["tokens"])
        if shared:
            matches.append({**item, "matched_tokens": sorted(shared)})
    return matches


def analyze(corpus: Path, sql_path: Path, output: Path) -> None:
    items = load_item_master(sql_path)
    pdfs = sorted(corpus.rglob("*.pdf"), key=lambda path: str(path).lower())
    output.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []
    match_rows: list[dict[str, str]] = []

    for index, path in enumerate(pdfs, start=1):
        relative = path.relative_to(corpus)
        pages, text, error = read_pdf(path)
        tokens = identifiers(f"{relative.stem}\n{text[:12000]}")
        matches = match_items(tokens, items)
        dimensions = sorted({item["ct_final_dim"] for item in matches if item["ct_final_dim"]})
        status = "unmatched"
        if len(dimensions) == 1:
            status = "unique"
        elif len(dimensions) > 1:
            status = "ambiguous"
        record = {
            "drawing_id": index,
            "relative_path": relative.as_posix(),
            "family": family_for(relative),
            "filename": path.name,
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
            "pages": pages,
            "native_text_chars": len(text.strip()),
            "requires_ocr": len(text.strip()) < 80,
            "tokens": sorted(tokens),
            "item_match_count": len(matches),
            "distinct_dimensions": dimensions,
            "ground_truth_status": status,
            "ground_truth_dimension": dimensions[0] if len(dimensions) == 1 else "",
            "pdf_error": error,
        }
        manifest.append(record)
        for item in matches:
            match_rows.append({
                "drawing_id": str(index),
                "relative_path": relative.as_posix(),
                "matched_tokens": "|".join(item["matched_tokens"]),
                "item_no": item["item_no"],
                "customer": item["customer"],
                "ga_drg": item["ga_drg"],
                "cust_part_code": item["cust_part_code"],
                "ct_final_dim": item["ct_final_dim"],
            })

    manifest_path = output / "drawing_manifest.csv"
    with manifest_path.open("w", newline="", encoding="utf-8-sig") as destination:
        writer = csv.DictWriter(destination, fieldnames=MANIFEST_COLUMNS)
        writer.writeheader()
        for record in manifest:
            writer.writerow({**record, "tokens": "|".join(record["tokens"]), "distinct_dimensions": "|".join(record["distinct_dimensions"])})

    matches_path = output / "drawing_item_matches.csv"
    with matches_path.open("w", newline="", encoding="utf-8-sig") as destination:
        writer = csv.DictWriter(destination, fieldnames=MATCH_COLUMNS)
        writer.writeheader()
        writer.writerows(match_rows)

    family_counts = Counter(record["family"] for record in manifest)
    status_counts = Counter(record["ground_truth_status"] for record in manifest)
    summary = {
        "pdf_count": len(manifest),
        "item_master_count": len(items),
        "families": dict(sorted(family_counts.items())),
        "ground_truth_status": dict(sorted(status_counts.items())),
        "native_text_pdfs": sum(not record["requires_ocr"] for record in manifest),
        "ocr_required_pdfs": sum(bool(record["requires_ocr"]) for record in manifest),
        "pdf_errors": sum(bool(record["pdf_error"]) for record in manifest),
    }
    (output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--sql", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    analyze(args.corpus.resolve(), args.sql.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()

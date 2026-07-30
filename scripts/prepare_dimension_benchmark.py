#!/usr/bin/env python3
"""Render uniquely labelled drawings into reproducible OCR benchmark fixtures."""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
from pathlib import Path

from PIL import Image
from pypdf import PdfReader


def embedded_text(path: Path) -> str:
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def prepare(manifest: Path, corpus: Path, output: Path, pdftoppm: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    with manifest.open("r", encoding="utf-8-sig", newline="") as source:
        rows = [row for row in csv.DictReader(source) if row["ground_truth_status"] == "unique"]

    cases = []
    for number, row in enumerate(rows, start=1):
        pdf = (corpus / Path(row["relative_path"])).resolve()
        if not pdf.is_relative_to(corpus.resolve()):
            raise RuntimeError(f"Unsafe corpus path: {row['relative_path']}")
        prefix = output / f"case-{number:03d}"
        subprocess.run(
            [str(pdftoppm), "-f", "1", "-singlefile", "-r", "300", "-png", str(pdf), str(prefix)],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        rendered = prefix.with_suffix(".png")
        with Image.open(rendered) as source_image:
            original = source_image.convert("RGB")
            if original.width > 4200:
                height = round(original.height * 4200 / original.width)
                original = original.resize((4200, height), Image.Resampling.LANCZOS)
            original.save(prefix.with_name(prefix.name + "-original.png"))
            threshold = original.convert("L").point(lambda pixel: 0 if pixel < 205 else 255).convert("RGB")
            threshold.save(prefix.with_name(prefix.name + "-threshold.png"))
            title = threshold.crop((0, round(threshold.height * 0.55), threshold.width, threshold.height))
            title.save(prefix.with_name(prefix.name + "-title.png"))
        rendered.unlink()
        cases.append({
            "case_id": number,
            "relative_path": row["relative_path"],
            "family": row["family"],
            "expected": row["ground_truth_dimension"],
            "embedded_text": embedded_text(pdf),
            "original_image": str(prefix.with_name(prefix.name + "-original.png").resolve()),
            "threshold_image": str(prefix.with_name(prefix.name + "-threshold.png").resolve()),
            "title_image": str(prefix.with_name(prefix.name + "-title.png").resolve()),
        })

    (output / "cases.json").write_text(json.dumps(cases, indent=2), encoding="utf-8")
    print(json.dumps({"prepared_cases": len(cases), "output": str(output.resolve())}, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--pdftoppm", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.manifest.resolve(), args.corpus.resolve(), args.output.resolve(), args.pdftoppm.resolve())


if __name__ == "__main__":
    main()

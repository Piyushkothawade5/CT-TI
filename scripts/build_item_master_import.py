"""Build a Supabase import containing ONLY the item master (public.ct_items).

The full importer (build_supabase_import_current.py) also emits TI records,
work orders and counter syncs. This script is intentionally narrow: it reads
the item master sheet from the CT_TI data-entry workbook and writes a single
SQL file that upserts rows into public.ct_items and nothing else.

Usage:
    python scripts/build_item_master_import.py \
        --workbook path/to/CT_TI_DATA_ENTRY_4.xlsm \
        --output supabase/import_item_master.sql
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
from typing import Any

import openpyxl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGACY_IMPORT_PATH = PROJECT_ROOT / "scripts" / "build_supabase_import.py"

spec = importlib.util.spec_from_file_location("legacy_supabase_import", LEGACY_IMPORT_PATH)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Could not load legacy importer at {LEGACY_IMPORT_PATH}")
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


# Item master columns: the legacy set plus the drawing columns that exist on
# the current public.ct_items schema. The workbook carries no drawings, so the
# drawing columns are always null here and are preserved on conflict.
ITEM_COLUMNS = [
    *legacy.ITEM_COLUMNS,
    "drawing_url",
    "drawing_file_name",
    "drawing_content_type",
]

JSON_COLUMNS = {"core1", "core2", "core3"}
PRESERVE_ON_NULL = {"drawing_url", "drawing_file_name", "drawing_content_type"}


def sql_string(value: Any) -> str:
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


def sql_json(value: Any) -> str:
    payload = value if value is not None else {}
    return sql_string(json.dumps(payload, ensure_ascii=False, sort_keys=True)) + "::jsonb"


def sql_value(column: str, row: dict[str, Any]) -> str:
    value = row.get(column)
    if column in JSON_COLUMNS:
        return sql_json(value if value is not None else {})
    return sql_string(value)


def values_clause(row: dict[str, Any]) -> str:
    return "(" + ", ".join(sql_value(column, row) for column in ITEM_COLUMNS) + ")"


def workbook_item_to_row(row: dict[str, Any]) -> dict[str, Any]:
    output = {column: row.get(column) for column in ITEM_COLUMNS}
    output["ti_format"] = output.get("ti_format") or "standard"
    output["drawing_url"] = None
    output["drawing_file_name"] = None
    output["drawing_content_type"] = None
    return output


def item_sort_key(row: dict[str, Any]) -> tuple[int, int, str]:
    text = str(row.get("item_no") or "")
    return (0, int(text), text) if text.isdigit() else (1, 0, text)


def write_item_insert(file: Any, rows: list[dict[str, Any]]) -> None:
    if not rows:
        file.write("-- No item master rows found in the workbook.\n")
        return
    file.write(f"insert into public.ct_items ({', '.join(ITEM_COLUMNS)})\nvalues\n")
    file.write(",\n".join(values_clause(row) for row in rows))
    updates = []
    for column in ITEM_COLUMNS:
        if column == "item_no":
            continue
        if column in PRESERVE_ON_NULL:
            updates.append(f"{column} = coalesce(excluded.{column}, public.ct_items.{column})")
        else:
            updates.append(f"{column} = excluded.{column}")
    file.write("\non conflict (item_no) do update set\n  ")
    file.write(",\n  ".join(updates))
    file.write(";\n\n")


def parse_item_master(workbook: Path) -> list[dict[str, Any]]:
    wb = openpyxl.load_workbook(
        workbook,
        data_only=True,
        keep_vba=workbook.suffix.lower() == ".xlsm",
    )
    items_by_no: dict[str, dict[str, Any]] = {}
    for row in legacy.parse_items(wb):
        item = workbook_item_to_row(row)
        item_no = item.get("item_no")
        if item_no:
            items_by_no[item_no] = item
    return sorted(items_by_no.values(), key=item_sort_key)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a Supabase item-master-only import.")
    parser.add_argument("--workbook", type=Path, required=True, help="Path to the CT_TI data-entry .xlsm/.xlsx")
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "supabase" / "import_item_master.sql",
        help="Output SQL file path",
    )
    args = parser.parse_args()

    items = parse_item_master(args.workbook)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as file:
        file.write("-- CT item master import (public.ct_items only).\n")
        file.write(f"-- Source: {args.workbook.name}\n")
        file.write(f"-- Item master rows: {len(items)}\n")
        file.write("-- Idempotent upsert on item_no; drawing columns are preserved when null.\n\n")
        file.write("begin;\n\n")
        write_item_insert(file, items)
        file.write("commit;\n")

    print(json.dumps({"output": str(args.output), "items": len(items)}, indent=2))


if __name__ == "__main__":
    main()

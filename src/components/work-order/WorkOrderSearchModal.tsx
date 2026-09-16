import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  useTiLabelStatuses,
  useUpdateWorkOrder,
  TI_SOURCE_WORK_ORDER_FIELDS,
  type TiLabelSummary,
  type WorkOrderInput,
} from "@/api-client";
import type { WorkOrderRecord } from "@/lib/work-orders";
import { computeLabelProgress } from "@/lib/label-progress";
import { LabelStatusBadge } from "./LabelStatusBadge";
import {
  ExcelColumnFilterPopover,
  normalizeFieldValue,
  isColumnFilterActive,
  type ColumnFilters,
  type ColumnFilterState,
} from "./ExcelColumnFilter";

interface ColumnDefinition {
  key: keyof WorkOrderRecord;
  label: string;
  minWidth: string;
  isMono?: boolean;
  align?: "left" | "center" | "right";
}

const TABLE_COLUMNS: ColumnDefinition[] = [
  { key: "work_order", label: "WORK ORDER", minWidth: "160px" },
  { key: "customer", label: "CUSTOMER", minWidth: "190px" },
  { key: "po_no", label: "PO NO", minWidth: "145px" },
  { key: "po_date", label: "PO DATE", minWidth: "120px" },
  { key: "po_line_no", label: "ITEM NO OF P.O", minWidth: "135px" },
  { key: "item_code", label: "ITEM CODE", minWidth: "160px" },
  { key: "our_item_code", label: "OUR ITEM CODE", minWidth: "140px", isMono: true },
  { key: "specification", label: "SPECIFICATION", minWidth: "380px" },
  { key: "qty", label: "QTY", minWidth: "85px", align: "center" },
  { key: "sr_no", label: "SR NO", minWidth: "160px", isMono: true },
  { key: "ti_no", label: "TI NO", minWidth: "140px", isMono: true },
  { key: "traceability_sr_no", label: "TRACEABILITY SR. NO.", minWidth: "185px", isMono: true },
];

// Columns that map to an editable Work Order field. `id`, `created_at`, etc. are
// never shown, and everything visible above corresponds to a persisted column, so
// the whole set is editable — the update mutation enforces the real integrity
// rules (TI reallocation, checked-TI gating, master re-sync).
const EDITABLE_KEYS = new Set<keyof WorkOrderRecord>(TABLE_COLUMNS.map((c) => c.key));

// Columns that must not change once the linked TI is "checked": the TI-source
// fields (the backend rejects those) plus the TI number itself. WO-only columns
// (specification, traceability_sr_no) stay editable.
const TI_LOCKED_KEYS = new Set<string>([...(TI_SOURCE_WORK_ORDER_FIELDS as string[]), "ti_no"]);

type CellAddress = { rowId: string; colKey: keyof WorkOrderRecord };
type SaveStatus = "saving" | "saved" | "error";
type EntryMode = "preserve" | "overwrite" | "clear";
type EditEntry = { rowId: string; colKey: keyof WorkOrderRecord; oldValue: string; newValue: string };

function getInputType(colKey: keyof WorkOrderRecord): React.HTMLInputTypeAttribute {
  if (colKey === "qty") return "number";
  if (colKey === "po_date") return "date";
  return "text";
}

function getRawCellValue(record: WorkOrderRecord, colKey: keyof WorkOrderRecord): string {
  const value = record[colKey];
  return value === undefined || value === null ? "" : String(value);
}

// Rebuild a full WorkOrderInput from the record with one cell changed. The update
// path re-sends every column (including created_by), so a partial payload would
// wipe the other fields — always send the whole record.
function toWorkOrderInput(
  record: WorkOrderRecord,
  colKey: keyof WorkOrderRecord,
  newValue: string
): WorkOrderInput {
  const src = { ...record, [colKey]: newValue } as WorkOrderRecord;
  return {
    work_order: src.work_order || "",
    customer: src.customer || "",
    po_no: src.po_no || "",
    po_date: src.po_date || "",
    po_line_no: src.po_line_no || "",
    item_code: src.item_code || "",
    our_item_code: src.our_item_code || "",
    specification: src.specification || "",
    qty: src.qty || "",
    sr_no: src.sr_no || "",
    ti_no: src.ti_no || "",
    traceability_sr_no: src.traceability_sr_no || "",
    created_by: src.created_by || "",
    created_by_user_id: src.created_by_user_id ?? null,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

interface WorkOrderSearchModalProps {
  open: boolean;
  records: WorkOrderRecord[];
  onClose: () => void;
  onSelect: (record: WorkOrderRecord) => void;
  /** When false (View-Only roles) the grid is read-only and cells are not editable. */
  canEdit?: boolean;
}

export function WorkOrderSearchModal({
  open,
  records,
  onClose,
  onSelect,
  canEdit = false,
}: WorkOrderSearchModalProps) {
  const { toast } = useToast();
  const updateWorkOrderMutation = useUpdateWorkOrder();

  // Label print status per TI (polls while the modal is open) for the LABELS column.
  const { data: labelData } = useTiLabelStatuses({ query: { enabled: open } });
  const labelStatusByTi = useMemo(() => {
    const map = new Map<string, TiLabelSummary>();
    for (const status of labelData?.statuses ?? []) {
      if (status.ti_no) map.set(status.ti_no, status);
    }
    return map;
  }, [labelData]);

  const [filters, setFilters] = useState<ColumnFilters>({});

  // Optimistic local copy of records — updated immediately, before Supabase confirms.
  const [localRecords, setLocalRecords] = useState<WorkOrderRecord[]>(records);
  const localRecordsRef = useRef<WorkOrderRecord[]>(records);
  useEffect(() => {
    localRecordsRef.current = localRecords;
  }, [localRecords]);

  const [selectedCell, setSelectedCell] = useState<CellAddress | null>(null);
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null);
  const [originalValue, setOriginalValue] = useState<string>("");
  const [cellSaveStatus, setCellSaveStatus] = useState<Map<string, SaveStatus>>(new Map());

  const editingCellRef = useRef<CellAddress | null>(null);
  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

  const inputRef = useRef<HTMLInputElement>(null);
  const editInitRef = useRef<{ value: string; selStart: number; selEnd: number }>({
    value: "",
    selStart: 0,
    selEnd: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Undo/redo history for cell edits (Ctrl+Z / Ctrl+Y). Kept in refs so pushing
  // history never triggers a re-render; reset when the modal closes.
  const undoStackRef = useRef<EditEntry[]>([]);
  const redoStackRef = useRef<EditEntry[]>([]);

  // Sync the optimistic copy whenever fresh records arrive from the query cache.
  // Cells that still have an in-flight save keep their optimistic value so a
  // background refetch does not visibly revert them mid-flight.
  useEffect(() => {
    setLocalRecords((prev) => {
      let hasSaving = false;
      cellSaveStatus.forEach((status) => {
        if (status === "saving") hasSaving = true;
      });
      if (!hasSaving) return records;
      return records.map((record) => {
        let row = record;
        cellSaveStatus.forEach((status, key) => {
          if (status !== "saving") return;
          const [rid, ck] = key.split(":");
          if (rid !== record.id) return;
          const prevRow = prev.find((p) => p.id === record.id);
          if (prevRow) row = { ...row, [ck]: (prevRow as Record<string, unknown>)[ck] } as WorkOrderRecord;
        });
        return row;
      });
    });
    // Intentionally keyed on records only; cellSaveStatus is read as a snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  // Reset all edit/selection state when the modal closes.
  useEffect(() => {
    if (open) return;
    setSelectedCell(null);
    setEditingCell(null);
    setOriginalValue("");
    setCellSaveStatus(new Map());
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, [open]);

  // Lock the background page scroll while the full-screen modal is open, so the
  // Work Order form's scrollbar doesn't remain visible at the right edge.
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Close on Escape when nothing is selected/editing and no popover handled it.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return; // handled by a cell or a Radix popover
      if (editingCellRef.current) return; // edit-mode Escape is handled on the input
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Multi-column filter logic (AND across columns), applied to the optimistic copy
  // so freshly edited values immediately participate in filtering.
  const filteredRecords = useMemo(() => {
    return localRecords.filter((record) => {
      for (const [colKey, filter] of Object.entries(filters)) {
        if (!filter) continue;
        const rawVal = record[colKey as keyof WorkOrderRecord];
        const normalizedVal = normalizeFieldValue(rawVal);
        if (!filter.selectedValues.has(normalizedVal)) return false;
        if (filter.textContains) {
          const textTarget = rawVal ? String(rawVal).toLowerCase() : "";
          if (!textTarget.includes(filter.textContains.toLowerCase())) return false;
        }
      }
      return true;
    });
  }, [localRecords, filters]);

  const activeFilters = useMemo(() => {
    const list: Array<{ key: keyof WorkOrderRecord; label: string; filter: ColumnFilterState }> = [];
    for (const col of TABLE_COLUMNS) {
      const f = filters[col.key];
      if (f && isColumnFilterActive(f, f.allValues.length)) {
        list.push({ key: col.key, label: col.label, filter: f });
      }
    }
    return list;
  }, [filters]);

  const handleApplyColumnFilter = (key: keyof WorkOrderRecord, filter: ColumnFilterState | undefined) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (!filter) delete next[key];
      else next[key] = filter;
      return next;
    });
  };

  const handleResetAllFilters = () => setFilters({});
  const handleClearSingleFilter = (key: keyof WorkOrderRecord) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // --- Save indicator helpers ------------------------------------------------
  const setSaveStatus = useCallback((key: string, status: SaveStatus) => {
    setCellSaveStatus((prev) => new Map(prev).set(key, status));
  }, []);
  const clearSaveStatusLater = useCallback((key: string, delay: number) => {
    setTimeout(() => {
      setCellSaveStatus((prev) => {
        const m = new Map(prev);
        m.delete(key);
        return m;
      });
    }, delay);
  }, []);

  // --- Autosave --------------------------------------------------------------
  // Persist one cell to the server with an optimistic update. `revertValue` is
  // what to restore if the save fails. This carries no undo bookkeeping so undo
  // and redo can reuse it without pushing new history.
  const persistCell = useCallback(
    (cell: CellAddress, valueToSet: string, revertValue: string) => {
      const key = `${cell.rowId}:${cell.colKey}`;

      const base = localRecordsRef.current.find((r) => r.id === cell.rowId);
      if (!base) return;

      // Optimistic update — show the new value in the grid right now.
      setLocalRecords((prev) =>
        prev.map((r) => (r.id === cell.rowId ? ({ ...r, [cell.colKey]: valueToSet } as WorkOrderRecord) : r))
      );
      setSaveStatus(key, "saving");

      const payload = toWorkOrderInput(base, cell.colKey, valueToSet);

      void (async () => {
        try {
          const saved = await updateWorkOrderMutation.mutateAsync({ id: cell.rowId, data: payload });
          // Overlay server truth (e.g. a reallocated TI number).
          setLocalRecords((prev) =>
            prev.map((r) => (r.id === cell.rowId ? { ...r, ...(saved as Partial<WorkOrderRecord>) } : r))
          );
          setSaveStatus(key, "saved");
          clearSaveStatusLater(key, 2000);
        } catch (err) {
          // Revert the optimistic update and surface the error.
          setLocalRecords((prev) =>
            prev.map((r) => (r.id === cell.rowId ? ({ ...r, [cell.colKey]: revertValue } as WorkOrderRecord) : r))
          );
          setSaveStatus(key, "error");
          clearSaveStatusLater(key, 4000);
          toast({
            variant: "destructive",
            title: "Could not save change",
            description: err instanceof Error ? err.message : String(err),
          });
        }
      })();
    },
    [clearSaveStatusLater, setSaveStatus, toast, updateWorkOrderMutation]
  );

  // A user-initiated edit: validate, record undo history, then persist.
  const commit = useCallback(
    (cell: CellAddress, newValue: string, oldValue: string) => {
      const key = `${cell.rowId}:${cell.colKey}`;

      // Skip save when nothing changed.
      if (newValue === oldValue) return;

      // Number validation for qty — reject clearly non-numeric input.
      if (cell.colKey === "qty" && newValue.trim() !== "" && !Number.isFinite(Number(newValue))) {
        toast({ variant: "destructive", title: "Invalid quantity", description: "Qty must be a number." });
        setSaveStatus(key, "error");
        clearSaveStatusLater(key, 1500);
        return;
      }

      undoStackRef.current.push({ rowId: cell.rowId, colKey: cell.colKey, oldValue, newValue });
      redoStackRef.current = []; // a fresh edit invalidates the redo branch
      persistCell(cell, newValue, oldValue);
    },
    [clearSaveStatusLater, persistCell, setSaveStatus, toast]
  );

  const undo = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    redoStackRef.current.push(entry);
    setSelectedCell({ rowId: entry.rowId, colKey: entry.colKey });
    persistCell({ rowId: entry.rowId, colKey: entry.colKey }, entry.oldValue, entry.newValue);
  }, [persistCell]);

  const redo = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    undoStackRef.current.push(entry);
    setSelectedCell({ rowId: entry.rowId, colKey: entry.colKey });
    persistCell({ rowId: entry.rowId, colKey: entry.colKey }, entry.newValue, entry.oldValue);
  }, [persistCell]);

  // Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) for undo/redo, but only in ready mode —
  // while editing, the browser's native text undo inside the input takes over.
  useEffect(() => {
    if (!open || !canEdit) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (editingCellRef.current) return; // editing a cell — leave undo to the input
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, canEdit, undo, redo]);

  // --- Selection movement ----------------------------------------------------
  const move = (from: CellAddress, deltaRow: number, deltaCol: number, wrap: boolean) => {
    const rows = filteredRecords;
    if (!rows.length) return;
    const cols = TABLE_COLUMNS.length;

    let rowIdx = rows.findIndex((r) => r.id === from.rowId);
    if (rowIdx === -1) rowIdx = 0;
    let colIdx = TABLE_COLUMNS.findIndex((c) => c.key === from.colKey);
    if (colIdx === -1) colIdx = 0;

    let nr = rowIdx;
    let nc = colIdx;

    if (wrap) {
      nc = colIdx + deltaCol;
      if (nc >= cols) {
        nc = 0;
        nr = rowIdx + 1;
      } else if (nc < 0) {
        nc = cols - 1;
        nr = rowIdx - 1;
      }
      if (nr < 0) {
        nr = 0;
        nc = 0;
      } else if (nr > rows.length - 1) {
        nr = rows.length - 1;
        nc = cols - 1;
      }
    } else {
      nr = clamp(rowIdx + deltaRow, 0, rows.length - 1);
      nc = clamp(colIdx + deltaCol, 0, cols - 1);
    }

    setSelectedCell({ rowId: rows[nr].id, colKey: TABLE_COLUMNS[nc].key });
  };

  // A TI-source cell is read-only once its linked TI is checked.
  const isCellTiLocked = (record: WorkOrderRecord, colKey: keyof WorkOrderRecord) =>
    TI_LOCKED_KEYS.has(colKey) &&
    labelStatusByTi.get(record.ti_no || "")?.approval_status === "checked";

  // --- Enter/leave edit mode -------------------------------------------------
  const beginEdit = (cell: CellAddress, mode: EntryMode, char?: string) => {
    if (!canEdit) return;
    const record = filteredRecords.find((r) => r.id === cell.rowId);
    if (!record) return;
    if (isCellTiLocked(record, cell.colKey)) {
      toast({
        title: "Field locked",
        description: `TI ${record.ti_no} is checked. Ask an admin to reopen (unlock) it before editing this field.`,
      });
      return;
    }
    const raw = getRawCellValue(record, cell.colKey);

    let value = raw;
    let selStart = raw.length;
    let selEnd = raw.length;
    if (mode === "overwrite") {
      value = char ?? "";
      selStart = 1;
      selEnd = 1;
    } else if (mode === "clear") {
      value = "";
      selStart = 0;
      selEnd = 0;
    }

    editInitRef.current = { value, selStart, selEnd };
    setSelectedCell(cell);
    setOriginalValue(raw);
    setEditingCell(cell);
  };

  const cancelEdit = () => {
    if (!editingCell) return;
    setEditingCell(null); // selectedCell stays; nothing saved
  };

  const confirmAndMove = (deltaRow: number, deltaCol: number, wrap: boolean) => {
    if (!editingCell) return;
    const cell = editingCell;
    const value = inputRef.current?.value ?? "";
    setEditingCell(null);
    commit(cell, value, originalValue);
    move(cell, deltaRow, deltaCol, wrap);
  };

  // Initialize the input value + caret/selection whenever a cell enters edit mode.
  useEffect(() => {
    if (!editingCell) return;
    const input = inputRef.current;
    if (!input) return;
    const init = editInitRef.current;
    input.value = init.value;
    input.focus();
    try {
      input.setSelectionRange(init.selStart, init.selEnd);
    } catch {
      // number/date inputs don't support setSelectionRange — ignore.
    }
  }, [editingCell]);

  // Scroll the selected cell into view and return keyboard focus to the grid.
  useEffect(() => {
    if (!selectedCell) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-cell-key="${selectedCell.rowId}:${selectedCell.colKey}"]`
    );
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (!editingCell) scrollRef.current?.focus({ preventScroll: true });
  }, [selectedCell, editingCell]);

  // --- Event handlers --------------------------------------------------------
  const handleGridKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit || editingCell || !selectedCell) return; // let Escape bubble to close modal
    const cell = selectedCell;
    const k = e.key;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };

    if (k === "ArrowUp") {
      stop();
      move(cell, -1, 0, false);
    } else if (k === "ArrowDown") {
      stop();
      move(cell, 1, 0, false);
    } else if (k === "ArrowLeft") {
      stop();
      move(cell, 0, -1, false);
    } else if (k === "ArrowRight") {
      stop();
      move(cell, 0, 1, false);
    } else if (k === "Tab") {
      stop();
      move(cell, 0, e.shiftKey ? -1 : 1, true);
    } else if (k === "Enter") {
      stop();
      move(cell, e.shiftKey ? -1 : 1, 0, false);
    } else if (k === "Home") {
      stop();
      setSelectedCell({ rowId: cell.rowId, colKey: TABLE_COLUMNS[0].key });
    } else if (k === "End") {
      stop();
      setSelectedCell({ rowId: cell.rowId, colKey: TABLE_COLUMNS[TABLE_COLUMNS.length - 1].key });
    } else if (k === "F2") {
      // Deliberate edit key (Excel-style). Editing is otherwise entered only by
      // double-click, so a stray keystroke on a selected cell never overwrites data.
      stop();
      beginEdit(cell, "preserve");
    } else if (k === "Escape") {
      stop();
      setSelectedCell(null);
    }
    // Any other key (printable chars, Delete, Backspace) is ignored in ready mode
    // so it cannot accidentally erase or overwrite the cell's value.
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const k = e.key;
    if (k === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      confirmAndMove(e.shiftKey ? -1 : 1, 0, false);
    } else if (k === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      confirmAndMove(0, e.shiftKey ? -1 : 1, true);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      confirmAndMove(-1, 0, false);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      confirmAndMove(1, 0, false);
    } else if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit();
    }
    // ArrowLeft/ArrowRight/Home/End and text keys fall through to the native input.
  };

  const handleEditBlur = () => {
    const cell = editingCell;
    if (!cell) return;
    const value = inputRef.current?.value ?? "";
    const orig = originalValue;
    // Defer so a mousedown on another cell (which confirms + reselects) runs first
    // and this doesn't double-commit.
    setTimeout(() => {
      const current = editingCellRef.current;
      if (current && current.rowId === cell.rowId && current.colKey === cell.colKey) {
        setEditingCell(null);
        commit(cell, value, orig);
        setSelectedCell(null);
      }
    }, 80);
  };

  const handleCellMouseDown = (
    e: React.MouseEvent<HTMLTableCellElement>,
    record: WorkOrderRecord,
    colKey: keyof WorkOrderRecord
  ) => {
    if (!canEdit || !EDITABLE_KEYS.has(colKey)) return;
    if ((e.target as HTMLElement).tagName === "INPUT") return; // interacting with the active input
    const cell: CellAddress = { rowId: record.id, colKey };

    if (editingCell) {
      if (editingCell.rowId === record.id && editingCell.colKey === colKey) return;
      // Clicking a different cell while editing: confirm current, select new.
      e.preventDefault();
      const value = inputRef.current?.value ?? "";
      const current = editingCell;
      setEditingCell(null);
      commit(current, value, originalValue);
      setSelectedCell(cell);
      return;
    }

    // A single click only ever selects — editing is entered exclusively by
    // double-click (or F2), so an accidental click/keystroke can't overwrite data.
    e.preventDefault();
    setSelectedCell(cell);
  };

  const handleRootMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || editingCell || !selectedCell) return; // blur handles the editing case
    const target = e.target as Node;
    if (scrollRef.current && !scrollRef.current.contains(target)) {
      setSelectedCell(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex h-screen w-screen flex-col overflow-hidden bg-white"
      onMouseDown={handleRootMouseDown}
    >
      {/* Full-screen Top Header Bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6 shadow-xs">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-8 gap-1.5 border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to Form
          </Button>

          <div className="h-4 w-px bg-gray-200" />

          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-gray-900 tracking-tight">Work Order Database</h1>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-[#2a4080] border border-blue-200/60">
              {filteredRecords.length} of {records.length} records
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {activeFilters.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetAllFilters}
              className="h-8 gap-1.5 border-amber-300 bg-amber-50 text-xs font-semibold text-amber-900 hover:bg-amber-100 hover:text-amber-950 shadow-2xs"
            >
              <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
              Reset All Filters ({activeFilters.length})
            </Button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            aria-label="Close search"
            title="Close (Esc)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Active Filters Chips Bar */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200 bg-slate-50/90 px-4 py-2 text-xs shrink-0">
          <span className="font-semibold text-gray-700 flex items-center gap-1 mr-1">
            <Filter className="h-3.5 w-3.5 text-[#2a4080]" />
            Active Filters ({activeFilters.length}):
          </span>
          {activeFilters.map(({ key, label, filter }) => {
            const hasText = Boolean(filter.textContains.trim());
            const selectedCount = filter.selectedValues.size;
            const totalCount = filter.allValues.length;

            let summary = "";
            if (hasText && selectedCount < totalCount) {
              summary = `text: "${filter.textContains}" + ${selectedCount}/${totalCount} values`;
            } else if (hasText) {
              summary = `contains "${filter.textContains}"`;
            } else if (selectedCount === 1) {
              summary = Array.from(filter.selectedValues)[0];
            } else {
              summary = `${selectedCount} of ${totalCount} values`;
            }

            return (
              <span
                key={key}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-xs text-blue-900 shadow-2xs"
              >
                <strong className="font-semibold">{label}:</strong>
                <span className="max-w-48 truncate text-gray-600" title={summary}>
                  {summary}
                </span>
                <button
                  type="button"
                  onClick={() => handleClearSingleFilter(key)}
                  className="ml-0.5 rounded p-0.5 text-gray-400 hover:bg-blue-50 hover:text-blue-700"
                  title={`Clear ${label} filter`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
          <button
            type="button"
            onClick={handleResetAllFilters}
            className="ml-2 text-xs font-semibold text-blue-700 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Full-screen Table Content Container */}
      <div
        ref={scrollRef}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        className="flex-1 overflow-auto bg-slate-50/20 outline-none"
      >
        {filteredRecords.length > 0 ? (
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-30 bg-[#2a4080] text-xs font-semibold uppercase tracking-wider text-white shadow-sm">
              <tr>
                <th className="sticky left-0 z-40 w-12 bg-[#2a4080] px-3 py-3 text-center font-bold text-white border-r border-white/10">
                  #
                </th>

                {TABLE_COLUMNS.map((col) => (
                  <React.Fragment key={col.key}>
                    <th
                      style={{ minWidth: col.minWidth }}
                      className="whitespace-nowrap px-3 py-2.5 font-semibold text-white/95 border-r border-white/10 last:border-r-0"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate">{col.label}</span>
                        <ExcelColumnFilterPopover
                          columnKey={col.key}
                          columnLabel={col.label}
                          records={records}
                          activeFilter={filters[col.key]}
                          onApply={(newFilter) => handleApplyColumnFilter(col.key, newFilter)}
                        />
                      </div>
                    </th>
                    {col.key === "sr_no" && (
                      <th
                        style={{ minWidth: "150px" }}
                        className="whitespace-nowrap px-3 py-2.5 font-semibold text-white/95 border-r border-white/10"
                      >
                        LABELS
                      </th>
                    )}
                  </React.Fragment>
                ))}

                <th className="sticky right-0 z-40 w-24 bg-[#2a4080] px-3 py-2.5 text-center font-bold text-white border-l border-white/10 shadow-sm">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredRecords.map((record, index) => (
                <tr key={record.id} className="hover:bg-blue-50/50 transition-colors group">
                  <td className="sticky left-0 z-10 w-12 bg-white group-hover:bg-blue-50/50 px-3 py-2.5 text-center font-mono text-[11px] text-gray-500 border-r border-gray-100">
                    {index + 1}
                  </td>

                  {TABLE_COLUMNS.map((col) => {
                    const raw = record[col.key];
                    const displayVal =
                      raw !== undefined && raw !== null && String(raw).trim() !== "" ? String(raw) : "-";
                    const isMono = col.isMono;
                    const isTi = col.key === "ti_no";
                    const isWorkOrder = col.key === "work_order";
                    const isQty = col.key === "qty";
                    const isSpec = col.key === "specification";

                    const isSelected =
                      selectedCell?.rowId === record.id && selectedCell?.colKey === col.key;
                    const isEditing =
                      editingCell?.rowId === record.id && editingCell?.colKey === col.key;
                    const saveStatus = cellSaveStatus.get(`${record.id}:${col.key}`);
                    const locked = canEdit && isCellTiLocked(record, col.key);

                    return (
                      <React.Fragment key={col.key}>
                      <td
                        data-cell-key={`${record.id}:${col.key}`}
                        onMouseDown={
                          canEdit ? (e) => handleCellMouseDown(e, record, col.key) : undefined
                        }
                        onDoubleClick={
                          canEdit
                            ? () => beginEdit({ rowId: record.id, colKey: col.key }, "preserve")
                            : undefined
                        }
                        style={{
                          position: "relative",
                          minWidth: col.minWidth,
                          maxWidth: isSpec ? "560px" : "340px",
                          outline: isEditing
                            ? "1px solid #1D9E75"
                            : isSelected
                              ? "1px solid #378ADD"
                              : undefined,
                          outlineOffset: isEditing || isSelected ? "-1px" : undefined,
                          zIndex: isEditing ? 2 : isSelected ? 1 : undefined,
                          cursor: canEdit ? (locked ? "not-allowed" : "cell") : undefined,
                        }}
                        className="border-r border-gray-100 p-0 text-xs"
                        title={locked ? `Locked — TI ${record.ti_no} is checked` : raw ? String(raw) : ""}
                      >
                        <div
                          className={cn(
                            "px-3 py-2.5",
                            isSpec ? "whitespace-normal break-words leading-snug" : "truncate",
                            isMono && "font-mono",
                            isTi && "font-semibold text-blue-900",
                            isWorkOrder && "font-medium text-gray-900",
                            isQty && "font-semibold text-center text-gray-800",
                            !isTi && !isWorkOrder && !isQty && "text-gray-700"
                          )}
                          style={{
                            display: isEditing ? "none" : "block",
                            background:
                              isSelected && !isEditing ? "rgba(55, 138, 221, 0.07)" : undefined,
                          }}
                        >
                          {displayVal}
                        </div>

                        {isEditing && (
                          <input
                            ref={inputRef}
                            type={getInputType(col.key)}
                            defaultValue={originalValue}
                            onKeyDown={handleEditKeyDown}
                            onBlur={handleEditBlur}
                            className={cn("text-xs text-gray-900", isMono && "font-mono")}
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              height: "100%",
                              border: "none",
                              background: "white",
                              fontSize: "inherit",
                              fontFamily: "inherit",
                              padding: "0 9px",
                              outline: "none",
                            }}
                          />
                        )}

                        {saveStatus && (
                          <span
                            style={{
                              position: "absolute",
                              top: 3,
                              right: 4,
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background:
                                saveStatus === "saving"
                                  ? "#EF9F27"
                                  : saveStatus === "saved"
                                    ? "#1D9E75"
                                    : "#E24B4A",
                              transition: "background 0.25s",
                              zIndex: 3,
                            }}
                          />
                        )}
                      </td>
                      {col.key === "sr_no" && (
                        <td
                          style={{ minWidth: "150px", maxWidth: "220px" }}
                          className="border-r border-gray-100 px-3 py-2.5 text-xs align-middle"
                          title={record.sr_no ? String(record.sr_no) : ""}
                        >
                          <LabelStatusBadge
                            progress={computeLabelProgress(
                              record.qty,
                              record.sr_no,
                              labelStatusByTi.get(record.ti_no || "")
                            )}
                          />
                        </td>
                      )}
                      </React.Fragment>
                    );
                  })}

                  <td className="sticky right-0 z-10 w-24 bg-white group-hover:bg-blue-50/50 px-3 py-2 text-center border-l border-gray-100 shadow-sm">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onSelect(record)}
                      className="h-7 px-3.5 bg-[#2a4080] hover:bg-[#1f3164] text-white text-xs font-medium"
                    >
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex h-full min-h-[50vh] flex-col items-center justify-center p-8 text-center">
            <div className="rounded-full bg-slate-100 p-4 text-[#2a4080] mb-3">
              {activeFilters.length > 0 ? <Filter className="h-7 w-7" /> : <Search className="h-7 w-7" />}
            </div>
            <h3 className="text-base font-semibold text-gray-900">
              {activeFilters.length > 0
                ? "No Work Orders match your current filters"
                : "No Work Orders found"}
            </h3>
            <p className="mt-1 text-xs text-gray-500 max-w-sm">
              {activeFilters.length > 0
                ? "Try loosening your column criteria or resetting filters to display saved records."
                : "Create and save a new Work Order to start populating this search table."}
            </p>
            {activeFilters.length > 0 && (
              <Button
                type="button"
                size="sm"
                onClick={handleResetAllFilters}
                className="mt-4 gap-1.5 bg-[#2a4080] hover:bg-[#1f3164] text-white text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset All Filters
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Full-screen Bottom Status Bar */}
      <footer className="flex h-8 shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 px-4 text-[11px] text-gray-500">
        <div>
          Showing {filteredRecords.length} of {records.length} records
          {activeFilters.length > 0 &&
            ` (${activeFilters.length} column filter${activeFilters.length === 1 ? "" : "s"} active)`}
        </div>
      </footer>
    </div>
  );
}

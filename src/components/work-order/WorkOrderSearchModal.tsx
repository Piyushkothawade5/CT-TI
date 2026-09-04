import React, { useMemo, useState, useEffect } from "react";
import { ArrowLeft, ChevronLeft, Filter, RotateCcw, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkOrderRecord } from "@/lib/work-orders";
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
  { key: "specification", label: "SPECIFICATION", minWidth: "280px" },
  { key: "qty", label: "QTY", minWidth: "85px", align: "center" },
  { key: "sr_no", label: "SR NO", minWidth: "160px", isMono: true },
  { key: "ti_no", label: "TI NO", minWidth: "140px", isMono: true },
  { key: "traceability_sr_no", label: "TRACEABILITY SR. NO.", minWidth: "185px", isMono: true },
];

interface WorkOrderSearchModalProps {
  open: boolean;
  records: WorkOrderRecord[];
  onClose: () => void;
  onSelect: (record: WorkOrderRecord) => void;
}

export function WorkOrderSearchModal({
  open,
  records,
  onClose,
  onSelect,
}: WorkOrderSearchModalProps) {
  const [filters, setFilters] = useState<ColumnFilters>({});

  // Close on Escape key when no popover has focus
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // If an open popover is handled by Radix, it will prevent default; otherwise close
        if (!event.defaultPrevented) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Multi-column filter logic: combining with AND logic
  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      for (const [colKey, filter] of Object.entries(filters)) {
        if (!filter) continue;

        const rawVal = record[colKey as keyof WorkOrderRecord];
        const normalizedVal = normalizeFieldValue(rawVal);

        // 1. Checkbox set match (must be in selected set)
        if (!filter.selectedValues.has(normalizedVal)) {
          return false;
        }

        // 2. Text contains match (case-insensitive substring)
        if (filter.textContains) {
          const textTarget = rawVal ? String(rawVal).toLowerCase() : "";
          if (!textTarget.includes(filter.textContains.toLowerCase())) {
            return false;
          }
        }
      }
      return true;
    });
  }, [records, filters]);

  // Count how many column filters are actively applied
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
      if (!filter) {
        delete next[key];
      } else {
        next[key] = filter;
      }
      return next;
    });
  };

  const handleResetAllFilters = () => {
    setFilters({});
  };

  const handleClearSingleFilter = (key: keyof WorkOrderRecord) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex h-screen w-screen flex-col overflow-hidden bg-white">
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
            <h1 className="text-base font-bold text-gray-900 tracking-tight">
              Work Order Database
            </h1>
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
      <div className="flex-1 overflow-auto bg-slate-50/20">
        {filteredRecords.length > 0 ? (
          <table className="min-w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#2a4080] text-xs font-semibold uppercase tracking-wider text-white shadow-sm">
              <tr>
                <th className="sticky left-0 z-20 w-12 bg-[#2a4080] px-3 py-3 text-center font-bold text-white border-r border-white/10">
                  #
                </th>

                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
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
                ))}

                <th className="sticky right-0 z-20 w-24 bg-[#2a4080] px-3 py-2.5 text-center font-bold text-white border-l border-white/10 shadow-sm">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredRecords.map((record, index) => (
                <tr
                  key={record.id}
                  className="hover:bg-blue-50/50 transition-colors group"
                >
                  <td className="sticky left-0 z-10 w-12 bg-white group-hover:bg-blue-50/50 px-3 py-2.5 text-center font-mono text-[11px] text-gray-500 border-r border-gray-100">
                    {index + 1}
                  </td>

                  {TABLE_COLUMNS.map((col) => {
                    const raw = record[col.key];
                    const displayVal = raw !== undefined && raw !== null && String(raw).trim() !== ""
                      ? String(raw)
                      : "-";
                    const isMono = col.isMono;
                    const isTi = col.key === "ti_no";
                    const isWorkOrder = col.key === "work_order";
                    const isQty = col.key === "qty";

                    return (
                      <td
                        key={col.key}
                        style={{ minWidth: col.minWidth }}
                        className={cn(
                          "px-3 py-2.5 text-xs border-r border-gray-100 max-w-[340px] truncate",
                          isMono && "font-mono",
                          isTi && "font-semibold text-blue-900",
                          isWorkOrder && "font-medium text-gray-900",
                          isQty && "font-semibold text-center text-gray-800",
                          !isTi && !isWorkOrder && !isQty && "text-gray-700"
                        )}
                        title={raw ? String(raw) : ""}
                      >
                        {displayVal}
                      </td>
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
              {activeFilters.length > 0 ? (
                <Filter className="h-7 w-7" />
              ) : (
                <Search className="h-7 w-7" />
              )}
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
          {activeFilters.length > 0 && ` (${activeFilters.length} column filter${activeFilters.length === 1 ? "" : "s"} active)`}
        </div>
        <div className="flex items-center gap-3">
          <span>Click <strong>Open</strong> to load record into form</span>
          <span>•</span>
          <span>Press <strong>Esc</strong> to return</span>
        </div>
      </footer>
    </div>
  );
}


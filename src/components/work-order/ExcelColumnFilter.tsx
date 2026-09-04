import React, { useMemo, useState, useEffect } from "react";
import { ChevronDown, Filter, Search, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WorkOrderRecord } from "@/lib/work-orders";

export const BLANKS_VALUE = "(Blanks)";

export interface ColumnFilterState {
  textContains: string;
  selectedValues: Set<string>;
  allValues: string[];
}

export type ColumnFilters = Record<string, ColumnFilterState | undefined>;

export function normalizeFieldValue(raw: unknown): string {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return BLANKS_VALUE;
  }
  return String(raw).trim();
}

export function isColumnFilterActive(
  filter?: ColumnFilterState,
  totalValuesCount: number = 0
): boolean {
  if (!filter) return false;
  const hasText = filter.textContains.trim().length > 0;
  const isSubset = filter.selectedValues.size < (totalValuesCount || filter.allValues.length);
  return hasText || isSubset;
}

export function getActiveFilterCount(
  filter?: ColumnFilterState,
  totalValuesCount: number = 0
): number {
  if (!filter) return 0;
  let count = 0;
  if (filter.textContains.trim().length > 0) count++;
  if (filter.selectedValues.size < (totalValuesCount || filter.allValues.length)) count++;
  return count;
}

interface ExcelColumnFilterPopoverProps {
  columnKey: keyof WorkOrderRecord;
  columnLabel: string;
  records: WorkOrderRecord[];
  activeFilter: ColumnFilterState | undefined;
  onApply: (filter: ColumnFilterState | undefined) => void;
}

export function ExcelColumnFilterPopover({
  columnKey,
  columnLabel,
  records,
  activeFilter,
  onApply,
}: ExcelColumnFilterPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Compute all unique values and their frequencies across the full dataset
  const valueStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const record of records) {
      const val = normalizeFieldValue(record[columnKey]);
      counts.set(val, (counts.get(val) || 0) + 1);
    }

    const values = Array.from(counts.keys()).sort((a, b) => {
      if (a === BLANKS_VALUE) return 1;
      if (b === BLANKS_VALUE) return -1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    });

    return { values, counts };
  }, [records, columnKey]);

  // Draft state inside popover
  const [draftText, setDraftText] = useState("");
  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [addSelectionToFilter, setAddSelectionToFilter] = useState(false);

  // Sync draft state when opening popover
  useEffect(() => {
    if (isOpen) {
      if (activeFilter) {
        setDraftText(activeFilter.textContains || "");
        setDraftSelected(new Set(activeFilter.selectedValues));
      } else {
        setDraftText("");
        setDraftSelected(new Set(valueStats.values)); // default: all selected
      }
      setSearchQuery("");
      setAddSelectionToFilter(false);
    }
  }, [isOpen, activeFilter, valueStats.values]);

  const activeCount = getActiveFilterCount(activeFilter, valueStats.values.length);
  const isFilterActive = activeCount > 0;

  // Filter values based on search query
  const visibleValues = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return valueStats.values;
    return valueStats.values.filter((v) => v.toLowerCase().includes(q));
  }, [valueStats.values, searchQuery]);

  // Tri-state master checkbox calculation against visible values
  const visibleCheckedCount = useMemo(() => {
    let count = 0;
    for (const v of visibleValues) {
      if (draftSelected.has(v)) count++;
    }
    return count;
  }, [visibleValues, draftSelected]);

  const isAllVisibleChecked = visibleValues.length > 0 && visibleCheckedCount === visibleValues.length;
  const isNoneVisibleChecked = visibleCheckedCount === 0;
  const isIndeterminate = !isAllVisibleChecked && !isNoneVisibleChecked;

  const masterCheckedState: boolean | "indeterminate" = isAllVisibleChecked
    ? true
    : isIndeterminate
    ? "indeterminate"
    : false;

  const masterLabel = searchQuery.trim()
    ? "(Select All Search Results)"
    : "(Select All)";

  // Handle user typing into search box
  const handleSearchChange = (newQuery: string) => {
    setSearchQuery(newQuery);
    const q = newQuery.trim().toLowerCase();
    if (q) {
      // In Excel, typing a search query checks all matching search results by default
      const matching = valueStats.values.filter((v) => v.toLowerCase().includes(q));
      setDraftSelected((prev) => {
        const next = new Set(prev);
        for (const m of matching) {
          next.add(m);
        }
        return next;
      });
    }
  };

  // Master checkbox click handler
  const handleToggleMaster = () => {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (isAllVisibleChecked) {
        // Uncheck all currently visible search results
        for (const v of visibleValues) {
          next.delete(v);
        }
      } else {
        // Check all currently visible search results
        for (const v of visibleValues) {
          next.add(v);
        }
      }
      return next;
    });
  };

  // Toggle individual value
  const handleToggleValue = (val: string) => {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(val)) {
        next.delete(val);
      } else {
        next.add(val);
      }
      return next;
    });
  };

  // Quick "Only" action on hover
  const handleSelectOnly = (val: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftSelected(new Set([val]));
  };

  // Quick Select All All
  const handleSelectAll = () => {
    setDraftSelected(new Set(valueStats.values));
  };

  // Quick Clear All
  const handleClearAllDraft = () => {
    setDraftSelected(new Set());
  };

  // Apply filter
  const handleApply = () => {
    const trimmedText = draftText.trim();
    const trimmedSearch = searchQuery.trim();
    let finalSelected: Set<string>;

    // If the user performed an active search query:
    if (trimmedSearch) {
      // Visible values that are currently checked
      const checkedVisible = visibleValues.filter((v) => draftSelected.has(v));

      if (addSelectionToFilter && activeFilter) {
        // Union previously active filter with checked search results
        finalSelected = new Set([...activeFilter.selectedValues, ...checkedVisible]);
      } else {
        // Excel standard: apply filter ONLY to the checked visible search results!
        finalSelected = new Set(checkedVisible);
      }
    } else {
      finalSelected = new Set(draftSelected);
    }

    const allAreSelected = finalSelected.size === valueStats.values.length;

    if (allAreSelected && !trimmedText) {
      onApply(undefined);
    } else {
      onApply({
        textContains: trimmedText,
        selectedValues: finalSelected,
        allValues: valueStats.values,
      });
    }
    setIsOpen(false);
  };

  // Clear this column's filter
  const handleClear = () => {
    onApply(undefined);
    setIsOpen(false);
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "ml-1.5 inline-flex items-center justify-center rounded p-1 transition-all",
            isFilterActive
              ? "bg-amber-400 text-gray-950 font-bold shadow-sm ring-1 ring-amber-500 hover:bg-amber-300"
              : "text-white/70 hover:bg-white/20 hover:text-white"
          )}
          title={isFilterActive ? `${columnLabel}: ${activeCount} filter(s) active` : `Filter ${columnLabel}`}
          aria-label={`Filter ${columnLabel}`}
        >
          {isFilterActive ? (
            <Filter className="h-3 w-3 fill-current" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="z-[250] w-80 rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-900">
              {columnLabel}
            </span>
          </div>
          {isFilterActive && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-[#2a4080]">
              {activeCount} active
            </span>
          )}
        </div>

        {/* TEXT CONTAINS Section */}
        <div className="mb-3">
          <label
            htmlFor={`text-contains-${columnKey}`}
            className="block text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-1"
          >
            Text Contains
          </label>
          <div className="relative">
            <Input
              id={`text-contains-${columnKey}`}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Type to match this column..."
              className="h-8 text-xs pr-7 border-gray-300 bg-white focus-visible:ring-[#2a4080]"
            />
            {draftText && (
              <button
                type="button"
                onClick={() => setDraftText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Clear text filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* VALUES Section */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                Values
              </span>
              <span className="text-[10px] text-gray-400">
                ({draftSelected.size} of {valueStats.values.length} selected)
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-[#2a4080] hover:underline font-medium"
              >
                All
              </button>
              <span className="text-gray-300">•</span>
              <button
                type="button"
                onClick={handleClearAllDraft}
                className="text-gray-500 hover:text-gray-800 hover:underline"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Search values input */}
          <div className="relative mb-1.5">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
            <Input
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleApply();
                }
              }}
              placeholder="Search values..."
              className="h-8 text-xs pl-8 pr-7 border-gray-300 bg-white focus-visible:ring-[#2a4080]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Excel's "Add current selection to filter" checkbox when searching */}
          {searchQuery.trim() && (
            <div className="flex items-center gap-2 px-1 py-1 mb-1 text-[11px] text-gray-600 bg-gray-50 rounded">
              <Checkbox
                id={`add-selection-${columnKey}`}
                checked={addSelectionToFilter}
                onCheckedChange={(checked) => setAddSelectionToFilter(Boolean(checked))}
                className="h-3.5 w-3.5"
              />
              <label
                htmlFor={`add-selection-${columnKey}`}
                className="cursor-pointer select-none text-[11px] text-gray-600"
              >
                Add current selection to filter
              </label>
            </div>
          )}

          {/* Scrollable list of values */}
          <div className="max-h-52 overflow-y-auto rounded border border-gray-200 bg-white p-1 space-y-0.5">
            {/* Master Checkbox */}
            <div
              onClick={handleToggleMaster}
              className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-gray-100 cursor-pointer select-none font-medium text-gray-800"
            >
              <div className="flex items-center gap-2 overflow-hidden">
                <Checkbox
                  checked={masterCheckedState}
                  onCheckedChange={handleToggleMaster}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate text-xs font-semibold text-gray-800">
                  {masterLabel}
                </span>
              </div>
            </div>

            {/* Value Items */}
            {visibleValues.length > 0 ? (
              visibleValues.map((val) => {
                const isChecked = draftSelected.has(val);
                const count = valueStats.counts.get(val) || 0;
                const isBlank = val === BLANKS_VALUE;

                return (
                  <div
                    key={val}
                    onClick={() => handleToggleValue(val)}
                    className="group flex items-center justify-between rounded px-2 py-1 hover:bg-gray-100 cursor-pointer select-none"
                  >
                    <div className="flex items-center gap-2 overflow-hidden mr-2">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => handleToggleValue(val)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-3.5 w-3.5 shrink-0"
                      />
                      <span
                        className={cn(
                          "truncate text-xs text-gray-700",
                          isBlank && "italic text-gray-500 font-medium"
                        )}
                        title={val}
                      >
                        {val}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => handleSelectOnly(val, e)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-blue-600 hover:text-blue-800 hover:underline font-medium transition-opacity"
                        title="Select only this value"
                      >
                        only
                      </button>
                      <span className="text-[10px] font-mono text-gray-400">
                        {count}
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="py-4 text-center text-xs text-gray-400">
                No matching values found
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-3 flex items-center justify-end gap-2 border-t border-gray-100 pt-2.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 px-3 text-xs text-gray-600 hover:bg-gray-100"
          >
            × Clear
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            className="h-7 px-4 bg-[#2a4080] hover:bg-[#1f3164] text-white text-xs font-medium"
          >
            OK
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

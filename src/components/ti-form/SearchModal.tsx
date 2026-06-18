import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useDistinctCtTypes, useListTiRecords } from "@/api-client";
import { CalendarDays, Download, Eye, Pencil, RotateCcw, Search } from "lucide-react";
import { downloadTiPdf } from "@/components/ti-form/downloadTiPdf";
import { useToast } from "@/hooks/use-toast";
import { formatDisplayDate, parseDisplayDate } from "@/lib/date-format";

const EMPTY_FILTERS = {
  tiNo: "",
  itemNo: "",
  customer: "",
  woNo: "",
  cusOrderNo: "",
  ctType: "",
  dateFrom: "",
  dateTo: "",
};

type SearchFilters = typeof EMPTY_FILTERS;

export function SearchModal({
  open,
  onOpenChange,
  onSelect,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (tiNo: string) => void;
  onEdit?: (tiNo: string) => void;
}) {
  const { toast } = useToast();
  const [draftFilters, setDraftFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const { data: distinctCtTypes = [] } = useDistinctCtTypes();
  const { data, isFetching } = useListTiRecords(appliedFilters, {
    query: { enabled: open },
  });

  const updateFilter = (key: keyof SearchFilters, value: string) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  };

  const clearSearch = () => {
    setDraftFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  const runSearch = () => {
    setAppliedFilters({ ...draftFilters });
  };

  const handlePdf = async (record: any) => {
    try {
      await downloadTiPdf(record);
    } catch (error) {
      toast({ variant: "destructive", title: "PDF failed", description: String(error) });
    }
  };

  const records = data?.records || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl h-[88vh] flex flex-col p-0 overflow-hidden border-gray-200 shadow-2xl">
        <DialogHeader className="px-7 py-5 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-[#eef4ff] text-[#2a4080] flex items-center justify-center">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <DialogTitle className="text-xl text-[#20366f]">Search Technical Instructions</DialogTitle>
              <p className="text-sm text-gray-500 mt-0.5">Find records using one or more filters.</p>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
          className="px-7 py-5 bg-[#f7f9fc] border-b border-gray-200"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-4">
            <SearchField label="TI Number" value={draftFilters.tiNo} placeholder="e.g. LTCT-26-27-0529"
              onChange={(value) => updateFilter("tiNo", value)} />
            <SearchField label="Item Number" value={draftFilters.itemNo} placeholder="e.g. 38612051"
              onChange={(value) => updateFilter("itemNo", value)} />
            <SearchField label="Customer Name" value={draftFilters.customer}
              onChange={(value) => updateFilter("customer", value)} />
            <SearchField label="W.O. Number" value={draftFilters.woNo}
              onChange={(value) => updateFilter("woNo", value)} />
            <SearchField label="Customer Order No." value={draftFilters.cusOrderNo}
              onChange={(value) => updateFilter("cusOrderNo", value)} />
            <div className="space-y-1.5">
              <Label className="text-xs uppercase text-gray-500">CT Type</Label>
              <select
                value={draftFilters.ctType}
                onChange={(event) => updateFilter("ctType", event.target.value)}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none transition-shadow focus:border-[#4a6fa5] focus:ring-2 focus:ring-[#4a6fa5]/15"
              >
                <option value="">All</option>
                {distinctCtTypes.map((ctType) => <option key={ctType} value={ctType}>{ctType}</option>)}
              </select>
            </div>
            <DateSearchField label="Date From" value={draftFilters.dateFrom}
              onChange={(value) => updateFilter("dateFrom", value)} />
            <DateSearchField label="Date To" value={draftFilters.dateTo}
              onChange={(value) => updateFilter("dateTo", value)} />
          </div>

          <div className="flex items-center gap-2.5 mt-5">
            <Button type="submit" className="h-10 px-5 bg-[#365b9d] hover:bg-[#294a84] shadow-sm">
              <Search className="w-4 h-4 mr-2" /> Search
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={clearSearch}
              className="h-10 px-4 text-gray-600 hover:text-[#2a4080] hover:bg-[#e9eef7]"
            >
              <RotateCcw className="w-4 h-4 mr-2" /> Reset
            </Button>
            <span className="ml-auto inline-flex items-center h-8 px-3 rounded-md bg-white border border-gray-200 text-sm font-medium text-gray-600 shadow-sm">
              {isFetching ? "Searching..." : `${records.length} record(s) found`}
            </span>
          </div>
        </form>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-white">
          <table className="w-full table-fixed text-sm text-left">
            <thead className="bg-[#456da8] text-white sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="w-[15%] px-3 py-3 font-semibold">TI No</th>
                <th className="w-[10%] px-3 py-3 font-semibold">Date</th>
                <th className="w-[10%] px-3 py-3 font-semibold">Item No</th>
                <th className="w-[17%] px-3 py-3 font-semibold">Customer</th>
                <th className="w-[15%] px-3 py-3 font-semibold">WO No</th>
                <th className="w-[8%] px-3 py-3 font-semibold">Qty</th>
                <th className="w-[25%] px-3 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {records.map((record) => (
                <tr key={record.id} className="odd:bg-white even:bg-gray-50/40 hover:bg-[#eef4ff] transition-colors">
                  <td className="px-3 py-3 font-semibold text-[#2a4080] truncate" title={record.ti_no}>{record.ti_no}</td>
                  <td className="px-3 py-3 truncate">{formatDate(record.ti_date)}</td>
                  <td className="px-3 py-3 truncate" title={record.item_no || ""}>{record.item_no || "-"}</td>
                  <td className="px-3 py-3 truncate" title={record.customer_name || ""}>{record.customer_name || "-"}</td>
                  <td className="px-3 py-3 truncate" title={record.wo_number || ""}>{record.wo_number || "-"}</td>
                  <td className="px-3 py-3 truncate" title={record.quantity || ""}>{record.quantity || "-"}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      <ActionButton icon={<Eye />} label="View" onClick={() => onSelect(record.ti_no)} tone="blue" />
                      {onEdit && <ActionButton icon={<Pencil />} label="Edit" onClick={() => onEdit(record.ti_no)} tone="green" />}
                      <ActionButton icon={<Download />} label="PDF" onClick={() => handlePdf(record)} tone="purple" />
                    </div>
                  </td>
                </tr>
              ))}
              {!isFetching && records.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-14 text-center text-gray-500">No records found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-[#fafbfc]">
          <p className="text-xs text-gray-500">Results are ordered by TI number, newest first.</p>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-9 px-4 text-gray-700 hover:bg-gray-200/70"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SearchField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase text-gray-500">{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 bg-white border-gray-300 shadow-sm focus-visible:ring-2 focus-visible:ring-[#4a6fa5]/20 focus-visible:border-[#4a6fa5]"
      />
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  tone,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone: "blue" | "green" | "purple";
}) {
  const tones = {
    blue: "border-blue-200 text-blue-700 bg-blue-50/50 hover:bg-blue-100",
    green: "border-emerald-200 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100",
    purple: "border-violet-200 text-violet-700 bg-violet-50/50 hover:bg-violet-100",
  };
  return (
    <button type="button" onClick={onClick}
      className={`h-8 px-2 inline-flex items-center gap-1 border rounded-md text-xs font-medium whitespace-nowrap ${tones[tone]}`}>
      <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
      {label}
    </button>
  );
}

function DateSearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [displayValue, setDisplayValue] = useState(formatDisplayDate(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayValue(formatDisplayDate(value));
  }, [value]);

  const commit = () => {
    const parsed = parseDisplayDate(displayValue);
    if (parsed !== null) {
      onChange(parsed);
      setDisplayValue(formatDisplayDate(parsed));
    } else {
      setDisplayValue(formatDisplayDate(value));
    }
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase text-gray-500">{label}</Label>
      <div className="relative">
        <Input
          value={displayValue}
          placeholder="DD-MMM-YYYY"
          onChange={(event) => {
            const nextDisplayValue = event.target.value;
            setDisplayValue(nextDisplayValue);
            const parsed = parseDisplayDate(nextDisplayValue);
            if (parsed !== null) onChange(parsed);
          }}
          onBlur={commit}
          className="h-10 pr-9 bg-white border-gray-300 shadow-sm focus-visible:ring-2 focus-visible:ring-[#4a6fa5]/20 focus-visible:border-[#4a6fa5]"
        />
        <button
          type="button"
          title="Choose date"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const picker = pickerRef.current;
            if (!picker) return;
            if (typeof picker.showPicker === "function") picker.showPicker();
            else picker.click();
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-[#2a4080]"
        >
          <CalendarDays className="w-4 h-4" />
        </button>
        <input
          ref={pickerRef}
          type="date"
          value={value}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            onChange(event.target.value);
            setDisplayValue(formatDisplayDate(event.target.value));
          }}
          className="absolute right-1 top-1/2 w-1 h-1 opacity-0 pointer-events-none"
        />
      </div>
    </div>
  );
}

function formatDate(value?: string | null): string {
  return formatDisplayDate(value) || "-";
}

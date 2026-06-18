import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useForm, Controller } from "react-hook-form";
import { useCreateItem, useDistinctCtTypes, useUpdateItem } from "@/api-client";
import type { ItemInput } from "@/api-client";
import { useToast } from "@/hooks/use-toast";

const CORE_FIELDS = [
  { label: "RATIO",                  key: "ratio" },
  { label: "Burden (VA)",            key: "burden_va" },
  { label: "Accuracy Class",         key: "accuracy_class" },
  { label: "ISF",                    key: "isf" },
  { label: "Min. Knee pt. volt.",    key: "min_knee_pt_volt" },
  { label: "Max. Rct @ 75°c",        key: "max_rct_75c" },
  { label: "Max. Exc. C/n",          key: "max_exc_vk2", isCheckboxVK2: true },
  { label: "Core Dimensions (bare)", key: "bare_core_dim" },
  { label: "Core Material",          key: "core_material" },
  { label: "Core weight (Kg)",       key: "core_weight_kg" },
  { label: "Sec. Total Turns",       key: "sec_total_turns" },
  { label: "Sec. Ter. Marking",      key: "sec_ter_marking" },
  { label: "Sec. Conductor (S1-S2)", key: "sec_cond_s1s2" },
  { label: "Sec. Turns (S1-S2)",     key: "sec_turns_s1s2" },
  { label: "Sec. Conductor (S2-S3)", key: "sec_cond_s2s3" },
  { label: "Sec. Turns (S2-S3)",     key: "sec_turns_s2s3" },
  { label: "Sec. Conductor (S3-S4)", key: "sec_cond_s3s4" },
  { label: "Sec. Turns (S3-S4)",     key: "sec_turns_s3s4" },
  { label: "Sec. Conductor (S4-S5)", key: "sec_cond_s4s5" },
  { label: "Sec. Turns (S4-S5)",     key: "sec_turns_s4s5" },
  { label: "Sec. Copper weight (kg)", key: "sec_copper_wt" },
  { label: "Finished Core Dim.",     key: "finished_core_dim" },
  { label: "Sec Connection",         key: "sec_connection" },
  { label: "Wire Length",            key: "wire_length" },
  { label: "Wire Colour",            key: "wire_colour" },
];

export function AddItemModal({ open, onOpenChange, itemNo, itemData, mode = "create", onSuccess }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemNo: string;
  itemData?: ItemInput | null;
  mode?: "create" | "edit";
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const createItemMutation = useCreateItem();
  const updateItemMutation = useUpdateItem();
  const { data: distinctCtTypes = [] } = useDistinctCtTypes();
  const isEditMode = mode === "edit";

  // Clean item number: pure numeric (remove spaces, commas, dots)
  const cleanedItemNo = React.useMemo(
    () => itemNo.replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, ""),
    [itemNo]
  );

  const form = useForm<ItemInput>({ defaultValues: { item_no: cleanedItemNo } });

  React.useEffect(() => {
    if (!open) return;
    form.reset(isEditMode && itemData ? { ...itemData, item_no: cleanedItemNo } : { item_no: cleanedItemNo });
  }, [form, cleanedItemNo, itemData, isEditMode, open]);

  const handleSave = async () => {
    try {
      if (isEditMode) {
        await updateItemMutation.mutateAsync({ itemNo: cleanedItemNo, data: form.getValues() });
        toast({ title: "Item updated successfully", className: "bg-green-50 border-green-200 text-green-800" });
      } else {
        await createItemMutation.mutateAsync({ data: form.getValues() });
        toast({ title: "Item added successfully", className: "bg-green-50 border-green-200 text-green-800" });
      }
      onSuccess();
    } catch {
      toast({ variant: "destructive", title: isEditMode ? "Failed to update item" : "Failed to add item" });
    }
  };

  // CT Type autocomplete state
  const [ctTypeOpen, setCtTypeOpen] = React.useState(false);
  const [ctQuery, setCtQuery] = React.useState("");
  const [ctActiveIndex, setCtActiveIndex] = React.useState(-1);
  const ctRef = React.useRef<HTMLDivElement>(null);
  const lastCoreColumnRef = React.useRef("2");
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ctRef.current && !ctRef.current.contains(e.target as Node)) setCtTypeOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const filteredCtTypes = distinctCtTypes.filter(t => !ctQuery || t.toLowerCase().includes(ctQuery.toLowerCase()));
  React.useEffect(() => {
    setCtActiveIndex(filteredCtTypes.length ? 0 : -1);
  }, [ctQuery, ctTypeOpen, filteredCtTypes.length]);
  React.useEffect(() => {
    ctRef.current
      ?.querySelector<HTMLElement>(`[data-dropdown-index="${ctActiveIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [ctActiveIndex]);

  const handleEnterNavigation = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "Tab" && target.getAttribute("data-field") === "ct_final_dim" && e.shiftKey) {
      e.preventDefault();
      const lastCoreField = document.querySelector<HTMLElement>(
        `#add-item-form [data-grid-row="${CORE_FIELDS.length - 1}"][data-grid-col="${lastCoreColumnRef.current}"]`
      );
      lastCoreField?.focus();
      lastCoreField?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (e.key !== "Enter" && e.key !== "Tab") return;
    if (e.key === "Enter" && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey)) return;
    if (target.tagName.toLowerCase() === "textarea") return;
    if (!target.matches('input:not([type="checkbox"]), select')) return;

    const gridRow = target.getAttribute("data-grid-row");
    const gridCol = target.getAttribute("data-grid-col");
    if (gridRow !== null && gridCol !== null) {
      lastCoreColumnRef.current = gridCol;
      e.preventDefault();
      const nextGridField = document.querySelector<HTMLElement>(
        `#add-item-form [data-grid-row="${Number(gridRow) + (e.shiftKey ? -1 : 1)}"][data-grid-col="${gridCol}"]`
      );
      const nextField =
        nextGridField && nextGridField.offsetParent !== null
          ? nextGridField
          : e.shiftKey
            ? null
            : document.querySelector<HTMLElement>('#add-item-form [data-field="ct_final_dim"]');
      if (nextField) {
        nextField.focus();
        nextField.scrollIntoView({ block: "center", behavior: "smooth" });
      } else if (e.shiftKey) {
        const fields = Array.from(
          document.querySelectorAll<HTMLElement>(
            '#add-item-form input:not([disabled]):not([type="checkbox"]), #add-item-form textarea:not([disabled]), #add-item-form select:not([disabled])'
          )
        ).filter((field) => field.offsetParent !== null);
        const currentIndex = fields.indexOf(target);
        fields[currentIndex - 1]?.focus();
        fields[currentIndex - 1]?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
    }

    if (e.key === "Tab") return;

    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#add-item-form input:not([disabled]):not([type="checkbox"]), #add-item-form textarea:not([disabled]), #add-item-form select:not([disabled])'
      )
    ).filter((field) => field.offsetParent !== null);
    const currentIndex = fields.indexOf(target);
    if (currentIndex < 0 || currentIndex >= fields.length - 1) return;

    e.preventDefault();
    fields[currentIndex + 1].focus();
    fields[currentIndex + 1].scrollIntoView({ block: "center", behavior: "smooth" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b">
          <DialogTitle className="text-xl text-[#2a4080]">{isEditMode ? "Edit Item" : "Add New Item"}</DialogTitle>
          <DialogDescription>
            {isEditMode ? "Update item master details for" : "Item No."} <span className="font-bold text-gray-900">{cleanedItemNo}</span>{isEditMode ? "." : " does not exist. Fill in details below."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
          <div id="add-item-form" onKeyDown={handleEnterNavigation} className="space-y-8 pb-6">

            <section>
              <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm mb-4 border-l-4 border-[#4a6fa5] pl-3">BASIC DETAILS</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-gray-500">Item No</Label>
                  <Input disabled value={cleanedItemNo} className="bg-gray-100" />
                </div>

                {/* CT Type — autocomplete from history */}
                <div className="space-y-1 relative" ref={ctRef}>
                  <Label className="text-xs uppercase text-gray-500">CT Type</Label>
                  <Controller name="ct_type" control={form.control} render={({ field }) => (
                    <Input {...field} value={field.value || ""} autoComplete="off"
                      className="h-9 bg-white"
                      placeholder={distinctCtTypes.length ? "Type or select..." : "Type CT type..."}
                      onFocus={() => setCtTypeOpen(true)}
                      onBlur={() => setTimeout(() => setCtTypeOpen(false), 100)}
                      onChange={e => { field.onChange(e.target.value); setCtQuery(e.target.value); setCtTypeOpen(true); }}
                      onKeyDown={e => {
                        if (e.key === "ArrowDown" && filteredCtTypes.length) {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtTypeOpen(true);
                          setCtActiveIndex(index => index < filteredCtTypes.length - 1 ? index + 1 : 0);
                        } else if (e.key === "ArrowUp" && filteredCtTypes.length) {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtTypeOpen(true);
                          setCtActiveIndex(index => index > 0 ? index - 1 : filteredCtTypes.length - 1);
                        } else if (e.key === "Enter" && ctTypeOpen && ctActiveIndex >= 0 && filteredCtTypes[ctActiveIndex]) {
                          e.preventDefault();
                          form.setValue("ct_type", filteredCtTypes[ctActiveIndex]);
                          setCtQuery(filteredCtTypes[ctActiveIndex]);
                          setCtTypeOpen(false);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtTypeOpen(false);
                        }
                      }}
                    />
                  )} />
                  {ctTypeOpen && filteredCtTypes.length > 0 && (
                    <ul className="absolute z-50 mt-0.5 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-40 overflow-y-auto text-sm">
                      {filteredCtTypes.map((opt, index) => (
                        <li key={opt}
                          data-dropdown-index={index}
                          onMouseDown={e => { e.preventDefault(); form.setValue("ct_type", opt); setCtQuery(opt); setCtTypeOpen(false); }}
                          onMouseEnter={() => setCtActiveIndex(index)}
                          className={`px-3 py-1.5 cursor-pointer ${
                            index === ctActiveIndex ? "bg-[#4a6fa5] text-white" : "hover:bg-[#4a6fa5]/10"
                          }`}>
                          {opt}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs uppercase text-gray-500">Cust. Part Code</Label>
                  <Controller name="cust_part_code" control={form.control} render={({ field }) => (
                    <Input {...field} value={field.value || ""} className="bg-white" />
                  )} />
                </div>
                {[
                  { label: "Ratio", key: "ratio" }, { label: "Rated Voltage", key: "rated_voltage" },
                  { label: "STC", key: "stc" }, { label: "Insulation Level", key: "insulation_level" },
                  { label: "Frequency", key: "frequency" }, { label: "Ref. Std.", key: "ref_std" },
                ].map(f => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs uppercase text-gray-500">{f.label}</Label>
                    <Controller name={f.key as any} control={form.control} render={({ field }) => (
                      <Input {...field} value={field.value || ""} className="bg-white" />
                    )} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm mb-4 border-l-4 border-[#4a6fa5] pl-3">CORE PARTICULARS</h3>
              <div className="overflow-x-auto border border-[#dee2e6] rounded-md bg-white">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-white uppercase bg-[#4a6fa5]">
                    <tr>
                      <th className="px-4 py-2 border-r border-[#dee2e6]/20 w-1/4">Particulars</th>
                      <th className="px-4 py-2 border-r border-[#dee2e6]/20">Core 1</th>
                      <th className="px-4 py-2 border-r border-[#dee2e6]/20">Core 2</th>
                      <th className="px-4 py-2">Core 3</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CORE_FIELDS.map((row, idx) => (
                      <tr key={idx} className="border-b border-[#dee2e6] hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-1 font-medium text-gray-900 border-r border-[#dee2e6] bg-gray-50/50">{row.label}</td>
                        {[0, 1, 2].map(col => (
                          <td key={col} className={`p-0${col < 2 ? " border-r border-[#dee2e6]" : ""}`}>
                            {row.isCheckboxVK2 ? (
                              <VK2CheckboxCell
                                form={form}
                                mainName={`core${col + 1}.${row.key}`}
                                checkboxName={`core${col + 1}.max_exc_is_vk2`}
                                gridRow={idx}
                                gridCol={col}
                              />
                            ) : (
                              <Controller name={`core${col + 1}.${row.key}` as any} control={form.control} render={({ field }) => (
                                <Input {...field} value={field.value || ""} data-grid-row={idx} data-grid-col={col}
                                  className="border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] bg-transparent px-3" />
                              )} />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm mb-4 border-l-4 border-[#4a6fa5] pl-3">ADDITIONAL DETAILS</h3>
              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: "CT Final Dim", key: "ct_final_dim", dataField: "ct_final_dim" },
                  { label: "GA Drg", key: "ga_drg" }, { label: "INS Class", key: "ins_class" },
                  { label: "Ref TI", key: "ref_ti" }, { label: "PRI Turns", key: "pri_turns" },
                  { label: "PRI Copper", key: "pri_copper" }, { label: "Former", key: "former" },
                  { label: "PRI Length", key: "pri_length" }, { label: "PRI Weight", key: "pri_weight" },
                  { label: "Sec. Terminal", key: "sec_terminal" }, { label: "Total Weight", key: "total_weight" },
                ].map(field => (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-xs uppercase text-gray-500">{field.label}</Label>
                    <Controller name={field.key as any} control={form.control} render={({ field: f }) => (
                      <Input {...f} value={f.value || ""} data-field={(field as any).dataField} className="bg-white" />
                    )} />
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="flex justify-end space-x-3 p-4 border-t bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} className="bg-[#2a4080] hover:bg-[#1a2850]">
            {isEditMode ? "Update Item" : "Save Item"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VK2CheckboxCell({ form, mainName, checkboxName, gridRow, gridCol }: {
  form: any; mainName: string; checkboxName: string; gridRow?: number; gridCol?: number;
}) {
  const mainValue = form.watch(mainName);
  const hasValue = !!(mainValue && String(mainValue).trim());

  return (
    <div className="flex flex-col">
      <Controller name={mainName as any} control={form.control} render={({ field }) => (
        <Input {...field} value={field.value || ""} data-grid-row={gridRow} data-grid-col={gridCol}
          className="border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] bg-transparent px-3" />
      )} />
      {hasValue && (
        <Controller name={checkboxName as any} control={form.control} render={({ field }) => {
          const checked = field.value === "true" || field.value === true;
          return (
            <label className="flex items-center gap-1.5 px-3 py-[3px] border-t border-gray-100 cursor-pointer select-none hover:bg-blue-50/50">
              <input type="checkbox" checked={checked}
                onChange={e => field.onChange(e.target.checked ? "true" : "")}
                className="w-3 h-3 accent-[#4a6fa5]" />
              <span className="text-[10px] text-gray-500 italic font-medium">@VK/2</span>
            </label>
          );
        }} />
      )}
    </div>
  );
}

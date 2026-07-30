import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useForm, Controller } from "react-hook-form";
import { findHistoricalDrawingDimensions, useCreateItem, useDistinctCtTypes, useUpdateItem } from "@/api-client";
import type { ItemInput } from "@/api-client";
import { useToast } from "@/hooks/use-toast";
import { calculateCoreFromDimensions, calculateTapTurns, expandRatioByCore, formatCoreWeight } from "@/lib/core-calculations";
import { calculateSecondaryCopperWeight, formatSecondaryCopperWeight } from "@/lib/secondary-copper-calculations";
import { DrawingFieldExtractor } from "@/components/ti-form/DrawingFieldExtractor";
import { parseDrawingItemFields } from "@/lib/drawing-field-parser";
import { uploadDrawingFile } from "@/lib/drawing-upload";
import { normalizeItemTiFormat, type ItemTiFormat } from "@/lib/item-ti-compatibility";
import { FileUp, PanelRightClose, PanelRightOpen } from "lucide-react";

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
  onSuccess: (item: ItemInput) => void;
}) {
  const { toast } = useToast();
  const createItemMutation = useCreateItem();
  const updateItemMutation = useUpdateItem();
  const { data: distinctCtTypes = [] } = useDistinctCtTypes();
  const isEditMode = mode === "edit";
  const [isUploadingDrawing, setIsUploadingDrawing] = React.useState(false);
  const isSavingItem = createItemMutation.isPending || updateItemMutation.isPending || isUploadingDrawing;

  // Clean item number: pure numeric (remove spaces, commas, dots)
  const cleanedItemNo = React.useMemo(
    () => itemNo.replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, ""),
    [itemNo]
  );

  const form = useForm<ItemInput>({ defaultValues: { item_no: cleanedItemNo, ti_format: "standard" } });
  const autoFilledValuesRef = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    if (!open) return;
    autoFilledValuesRef.current.clear();
    form.reset(
      isEditMode && itemData
        ? { ...itemData, item_no: cleanedItemNo, ti_format: normalizeItemTiFormat(itemData.ti_format) }
        : { item_no: cleanedItemNo, ti_format: "standard" }
    );
  }, [form, cleanedItemNo, itemData, isEditMode, open]);

  const handleSave = async (itemTiFormat?: ItemTiFormat) => {
    if (isSavingItem) return;
    const resolvedItemTiFormat =
      itemTiFormat === "standard" || itemTiFormat === "non_standard"
        ? itemTiFormat
        : normalizeItemTiFormat(form.getValues("ti_format"));
    let payload: ItemInput = { ...form.getValues(), ti_format: resolvedItemTiFormat };
    try {
      let savedItem: ItemInput;
      if (drawingFile) {
        setIsUploadingDrawing(true);
        const uploadResult = await uploadDrawingFile(drawingFile, cleanedItemNo);
        payload = { ...payload, ...uploadResult };
      }
      if (isEditMode) {
        savedItem = await updateItemMutation.mutateAsync({ itemNo: cleanedItemNo, data: payload });
        toast({ title: "Item updated successfully", className: "bg-green-50 border-green-200 text-green-800" });
      } else {
        savedItem = await createItemMutation.mutateAsync({ data: payload });
        toast({
          title: resolvedItemTiFormat === "non_standard" ? "Non-standard item added" : "Item added successfully",
          description:
            resolvedItemTiFormat === "non_standard"
              ? "This item can be used in Work Orders but will be blocked in the standard TI screen."
              : undefined,
          className: "bg-green-50 border-green-200 text-green-800",
        });
      }
      onSuccess(savedItem);
    } catch (error) {
      toast({
        variant: "destructive",
        title: isEditMode ? "Failed to update item" : "Failed to add item",
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsUploadingDrawing(false);
    }
  };

  // CT Type autocomplete state
  const [ctTypeOpen, setCtTypeOpen] = React.useState(false);
  const [ctQuery, setCtQuery] = React.useState("");
  const [ctActiveIndex, setCtActiveIndex] = React.useState(-1);
  const ctRef = React.useRef<HTMLDivElement>(null);
  const lastCoreColumnRef = React.useRef("2");
  const drawingInputRef = React.useRef<HTMLInputElement>(null);
  const [drawingFile, setDrawingFile] = React.useState<File | null>(null);
  const [isDrawingPanelOpen, setIsDrawingPanelOpen] = React.useState(false);
  const [activeField, setActiveField] = React.useState<{ name: string; label: string } | null>(null);
  React.useEffect(() => {
    if (open) {
      setDrawingFile(null);
      setIsDrawingPanelOpen(false);
    }
  }, [cleanedItemNo, isEditMode, open]);
  const handleDrawingAutoText = React.useCallback(async (text: string) => {
    if (isEditMode) return 0;
    const parsed = parseDrawingItemFields(text);
    delete parsed.ct_final_dim;
    const historical = await findHistoricalDrawingDimensions(drawingFile?.name || "", text);
    if (historical.dimensions.length === 1) parsed.ct_final_dim = historical.dimensions[0];
    const previousAutoValues = autoFilledValuesRef.current;
    const nextAutoValues = new Map<string, string>();
    let filled = 0;
    const setRecognized = (name: string, value: unknown) => {
      if (!value) return;
      const recognizedValue = String(value).trim();
      const currentValue = String(form.getValues(name as any) || "").trim();
      const priorAutoValue = previousAutoValues.get(name);
      if (currentValue && currentValue !== priorAutoValue) return;
      form.setValue(name as any, recognizedValue, { shouldDirty: true });
      nextAutoValues.set(name, recognizedValue);
      filled += 1;
    };

    Object.entries(parsed).forEach(([key, value]) => {
      if (key.startsWith("core") && value && typeof value === "object") {
        Object.entries(value).forEach(([coreField, coreValue]) => setRecognized(`${key}.${coreField}`, coreValue));
      } else {
        setRecognized(key, value);
      }
    });

    const ratio = String(parsed.ratio || "").trim();
    if (ratio) {
      expandRatioByCore(ratio).forEach((coreRatio, index) => {
        const coreKey = `core${index + 1}`;
        setRecognized(`${coreKey}.ratio`, coreRatio);
        applyTapTurnCalculation(form, coreKey, form.getValues(`${coreKey}.ratio` as any), form.getValues("pri_turns"));
      });
    }
    (["core1", "core2", "core3"] as const).forEach((coreKey) => {
      const dimensions = form.getValues(`${coreKey}.bare_core_dim` as any);
      const calculation = calculateCoreFromDimensions(dimensions);
      if (calculation) setRecognized(`${coreKey}.core_weight_kg`, formatCoreWeight(calculation.weightKg));
      applySecondaryCopperWeightCalculation(form, coreKey, setRecognized);
    });

    previousAutoValues.forEach((priorValue, name) => {
      if (nextAutoValues.has(name)) return;
      if (String(form.getValues(name as any) || "").trim() === priorValue) {
        form.setValue(name as any, "", { shouldDirty: true });
      }
    });
    autoFilledValuesRef.current = nextAutoValues;

    toast({
      title: filled ? `${filled} field${filled === 1 ? "" : "s"} filled from drawing` : "Drawing attached",
      description: historical.dimensions.length === 1
        ? `CT dimensions confirmed from ${historical.matchedItems} historical item${historical.matchedItems === 1 ? "" : "s"}.`
        : historical.dimensions.length > 1
          ? "Multiple historical dimensions match this drawing; CT Final Dim was left blank."
          : filled
            ? "Please review the recognized values before saving. CT dimensions require confirmation."
            : "No reliable historical dimension match was found.",
    });
    return filled;
  }, [drawingFile?.name, form, isEditMode, toast]);
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

  const handleFieldFocus = (event: React.FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!target.name || target.type === "checkbox" || target.type === "hidden") return;
    const gridRow = target.getAttribute("data-grid-row");
    const gridCol = target.getAttribute("data-grid-col");
    if (gridRow !== null && gridCol !== null) {
      const row = CORE_FIELDS[Number(gridRow)];
      setActiveField({ name: target.name, label: `${row?.label || target.name} - Core ${Number(gridCol) + 1}` });
      return;
    }
    const label = target.closest("div")?.querySelector("label")?.textContent?.trim() || target.name;
    setActiveField({ name: target.name, label });
  };

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
      <DialogContent className={`${!isEditMode && drawingFile && isDrawingPanelOpen ? "max-w-[96vw] w-[96vw]" : "max-w-5xl"} h-[92vh] flex flex-col p-0 overflow-hidden`}>
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-start gap-4 pr-8">
            <div className="mr-auto">
              <DialogTitle className="text-xl text-[#2a4080]">{isEditMode ? "Edit Item" : "Add New Item"}</DialogTitle>
              <DialogDescription>
                {isEditMode ? "Update item master details for" : "Item No."} <span className="font-bold text-gray-900">{cleanedItemNo}</span>{isEditMode ? "." : " does not exist. Fill in details below."}
              </DialogDescription>
            </div>
            <>
              <input
                ref={drawingInputRef}
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    setDrawingFile(file);
                    if (!isEditMode) setIsDrawingPanelOpen(true);
                  }
                  event.target.value = "";
                }}
              />
              <div className="flex flex-col items-end gap-1">
                <Button type="button" variant="outline" onClick={() => drawingInputRef.current?.click()} className="border-[#4a6fa5] text-[#2a4080]">
                  <FileUp className="w-4 h-4 mr-2" /> {drawingFile ? "Change Drawing" : isEditMode && itemData?.drawing_url ? "Change Drawing" : "Attach Drawing"}
                </Button>
                {isEditMode && (drawingFile || itemData?.drawing_file_name || itemData?.drawing_url) && (
                  <span className="max-w-56 truncate text-xs text-gray-500" title={drawingFile?.name || itemData?.drawing_file_name || itemData?.drawing_url || ""}>
                    {drawingFile ? drawingFile.name : itemData?.drawing_file_name || "Drawing saved"}
                  </span>
                )}
              </div>
            </>
            {!isEditMode && drawingFile && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsDrawingPanelOpen((visible) => !visible)}
                title={isDrawingPanelOpen ? "Hide drawing panel" : "Show drawing panel"}
              >
                {isDrawingPanelOpen
                  ? <PanelRightClose className="w-4 h-4" />
                  : <PanelRightOpen className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 min-h-0 flex">
          <div className={`${!isEditMode && drawingFile && isDrawingPanelOpen ? "w-1/2" : "w-full"} overflow-y-auto p-6 bg-gray-50/50`}>
          <div id="add-item-form" onFocusCapture={handleFieldFocus} onKeyDown={handleEnterNavigation} className="space-y-8 pb-6">

            <section>
              <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm mb-4 border-l-4 border-[#4a6fa5] pl-3">BASIC DETAILS</h3>
              <div className="grid grid-cols-4 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs uppercase text-gray-500">Item No</Label>
                  <Input disabled value={cleanedItemNo} className="bg-gray-100" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs uppercase text-gray-500">TI Format</Label>
                  <Controller
                    name="ti_format"
                    control={form.control}
                    render={({ field }) => (
                      <select
                        value={normalizeItemTiFormat(field.value)}
                        onChange={(event) => field.onChange(event.target.value)}
                        className="h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm outline-none"
                      >
                        <option value="standard">Standard TI Format</option>
                        <option value="non_standard">Non-Standard TI Format</option>
                      </select>
                    )}
                  />
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
                      <Input {...field} value={field.value || ""}
                        onChange={(event) => {
                          field.onChange(event);
                          if (f.key !== "ratio") return;
                          expandRatioByCore(event.target.value).forEach((coreRatio, index) => {
                            const coreKey = `core${index + 1}`;
                            form.setValue(`${coreKey}.ratio` as any, coreRatio, { shouldDirty: true });
                            applyTapTurnCalculation(
                              form,
                              coreKey,
                              coreRatio,
                              form.getValues("pri_turns")
                            );
                          });
                        }}
                        className="bg-white" />
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
                                <Input {...field} value={field.value || ""}
                                  onChange={(event) => {
                                    field.onChange(event);
                                    if (row.key === "ratio") {
                                      applyTapTurnCalculation(
                                        form,
                                        `core${col + 1}`,
                                        event.target.value,
                                        form.getValues("pri_turns")
                                      );
                                    }
                                    if (row.key === "bare_core_dim") {
                                      const result = calculateCoreFromDimensions(event.target.value);
                                      if (result) {
                                        form.setValue(
                                          `core${col + 1}.core_weight_kg` as any,
                                          formatCoreWeight(result.weightKg),
                                          { shouldDirty: true }
                                        );
                                      }
                                    }
                                    if (SECONDARY_COPPER_INPUT_FIELDS.has(row.key)) {
                                      applySecondaryCopperWeightCalculation(form, `core${col + 1}`);
                                    }
                                  }}
                                  data-grid-row={idx} data-grid-col={col}
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
                      <Input {...f} value={f.value || ""} data-field={(field as any).dataField}
                        onChange={(event) => {
                          f.onChange(event);
                          if (field.key !== "pri_turns") return;
                          (["core1", "core2", "core3"] as const).forEach((coreKey) => {
                            applyTapTurnCalculation(
                              form,
                              coreKey,
                              form.getValues(`${coreKey}.ratio` as any),
                              event.target.value
                            );
                          });
                        }}
                        className="bg-white" />
                    )} />
                  </div>
                ))}
              </div>
            </section>
          </div>
          </div>
          {!isEditMode && drawingFile && isDrawingPanelOpen && (
            <div className="w-1/2 min-w-0 border-l border-gray-300">
              <DrawingFieldExtractor
                file={drawingFile}
                activeFieldLabel={activeField?.label || ""}
                onAutoText={handleDrawingAutoText}
                onClose={() => setIsDrawingPanelOpen(false)}
                onApply={(text) => {
                  if (!activeField) return;
                  form.setValue(activeField.name as any, text, { shouldDirty: true, shouldTouch: true });
                }}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-3 p-4 border-t bg-white">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={() => handleSave()}
            disabled={isSavingItem}
            className="bg-[#2a4080] hover:bg-[#1a2850]"
          >
            {isUploadingDrawing ? "Uploading Drawing..." : isEditMode ? "Update Item" : "Save Item"}
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

function applyTapTurnCalculation(form: any, coreKey: string, ratio: string, primaryTurns?: string) {
  const result = calculateTapTurns(ratio, primaryTurns);
  if (!result) return;

  const expandedRatios = expandRatioByCore(form.getValues("ratio"));
  const coreIndex = Number(coreKey.replace("core", "")) - 1;
  const populatedCoreCount = ["core1", "core2", "core3"].filter(
    (key) => String(form.getValues(`${key}.ratio` as any) || "").trim()
  ).length;
  const isMultiCore = expandedRatios.length > 1 || populatedCoreCount > 1;
  const terminalPrefix = isMultiCore
    ? String(coreIndex + 1)
    : "";

  form.setValue(`${coreKey}.sec_total_turns` as any, String(result.totalTurns), { shouldDirty: true });
  form.setValue(
    `${coreKey}.sec_ter_marking` as any,
    Array.from(
      { length: result.segmentTurns.length + 1 },
      (_, index) => `${terminalPrefix}S${index + 1}`
    ).join("-"),
    { shouldDirty: true }
  );
  ["sec_turns_s1s2", "sec_turns_s2s3", "sec_turns_s3s4", "sec_turns_s4s5"].forEach((field, index) => {
    form.setValue(
      `${coreKey}.${field}` as any,
      result.segmentTurns[index] !== undefined ? String(result.segmentTurns[index]) : "",
      { shouldDirty: true }
    );
  });
  applySecondaryCopperWeightCalculation(form, coreKey);
}

const SECONDARY_COPPER_INPUT_FIELDS = new Set([
  "bare_core_dim",
  "sec_total_turns",
  "sec_cond_s1s2",
  "sec_turns_s1s2",
  "sec_cond_s2s3",
  "sec_turns_s2s3",
  "sec_cond_s3s4",
  "sec_turns_s3s4",
  "sec_cond_s4s5",
  "sec_turns_s4s5",
]);

function applySecondaryCopperWeightCalculation(
  form: any,
  coreKey: string,
  setValue?: (name: string, value: unknown) => void
) {
  const get = (field: string) => form.getValues(`${coreKey}.${field}` as any);
  const result = calculateSecondaryCopperWeight({
    bareCoreDimensions: get("bare_core_dim"),
    totalTurns: get("sec_total_turns"),
    segments: [
      { conductor: get("sec_cond_s1s2"), turns: get("sec_turns_s1s2") },
      { conductor: get("sec_cond_s2s3"), turns: get("sec_turns_s2s3") },
      { conductor: get("sec_cond_s3s4"), turns: get("sec_turns_s3s4") },
      { conductor: get("sec_cond_s4s5"), turns: get("sec_turns_s4s5") },
    ],
  });
  if (!result) return;

  const fieldName = `${coreKey}.sec_copper_wt`;
  const formatted = formatSecondaryCopperWeight(result.weightKg);
  if (setValue) {
    setValue(fieldName, formatted);
  } else {
    form.setValue(fieldName as any, formatted, { shouldDirty: true });
  }
}

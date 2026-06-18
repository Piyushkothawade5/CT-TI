import React, { useState, useEffect, useRef } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import {
  Save, FilePlus, Search, ChevronLeft, ChevronRight, Edit3, Printer, FileText, Settings, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useGetItem, useGetTiRecord, useGenerateTiNumber, useGetAdjacentTiRecords,
  useUpdateTiRecord, useCreateTiRecord, getGetItemQueryKey, getGetTiRecordQueryKey,
  useDistinctTiValues, useDistinctCtTypes, getCustomerForItemAsync,
} from "@/api-client";
import type { TiRecordInput, CoreData } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { SearchModal } from "@/components/ti-form/SearchModal";
import { AddItemModal } from "@/components/ti-form/AddItemModal";
import { downloadTiPdf, printTiPdf } from "@/components/ti-form/downloadTiPdf";

// ── Signature persistence key (survives page reload / login) ──────────────────
const SIG_STORAGE_KEY = "ct_ti_signatures";

function loadSavedSignatures(): { approved_by: string; checked_by: string; created_by: string } {
  try {
    return JSON.parse(localStorage.getItem(SIG_STORAGE_KEY) || "{}");
  } catch {
    return { approved_by: "", checked_by: "", created_by: "" };
  }
}
function saveSignatures(sigs: { approved_by: string; checked_by: string; created_by: string }) {
  localStorage.setItem(SIG_STORAGE_KEY, JSON.stringify(sigs));
}

// ── Core table config ─────────────────────────────────────────────────────────
const SEPARATOR_AFTER_IDX = 6;

const CORE_FIELDS: Array<{ label: string; key: string; isCheckboxVK2?: boolean }> = [
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

// Required field indicator
const REQ = <span className="text-red-500 ml-0.5">*</span>;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function Home({ onLogout }: { onLogout: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Signatures — loaded from localStorage on mount, persist across logins
  const stickyRef = useRef(loadSavedSignatures());

  const [draftTiNo, setDraftTiNo] = useState("");
  const [currentTiNo, setCurrentTiNo] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isNewMode, setIsNewMode] = useState(true);
  const [itemNoInput, setItemNoInput] = useState("");
  const [activeItemNo, setActiveItemNo] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const pendingItemFocusRef = useRef<string | null>(null);
  const lastCoreColumnRef = useRef("2");

  // Debounced TI number for duplicate checking
  const [debouncedTiNo, setDebouncedTiNo] = useState("");
  useEffect(() => {
    if (!isNewMode || !draftTiNo) { setDebouncedTiNo(""); return; }
    const t = setTimeout(() => setDebouncedTiNo(draftTiNo), 400);
    return () => clearTimeout(t);
  }, [draftTiNo, isNewMode]);

  // ── Distinct value hooks for dropdowns ──────────────────────────────────────
  const { data: distinctCustomers = [] } = useDistinctTiValues("customer_name");
  const { data: distinctCtTypes = [] } = useDistinctCtTypes();

  // ── Data Fetching ─────────────────────────────────────────────────────────
  const { data: itemData, isError: isItemError } = useGetItem(activeItemNo, {
    query: { enabled: !!activeItemNo, retry: false },
  });
  const { data: tiRecordData } = useGetTiRecord(currentTiNo || "", {
    query: { enabled: !!currentTiNo, retry: false },
  });
  const navigationTiNo = currentTiNo || draftTiNo;
  const { data: adjacentData } = useGetAdjacentTiRecords(navigationTiNo, {
    query: { enabled: !!navigationTiNo },
  });
  const { data: duplicateTiData } = useGetTiRecord(debouncedTiNo, {
    query: { enabled: !!debouncedTiNo && isNewMode, retry: false },
  });
  const isDuplicateTiNo = !!duplicateTiData;

  const generateTiMutation = useGenerateTiNumber();
  const createTiMutation = useCreateTiRecord();
  const updateTiMutation = useUpdateTiRecord();

  const form = useForm<TiRecordInput>({
    defaultValues: {
      ti_date: new Date().toISOString().split("T")[0],
      item_no: "",
      approved_by: stickyRef.current.approved_by || "",
      checked_by: stickyRef.current.checked_by || "",
      created_by: stickyRef.current.created_by || "",
    },
  });

  // Auto-generate TI number on first mount
  useEffect(() => {
    generateTiMutation.mutateAsync({}).then(r => setDraftTiNo(r.ti_no)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When item loads — populate fields + auto-fill customer from history
  useEffect(() => {
    let cancelled = false;
    if (itemData && (isNewMode || isEditMode)) {
      getCustomerForItemAsync(itemData.item_no).catch(() => "").then((historicCustomer) => {
        if (cancelled) return;
        toast({ title: "Item loaded", className: "bg-green-50 border-green-200 text-green-800" });
        const current = form.getValues();
        form.reset({
          ...current,
          item_no: itemData.item_no,
          ct_type: itemData.ct_type,
          cust_part_code: itemData.cust_part_code,
          ratio: itemData.ratio,
          rated_voltage: itemData.rated_voltage,
          stc: itemData.stc,
          insulation_level: itemData.insulation_level,
          frequency: itemData.frequency,
          ref_std: itemData.ref_std,
          core1: itemData.core1 || {},
          core2: itemData.core2 || {},
          core3: itemData.core3 || {},
          ct_final_dim: itemData.ct_final_dim,
          ga_drg: itemData.ga_drg,
          ins_class: itemData.ins_class,
          pri_turns: itemData.pri_turns,
          pri_copper: itemData.pri_copper,
          former: itemData.former,
          pri_length: itemData.pri_length,
          pri_weight: itemData.pri_weight,
          sec_terminal: itemData.sec_terminal,
          total_weight: itemData.total_weight,
          ref_ti: itemData.ref_ti,
          // Pre-fill customer if found, but user can override
          customer_name: historicCustomer || current.customer_name || "",
        });
        if (pendingItemFocusRef.current) {
          const nextField = pendingItemFocusRef.current;
          pendingItemFocusRef.current = null;
          focusFieldByName(nextField);
        }
      });
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemData]);

  useEffect(() => {
    if (isItemError && activeItemNo) {
      setItemModalMode("create");
      setIsAddItemModalOpen(true);
    }
  }, [isItemError, activeItemNo]);

  useEffect(() => {
    if (tiRecordData) {
      setIsNewMode(false);
      setIsEditMode(false);
      setItemNoInput(tiRecordData.item_no || "");
      setActiveItemNo(tiRecordData.item_no || "");
      form.reset(tiRecordData);
      const sigs = {
        approved_by: tiRecordData.approved_by || "",
        checked_by: tiRecordData.checked_by || "",
        created_by: tiRecordData.created_by || "",
      };
      stickyRef.current = sigs;
      saveSignatures(sigs);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiRecordData]);

  const handleItemSearch = (nextFocusName?: string) => {
    if (!itemNoInput.trim()) return;
    pendingItemFocusRef.current = nextFocusName || null;
    // Clean item number: pure numeric
    const cleaned = itemNoInput.replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, "");
    setItemNoInput(cleaned);
    form.setValue("item_no", cleaned);
    setActiveItemNo(cleaned);
  };

  const handleItemNoKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    handleItemSearch("customer_name");
  };

  // Form is always visually enabled — no grey overlay after save
  const isFormEnabled = !!activeItemNo && !isItemError && (isNewMode || isEditMode);

  // ── Validation ─────────────────────────────────────────────────────────────
  const REQUIRED_FIELDS: Array<{ name: keyof TiRecordInput; label: string }> = [
    { name: "customer_name",   label: "Customer Name" },
    { name: "cus_order_no",    label: "Customer Order No." },
    { name: "cus_order_date",  label: "Customer Order Date" },
    { name: "wo_number",       label: "W.O. Number" },
    { name: "po_item_no",      label: "PO Item No." },
    { name: "quantity",        label: "Quantity" },
  ];

  const validateRequired = (data: TiRecordInput): boolean => {
    const errors: Record<string, string> = {};
    for (const f of REQUIRED_FIELDS) {
      if (!data[f.name] || String(data[f.name]).trim() === "") {
        errors[f.name] = `${f.label} is required`;
      }
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleNew = async () => {
    setCurrentTiNo(null);
    setDraftTiNo("");
    setIsNewMode(true);
    setIsEditMode(true);
    setItemNoInput("");
    setActiveItemNo("");
    setFormErrors({});
    const sigs = stickyRef.current;
    form.reset({
      ti_date: new Date().toISOString().split("T")[0],
      item_no: "",
      approved_by: sigs.approved_by,
      checked_by: sigs.checked_by,
      created_by: sigs.created_by,
    });
    try {
      const r = await generateTiMutation.mutateAsync({});
      setDraftTiNo(r.ti_no);
    } catch {
      setDraftTiNo("");
    }
  };

  const handleEdit = () => {
    if (currentTiNo) setIsEditMode(true);
  };

  const handleEditItem = () => {
    if (!activeItemNo || !itemData) return;
    setItemModalMode("edit");
    setIsAddItemModalOpen(true);
  };

  const handleSave = async () => {
    if (!isFormEnabled) return;
    if (isDuplicateTiNo) {
      toast({ variant: "destructive", title: "TI number already exists", description: `${draftTiNo} is already in use.` });
      return;
    }
    const data = form.getValues();
    if (!data.item_no) {
      toast({ variant: "destructive", title: "Item number is required" });
      return;
    }
    if (!validateRequired(data)) {
      toast({ variant: "destructive", title: "Please fill all required fields", description: "Fields marked with * are mandatory." });
      return;
    }
    try {
      const sigs = {
        approved_by: data.approved_by || "",
        checked_by: data.checked_by || "",
        created_by: data.created_by || "",
      };
      if (isNewMode) {
        const res = await createTiMutation.mutateAsync({ data: { ...data, ti_no: draftTiNo || undefined } });
        setCurrentTiNo(res.ti_no);
        setDraftTiNo("");
        setIsNewMode(false);
        setIsEditMode(false);
        stickyRef.current = sigs;
        saveSignatures(sigs);
        toast({ title: "Record saved successfully" });
      } else if (currentTiNo) {
        await updateTiMutation.mutateAsync({ tiNo: currentTiNo, data });
        setIsEditMode(false);
        stickyRef.current = sigs;
        saveSignatures(sigs);
        toast({ title: "Record updated successfully" });
      }
      setFormErrors({});
    } catch {
      toast({ variant: "destructive", title: "Error saving record" });
    }
  };

  const handlePrev = () => {
    if (adjacentData?.prev) setCurrentTiNo(adjacentData.prev);
    else toast({ title: "No previous record" });
  };
  const handleNext = () => {
    if (adjacentData?.next) setCurrentTiNo(adjacentData.next);
    else toast({ title: "No next record" });
  };

  const handleDownloadPdf = async () => {
    try { await downloadTiPdf({ ...form.getValues(), ti_no: currentTiNo || draftTiNo || "" }); }
    catch (err) { toast({ title: "PDF failed", description: String(err), variant: "destructive" }); }
  };
  const handlePrintPdf = async () => {
    try { await printTiPdf({ ...form.getValues(), ti_no: currentTiNo || draftTiNo || "" }); }
    catch (err) { toast({ title: "PDF failed", description: String(err), variant: "destructive" }); }
  };

  const revealIfNeeded = (element: HTMLElement | null) => {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const topComfort = 120;
    const bottomComfort = window.innerHeight - 140;
    if (rect.top < topComfort || rect.bottom > bottomComfort) {
      element.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
  };

  const focusAndReveal = (element: HTMLElement | null) => {
    if (!element) return;
    element.focus({ preventScroll: true });
    requestAnimationFrame(() => revealIfNeeded(element));
  };

  const focusFieldByName = (name: string) => {
    requestAnimationFrame(() => {
      const field = document.querySelector<HTMLElement>(`#ti-form [name="${name}"]`);
      focusAndReveal(field);
    });
  };

  const focusNextFormField = (current: HTMLElement, backwards = false) => {
    const gridRow = current.getAttribute("data-grid-row");
    const gridCol = current.getAttribute("data-grid-col");
    if (gridRow !== null && gridCol !== null) {
      lastCoreColumnRef.current = gridCol;
      const nextGridField = document.querySelector<HTMLElement>(
        `#ti-form [data-grid-row="${Number(gridRow) + (backwards ? -1 : 1)}"][data-grid-col="${gridCol}"]`
      );
      if (nextGridField && nextGridField.offsetParent !== null && !nextGridField.hasAttribute("disabled")) {
        focusAndReveal(nextGridField);
        return;
      }

      if (!backwards) {
        const nextSectionField = document.querySelector<HTMLElement>(
          '#ti-form [data-field="ct_final_dim"]'
        );
        focusAndReveal(nextSectionField);
        return;
      }
    }

    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(
        '#ti-form input:not([disabled]):not([type="checkbox"]), #ti-form textarea:not([disabled]), #ti-form select:not([disabled])'
      )
    ).filter((field) => field.offsetParent !== null);
    const currentIndex = fields.indexOf(current);
    const nextIndex = currentIndex + (backwards ? -1 : 1);
    if (currentIndex >= 0 && nextIndex >= 0 && nextIndex < fields.length) {
      focusAndReveal(fields[nextIndex]);
    }
  };

  const handleFormKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "Tab" && target.getAttribute("data-field") === "ct_final_dim" && e.shiftKey) {
      e.preventDefault();
      const lastCoreField = document.querySelector<HTMLElement>(
        `#ti-form [data-grid-row="${CORE_FIELDS.length - 1}"][data-grid-col="${lastCoreColumnRef.current}"]`
      );
      focusAndReveal(lastCoreField);
      return;
    }
    if (e.key === "Tab" && target.hasAttribute("data-grid-row")) {
      e.preventDefault();
      focusNextFormField(target, e.shiftKey);
      return;
    }
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (target.tagName.toLowerCase() === "textarea") return;
    if (!target.matches('input:not([type="checkbox"]), select')) return;
    e.preventDefault();
    focusNextFormField(target);
  };

  const handleFormFocus = (e: React.FocusEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const tag = target.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && tag !== "select") return;
    requestAnimationFrame(() => revealIfNeeded(target));
  };

  // ── Arrow-key navigation ────────────────────────────────────────────────────
  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="w-[60px] bg-[#2a4080] flex flex-col items-center py-4 space-y-4 no-print shrink-0 fixed h-full z-10">
        <SidebarButton icon={<Save />}         title="Save"   onClick={handleSave}   disabled={!isFormEnabled} />
        <SidebarButton icon={<FilePlus />}     title="New"    onClick={handleNew} />
        <SidebarButton icon={<Search />}       title="Search" onClick={() => setIsSearchModalOpen(true)} />
        <SidebarButton icon={<ChevronLeft />}  title="Prev"   onClick={handlePrev} />
        <SidebarButton icon={<ChevronRight />} title="Next"   onClick={handleNext} />
        <SidebarButton icon={<Edit3 />}        title="Edit"   onClick={handleEdit} disabled={!currentTiNo || isEditMode} />
        <SidebarButton icon={<Printer />}      title="Print"  onClick={handlePrintPdf} />
        <SidebarButton icon={<FileText />}     title="PDF"    onClick={handleDownloadPdf} />
        <div className="flex-1" />
        <SidebarButton icon={<LogOut />}        title="Role"   onClick={onLogout} />
      </div>

      {/* Main */}
      <div id="ti-form" onFocusCapture={handleFormFocus} onKeyDown={handleFormKeyDown} className="ml-[60px] flex-1 p-6 flex justify-center">
        <div className="w-full max-w-5xl bg-white shadow-lg border border-gray-200">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#3b5fc0] to-[#6b8dd6] p-6 text-white flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-[#3b5fc0] shadow"><Settings /></div>
              <div>
                <h1 className="text-xl font-bold tracking-wider">TECHNICAL INSTRUCTION</h1>
                <h2 className="text-sm font-medium text-blue-100">CURRENT TRANSFORMER</h2>
              </div>
            </div>
            <div className="text-right space-y-2">
              <div className={`flex items-center space-x-2 px-3 py-1 rounded ${isDuplicateTiNo ? "bg-red-500/80" : "bg-white/20"}`}>
                <span className="text-sm font-semibold whitespace-nowrap">TI No:</span>
                {isNewMode ? (
                  <input type="text" value={draftTiNo} onChange={e => setDraftTiNo(e.target.value)}
                    placeholder="Auto-generating..."
                    className="font-mono font-bold tracking-wider bg-transparent border-b border-white/60 outline-none text-white placeholder:text-white/50 w-44 text-right" />
                ) : (
                  <span className="font-mono font-bold tracking-wider">{currentTiNo || "—"}</span>
                )}
              </div>
              {isDuplicateTiNo && <p className="text-xs text-red-200 font-medium text-right pr-1">⚠ TI number already exists</p>}
              <div className="flex items-center space-x-2 justify-end">
                <span className="text-sm font-semibold">TI DATE:</span>
                <Controller name="ti_date" control={form.control} render={({ field }) => (
                  <input type="date" disabled={!isEditMode && !isNewMode} {...field}
                    className="bg-transparent border border-white/30 rounded px-2 py-1 text-sm outline-none text-white disabled:opacity-80" />
                )} />
              </div>
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-8">
            {/* Item Number */}
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-md">
              <Label className="text-lg font-bold text-[#2a4080] mb-2 block">Item Number</Label>
              <div className="flex space-x-2">
                <Input value={itemNoInput}
                  onChange={e => { setItemNoInput(e.target.value); form.setValue("item_no", e.target.value); }}
                  onBlur={() => handleItemSearch()}
                  onKeyDown={handleItemNoKeyDown}
                  placeholder="Enter numeric item number..."
                  className="text-lg py-6 max-w-sm border-[#4a6fa5] focus-visible:ring-[#4a6fa5]"
                  disabled={!isNewMode && !isEditMode} />
                <Button onClick={() => handleItemSearch("customer_name")} className="bg-[#4a6fa5] hover:bg-[#3b5fc0] h-auto px-6"
                  disabled={!isNewMode && !isEditMode}>Load Item</Button>
                <Button onClick={handleEditItem} variant="outline" className="h-auto px-6 border-[#4a6fa5] text-[#4a6fa5] hover:bg-[#4a6fa5] hover:text-white"
                  disabled={!itemData}>Edit Item</Button>
              </div>
              {isItemError && <p className="text-red-500 text-sm mt-2 font-medium">Item not found. Please add it.</p>}
            </div>

            {/* All sections — always full opacity, never greyed */}
            <div className={`space-y-8 ${!isFormEnabled ? "pointer-events-none" : ""}`}>

              {/* Customer Details */}
              <section>
                <SectionHeader title="CUSTOMER DETAILS" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {/* Customer Name — autocomplete from history, editable */}
                  <AutocompleteField
                    form={form} name="customer_name" label="Customer Name" required
                    options={distinctCustomers} disabled={!isFormEnabled}
                    error={formErrors["customer_name"]}
                  />
                  <FormField form={form} name="cust_part_code" label="Cust. Part Name/Item No." disabled={!isFormEnabled} />
                  {/* Customer Order No — suggestion dropdown on 3+ chars */}
                  <SuggestionField
                    form={form} name="cus_order_no" label="Customer Order No." required
                    fetchField="cus_order_no" disabled={!isFormEnabled}
                    error={formErrors["cus_order_no"]}
                  />
                  <FormField form={form} name="cus_order_date" label="Customer Order Date" type="date" required
                    disabled={!isFormEnabled} error={formErrors["cus_order_date"]} />
                </div>
              </section>

              {/* Order Details */}
              <section>
                <SectionHeader title="ORDER DETAILS" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {/* W.O. Number — suggestion dropdown */}
                  <SuggestionField
                    form={form} name="wo_number" label="W.O. Number" required
                    fetchField="wo_number" disabled={!isFormEnabled}
                    error={formErrors["wo_number"]}
                  />
                  {/* CT Type — auto-dropdown from history, free-type */}
                  <AutocompleteField
                    form={form} name="ct_type" label="CT Type"
                    options={distinctCtTypes} disabled={!isFormEnabled}
                  />
                  <FormField form={form} name="po_item_no" label="PO Item No." required
                    disabled={!isFormEnabled} error={formErrors["po_item_no"]} />
                  {/* Serial Number — suggestion dropdown */}
                  <SuggestionField
                    form={form} name="serial_number" label="Serial Number"
                    fetchField="serial_number" disabled={!isFormEnabled}
                  />
                  {/* Quantity */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Quantity {REQ}
                    </label>
                    <div className="flex">
                      <Controller name="quantity" control={form.control} render={({ field }) => (
                        <Input {...field} value={field.value || ""} disabled={!isFormEnabled}
                          className={`rounded-r-none border-r-0 bg-gray-50 ${formErrors["quantity"] ? "border-red-400" : ""}`} />
                      )} />
                      <div className="px-3 py-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-sm text-gray-600 font-medium flex items-center">NOS</div>
                    </div>
                    {formErrors["quantity"] && <p className="text-red-500 text-xs mt-0.5">{formErrors["quantity"]}</p>}
                  </div>
                </div>
              </section>

              {/* Electric Details */}
              <section>
                <SectionHeader title="ELECTRIC DETAILS" />
                <div className="grid grid-cols-6 gap-4">
                  <FormField form={form} name="ratio"            label="Ratio"          disabled={!isFormEnabled} />
                  <FormField form={form} name="rated_voltage"    label="Rated Voltage"  disabled={!isFormEnabled} />
                  <FormField form={form} name="stc"              label="STC"            disabled={!isFormEnabled} />
                  <FormField form={form} name="insulation_level" label="I.L."           disabled={!isFormEnabled} />
                  <FormField form={form} name="frequency"        label="Frequency"      disabled={!isFormEnabled} />
                  <FormField form={form} name="ref_std"          label="Ref. Std."      disabled={!isFormEnabled} />
                </div>
              </section>

              {/* Core Particulars */}
              <section>
                <SectionHeader title="CORE PARTICULARS" />
                <div className="overflow-x-auto border border-[#dee2e6] rounded-md">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-white uppercase bg-[#4a6fa5]">
                      <tr>
                        <th className="px-4 py-3 border-r border-[#dee2e6]/20 w-1/4">Particulars</th>
                        <th className="px-4 py-3 border-r border-[#dee2e6]/20">Core 1</th>
                        <th className="px-4 py-3 border-r border-[#dee2e6]/20">Core 2</th>
                        <th className="px-4 py-3">Core 3</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CORE_FIELDS.map((row, idx) => (
                        <React.Fragment key={idx}>
                          <tr className="bg-white border-b border-[#dee2e6] hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-1.5 font-medium text-gray-900 border-r border-[#dee2e6] bg-gray-50/50 whitespace-nowrap">
                              {row.label}
                            </td>
                            {(["core1", "core2", "core3"] as const).map((coreKey, colIdx) => (
                              <td key={coreKey} className={`p-0${colIdx < 2 ? " border-r border-[#dee2e6]" : ""}`}>
                                {row.isCheckboxVK2 ? (
                                  <VK2CheckboxCell form={form}
                                    mainName={`${coreKey}.${row.key}`}
                                    checkboxName={`${coreKey}.max_exc_is_vk2`}
                                    disabled={!isFormEnabled} gridRow={idx} gridCol={colIdx} />
                                ) : (
                                  <TableInput form={form} name={`${coreKey}.${row.key}`}
                                    disabled={!isFormEnabled} gridRow={idx} gridCol={colIdx} />
                                )}
                              </td>
                            ))}
                          </tr>
                          {idx === SEPARATOR_AFTER_IDX && (
                            <tr className="bg-white border-b border-[#dee2e6]">
                              <td className="px-4 py-[3px] bg-gray-50/50" />
                              <td className="py-[3px]" /><td className="py-[3px]" /><td className="py-[3px]" />
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Bottom Fields */}
              <section>
                <div className="grid grid-cols-4 gap-4 mt-6">
                  <FormField form={form} name="ct_final_dim" label="CT Final Dim" disabled={!isFormEnabled} dataField="ct_final_dim" />
                  <FormField form={form} name="ga_drg"        label="GA Drg"      disabled={!isFormEnabled} />
                  <FormField form={form} name="ins_class"     label="INS Class"   disabled={!isFormEnabled} />
                  <FormField form={form} name="ref_ti"        label="Ref TI"      disabled={!isFormEnabled} />
                  <FormField form={form} name="pri_turns"     label="PRI Turns"   disabled={!isFormEnabled} />
                  <FormField form={form} name="pri_copper"    label="PRI Copper"  disabled={!isFormEnabled} />
                  <FormField form={form} name="former"        label="Former"      disabled={!isFormEnabled} />
                  <FormField form={form} name="pri_length"    label="PRI Length"  disabled={!isFormEnabled} />
                  <FormField form={form} name="pri_weight"    label="PRI Weight"  disabled={!isFormEnabled} />
                  <FormField form={form} name="sec_terminal"  label="Sec. Terminal" disabled={!isFormEnabled} />
                  <FormField form={form} name="total_weight"  label="Total Weight"  disabled={!isFormEnabled} />
                </div>
              </section>

              {/* Notes */}
              <section>
                <SectionHeader title="NOTES & REVISION" />
                <div className="grid grid-cols-4 gap-4">
                  <FormField form={form} name="rev_no" label="Rev No." disabled={!isFormEnabled} />
                  <div className="col-span-3 space-y-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Note</label>
                    <Controller name="note" control={form.control} render={({ field }) => (
                      <textarea {...field} value={field.value || ""} disabled={!isFormEnabled} rows={3}
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-700 resize-none" />
                    )} />
                  </div>
                </div>
              </section>

              {/* Signatures — always editable, persist via localStorage */}
              <section className="pb-8">
                <SectionHeader title="SIGNATURES" />
                <p className="text-xs text-gray-500 mb-3 italic">
                  Signatures are saved automatically and persist across sessions. Change here to update future TIs.
                </p>
                <div className="grid grid-cols-3 gap-6">
                  {(["approved_by", "checked_by", "created_by"] as const).map((fieldName, i) => {
                    const labels = ["Approved By", "Checked By", "Created By"];
                    return (
                      <div key={fieldName} className="space-y-1">
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{labels[i]}</label>
                        <Controller name={fieldName} control={form.control} render={({ field }) => (
                          <Input {...field} value={field.value || ""}
                            // Signatures always editable regardless of form state
                            className="h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5]"
                            onChange={e => {
                              field.onChange(e);
                              // Live-update sticky ref and localStorage
                              const updated = {
                                ...stickyRef.current,
                                [fieldName]: e.target.value,
                              };
                              stickyRef.current = updated;
                              saveSignatures(updated);
                            }}
                          />
                        )} />
                        <div className="border-t border-gray-400 mt-6 pt-1 text-center text-[10px] text-gray-500 uppercase tracking-wider">{labels[i]}</div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

      <SearchModal open={isSearchModalOpen} onOpenChange={setIsSearchModalOpen}
        onSelect={tiNo => { setCurrentTiNo(tiNo); setIsSearchModalOpen(false); }} />
      <AddItemModal open={isAddItemModalOpen} onOpenChange={setIsAddItemModalOpen} itemNo={activeItemNo}
        mode={itemModalMode} itemData={itemData || null}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(activeItemNo) });
          setIsAddItemModalOpen(false);
        }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REUSABLE COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function SidebarButton({ icon, title, onClick, disabled }: { icon: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`w-12 h-12 flex flex-col items-center justify-center rounded-md transition-colors group ${disabled ? "text-white/30 cursor-not-allowed" : "text-white/80 hover:text-white hover:bg-white/10"}`}>
      <div className={`[&>svg]:w-5 [&>svg]:h-5 mb-1 transition-transform ${!disabled && "group-hover:scale-110"}`}>{icon}</div>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-blue-50/80 border-l-4 border-[#4a6fa5] py-2 px-4 mb-4">
      <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm">{title}</h3>
    </div>
  );
}

function FormField({ form, name, label, type = "text", disabled, dataField, required, error }: {
  form: any; name: string; label: string; type?: string;
  disabled?: boolean; dataField?: string; required?: boolean; error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <Controller name={name} control={form.control} render={({ field }) => (
        <Input {...field} type={type} value={field.value || ""} disabled={disabled} data-field={dataField}
          className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-700 ${error ? "border-red-400" : ""}`} />
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
    </div>
  );
}

/**
 * AutocompleteField — free-type input with dropdown from historical data.
 * Shows all options on focus if field empty, or filters as you type.
 * Used for: Customer Name, CT Type
 */
function AutocompleteField({ form, name, label, options, disabled, required, error }: {
  form: any; name: string; label: string; options: string[];
  disabled?: boolean; required?: boolean; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldValue = useWatch({ control: form.control, name });

  // Sync query with form value
  useEffect(() => { setQuery(fieldValue || ""); }, [fieldValue]);

  const filtered = options.filter(o => !query || o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <Controller name={name} control={form.control} render={({ field }) => (
        <Input {...field} value={field.value || ""} disabled={disabled}
          className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-700 ${error ? "border-red-400" : ""}`}
          autoComplete="off"
          onFocus={() => { if (!disabled) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onChange={e => { field.onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === "Enter" && open && filtered.length === 1) {
              e.preventDefault();
              form.setValue(name, filtered[0], { shouldDirty: true });
              setQuery(filtered[0]);
              setOpen(false);
            }
          }}
        />
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      {open && !disabled && filtered.length > 0 && (
        <ul className="absolute z-50 mt-0.5 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-44 overflow-y-auto text-sm">
          {filtered.map(opt => (
            <li key={opt}
              onMouseDown={e => { e.preventDefault(); form.setValue(name, opt, { shouldDirty: true }); setQuery(opt); setOpen(false); }}
              className="px-3 py-1.5 cursor-pointer hover:bg-[#4a6fa5]/10 hover:text-[#2a4080] transition-colors">
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * SuggestionField — regular input that shows a dropdown of matching suggestions
 * only after the user has typed at least 3 characters.
 * Used for: Customer Order No., W.O. Number, Serial Number
 */
function SuggestionField({ form, name, label, fetchField, disabled, required, error }: {
  form: any; name: string; label: string; fetchField: keyof TiRecordInput;
  disabled?: boolean; required?: boolean; error?: string;
}) {
  const { data: allValues = [] } = useDistinctTiValues(fetchField);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentValue: string = useWatch({ control: form.control, name }) || "";

  const filtered = currentValue.length >= 3
    ? allValues.filter(v => v.toLowerCase().includes(currentValue.toLowerCase()))
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="space-y-1 relative" ref={containerRef}>
      <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <Controller name={name} control={form.control} render={({ field }) => (
        <Input {...field} value={field.value || ""} disabled={disabled}
          className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-700 ${error ? "border-red-400" : ""}`}
          autoComplete="off"
          onChange={e => { field.onChange(e.target.value); setOpen(true); }}
          onFocus={() => { if (currentValue.length >= 3) setOpen(true); }}
          onBlur={() => setTimeout(() => setOpen(false), 100)}
          onKeyDown={e => {
            if (e.key === "Enter" && open && filtered.length === 1) {
              e.preventDefault();
              form.setValue(name, filtered[0], { shouldDirty: true });
              setOpen(false);
            }
          }}
        />
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      {open && !disabled && filtered.length > 0 && (
        <ul className="absolute z-50 mt-0.5 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-44 overflow-y-auto text-sm">
          {filtered.map(opt => (
            <li key={opt}
              onMouseDown={e => { e.preventDefault(); form.setValue(name, opt, { shouldDirty: true }); setOpen(false); }}
              className="px-3 py-1.5 cursor-pointer hover:bg-[#4a6fa5]/10 hover:text-[#2a4080] transition-colors">
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** VK2 checkbox cell — checkbox only visible when field has value */
function VK2CheckboxCell({ form, mainName, checkboxName, disabled, gridRow, gridCol }: {
  form: any; mainName: string; checkboxName: string;
  disabled?: boolean; gridRow?: number; gridCol?: number;
}) {
  const mainValue = useWatch({ control: form.control, name: mainName });
  const hasValue = !!(mainValue && String(mainValue).trim());
  return (
    <div className="flex flex-col">
      <Controller name={mainName} control={form.control} render={({ field }) => (
        <Input {...field} value={field.value || ""} disabled={disabled}
          data-grid-row={gridRow} data-grid-col={gridCol}
          className="border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] focus-visible:ring-inset bg-transparent disabled:bg-transparent disabled:text-gray-900 px-3" />
      )} />
      {hasValue && (
        <Controller name={checkboxName} control={form.control} render={({ field }) => {
          const checked = field.value === "true" || field.value === true;
          return (
            <label className={`flex items-center gap-1.5 px-3 py-[3px] border-t border-gray-100 cursor-pointer select-none ${disabled ? "opacity-60 pointer-events-none" : "hover:bg-blue-50/50"}`}>
              <input type="checkbox" checked={checked} disabled={disabled}
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

function TableInput({ form, name, disabled, gridRow, gridCol }: {
  form: any; name: string; disabled?: boolean; gridRow?: number; gridCol?: number;
}) {
  return (
    <Controller name={name} control={form.control} render={({ field }) => (
      <Input {...field} value={field.value || ""} disabled={disabled}
        data-grid-row={gridRow} data-grid-col={gridCol}
        className="border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] focus-visible:ring-inset bg-transparent disabled:bg-transparent disabled:text-gray-900 px-3" />
    )} />
  );
}

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useForm, Controller, useWatch } from "react-hook-form";
import {
  Save, FilePlus, Search, ChevronLeft, ChevronRight, Edit3, Printer, FileText, Settings, CalendarDays,
  CheckCircle2, ShieldCheck, LockKeyhole, XCircle, ClipboardList, Trash2, Tags,
  Eye, EyeOff, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useGetItem, useGetTiRecord, useGetAdjacentTiRecords,
  useUpdateTiRecord, useCreateTiRecord, useUpdateItem, getGetItemQueryKey, getGetTiRecordQueryKey,
  useDistinctTiValues, useDistinctCtTypes, getCustomerForItemAsync,
  getFirstTiForItemCustomerAsync, useCheckTiRecord, useReopenTiRecord, useRejectTiRecord,
  useTiStatusCounts, canCheckTi, canWriteTi, useListItems, useListTiNumbers, useListTiRecords, useListWorkOrders,
  useUpdateWorkOrder,
  compareTiNumberValues,
} from "@/api-client";
import type { TiRecordInput, CoreData, ItemInput, UserProfile, ApprovalStatus, RejectionItem, WorkOrderInput, WorkOrderRecord } from "@/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { SearchModal } from "@/components/ti-form/SearchModal";
import { AddItemModal } from "@/components/ti-form/AddItemModal";
import { TiLabelEditorDialog } from "@/components/ti-form/TiLabelEditorDialog";
import { downloadTiPdf, printTiPdf } from "@/components/ti-form/downloadTiPdf";
import { formatDisplayDate, parseDisplayDate, todayLocalIso } from "@/lib/date-format";
import { calculateCoreFromDimensions, calculateTapTurns, expandRatioByCore, formatCoreWeight } from "@/lib/core-calculations";
import { AdminPanel } from "@/components/admin/AdminPanel";
import { ProfileTopBar } from "@/components/ProfileTopBar";
import { buildItemTiFormatMap, getItemTiFormat, normalizeItemNo } from "@/lib/item-ti-compatibility";
import { getPendingWorkOrderSummaryFromRecords, mapWorkOrderToTiDraft, mergeTiFormWithItemMaster } from "@/lib/work-orders";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";

// â”€â”€ Signature persistence key (survives page reload / login) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Core table config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SEPARATOR_AFTER_IDX = 6;

const CORE_FIELDS: Array<{ label: string; key: string; isCheckboxVK2?: boolean }> = [
  { label: "RATIO",                  key: "ratio" },
  { label: "Burden (VA)",            key: "burden_va" },
  { label: "Accuracy Class",         key: "accuracy_class" },
  { label: "ISF",                    key: "isf" },
  { label: "Min. Knee pt. volt.",    key: "min_knee_pt_volt" },
  { label: "Max. Rct @ 75Â°c",        key: "max_rct_75c" },
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

const REJECTION_FIELD_OPTIONS: Array<{ path: string; label: string }> = [
  { path: "ti_no", label: "TI No" },
  { path: "ti_date", label: "TI Date" },
  { path: "item_no", label: "Item Number" },
  { path: "customer_name", label: "Customer Name" },
  { path: "cust_part_code", label: "Cust. Part Name/Item No." },
  { path: "cus_order_no", label: "Customer Order No." },
  { path: "cus_order_date", label: "Customer Order Date" },
  { path: "wo_number", label: "W.O. Number" },
  { path: "ct_type", label: "CT Type" },
  { path: "po_item_no", label: "PO Item No." },
  { path: "serial_number", label: "Serial Number" },
  { path: "quantity", label: "Quantity" },
  { path: "ratio", label: "Ratio" },
  { path: "rated_voltage", label: "Rated Voltage" },
  { path: "stc", label: "STC" },
  { path: "insulation_level", label: "I.L." },
  { path: "frequency", label: "Frequency" },
  { path: "ref_std", label: "Ref. Std." },
  ...CORE_FIELDS.flatMap((field) =>
    ([1, 2, 3] as const).map((coreNo) => ({
      path: `core${coreNo}.${field.key}`,
      label: `${field.label} - Core ${coreNo}`,
    }))
  ),
  { path: "ct_final_dim", label: "CT Final Dim" },
  { path: "ga_drg", label: "GA Drg" },
  { path: "ins_class", label: "INS Class" },
  { path: "ref_ti", label: "Ref TI" },
  { path: "pri_turns", label: "PRI Turns" },
  { path: "pri_copper", label: "PRI Copper" },
  { path: "former", label: "Former" },
  { path: "pri_length", label: "PRI Length" },
  { path: "pri_weight", label: "PRI Weight" },
  { path: "sec_terminal", label: "Sec. Terminal" },
  { path: "total_weight", label: "Total Weight" },
  { path: "rev_no", label: "Rev No." },
  { path: "note", label: "Note" },
];

const ITEM_MASTER_FIELD_ROOTS = new Set<string>([
  "id",
  "item_no",
  "ti_format",
  "ct_type",
  "cust_part_code",
  "ratio",
  "rated_voltage",
  "stc",
  "insulation_level",
  "frequency",
  "ref_std",
  "core1",
  "core2",
  "core3",
  "ct_final_dim",
  "ga_drg",
  "ins_class",
  "ref_ti",
  "pri_turns",
  "pri_copper",
  "former",
  "pri_length",
  "pri_weight",
  "sec_terminal",
  "total_weight",
  "default_customer",
  "created_at",
  "updated_at",
]);

const WORK_ORDER_REJECTION_FIELD_MAP: Record<string, keyof WorkOrderInput> = {
  customer_name: "customer",
  cust_part_code: "item_code",
  cus_order_no: "po_no",
  cus_order_date: "po_date",
  item_no: "our_item_code",
  po_item_no: "po_line_no",
  quantity: "qty",
  serial_number: "sr_no",
  ti_no: "ti_no",
  wo_number: "work_order",
};

const MIRRORED_ITEM_WORK_ORDER_PATHS = new Set<string>(["cust_part_code", "item_no"]);

// Required field indicator
const REQ = <span className="text-red-500 ml-0.5">*</span>;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN COMPONENT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Home({
  profile,
  onLogout,
  onBackToModules,
}: {
  profile: UserProfile;
  onLogout: () => void | Promise<void>;
  onBackToModules?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userCanWrite = canWriteTi(profile.role);
  const userCanCheck = canCheckTi(profile.role);
  const userIsAdmin = profile.role === "admin";
  const viewerOnlyChecked = profile.role === "viewer";
  const canUseLabels = profile.role !== "viewer";

  const [draftTiNo, setDraftTiNo] = useState("");
  const [currentTiNo, setCurrentTiNo] = useState<string | null>(null);
  const [editedTiNo, setEditedTiNo] = useState("");
  const [isEditMode, setIsEditMode] = useState(false);
  const [isNewMode, setIsNewMode] = useState(userCanWrite);
  const [itemNoInput, setItemNoInput] = useState("");
  const [activeItemNo, setActiveItemNo] = useState("");
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchStatusFilter, setSearchStatusFilter] = useState<ApprovalStatus | "all">("all");
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [isLabelEditorOpen, setIsLabelEditorOpen] = useState(false);
  const [isDrawingViewerOpen, setIsDrawingViewerOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");
  const [queuedWorkOrderId, setQueuedWorkOrderId] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [rejectionItems, setRejectionItems] = useState<RejectionItem[]>([]);
  const pendingItemFocusRef = useRef<string | null>(null);
  const pendingSearchEditRef = useRef<string | null>(null);
  const lastCoreColumnRef = useRef("2");

  // â”€â”€ Distinct value hooks for dropdowns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: distinctCustomers = [] } = useDistinctTiValues("customer_name");
  const { data: distinctCtTypes = [] } = useDistinctCtTypes();

  // â”€â”€ Data Fetching â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: itemData, isError: isItemError } = useGetItem(activeItemNo, {
    query: { enabled: !!activeItemNo, retry: false },
  });
  const { data: tiRecordData } = useGetTiRecord(currentTiNo || "", {
    query: { enabled: !!currentTiNo, retry: false },
  });
  const { data: allTiRecordsData } = useListTiNumbers();
  const { data: viewerCheckedTiRecordsData } = useListTiRecords(
    { approvalStatus: "checked" },
    { query: { enabled: viewerOnlyChecked } }
  );
  const { data: allItemsData } = useListItems();
  const { data: workOrdersData } = useListWorkOrders();
  const navigationTiNo = currentTiNo || draftTiNo;
  const { data: adjacentData } = useGetAdjacentTiRecords(navigationTiNo, {
    query: { enabled: !!navigationTiNo && !viewerOnlyChecked },
  });
  const { data: statusCounts = { all: 0, pending_check: 0, checked: 0, rejected: 0 } } = useTiStatusCounts();
  const allTiRecords = allTiRecordsData?.records || [];
  const existingTiNos = new Set((allTiRecordsData?.records || []).map((record) => record.ti_no));
  const workOrderRecords = workOrdersData?.records || [];
  const itemTiFormats = buildItemTiFormatMap(allItemsData?.items);
  const pendingWorkOrderSummary = getPendingWorkOrderSummaryFromRecords(workOrderRecords, existingTiNos, itemTiFormats);
  const isNonStandardItem = !!activeItemNo && getItemTiFormat(itemData) === "non_standard";
  const sortedTiRecords = useMemo(
    () => [...allTiRecords].sort((a, b) => compareTiNumberValues(a.ti_no, b.ti_no)),
    [allTiRecords]
  );
  const viewerSortedTiRecords = useMemo(
    () => [...(viewerCheckedTiRecordsData?.records || [])].sort((a, b) => compareTiNumberValues(a.ti_no, b.ti_no)),
    [viewerCheckedTiRecordsData?.records]
  );
  const navigableTiRecords = viewerOnlyChecked ? viewerSortedTiRecords : sortedTiRecords;
  const viewerAdjacentData = useMemo(() => {
    if (!viewerOnlyChecked || !navigationTiNo) return { prev: null, next: null };
    const currentIndex = viewerSortedTiRecords.findIndex((record) => record.ti_no === navigationTiNo);
    if (currentIndex === -1) return { prev: null, next: null };
    return {
      prev: currentIndex > 0 ? viewerSortedTiRecords[currentIndex - 1].ti_no : null,
      next: currentIndex < viewerSortedTiRecords.length - 1 ? viewerSortedTiRecords[currentIndex + 1].ti_no : null,
    };
  }, [navigationTiNo, viewerOnlyChecked, viewerSortedTiRecords]);
  const effectiveAdjacentData = viewerOnlyChecked ? viewerAdjacentData : adjacentData;

  const createTiMutation = useCreateTiRecord();
  const updateTiMutation = useUpdateTiRecord();
  const updateItemMutation = useUpdateItem();
  const updateWorkOrderMutation = useUpdateWorkOrder();
  const checkTiMutation = useCheckTiRecord();
  const rejectTiMutation = useRejectTiRecord();
  const reopenTiMutation = useReopenTiRecord();

  const form = useForm<TiRecordInput>({
    defaultValues: {
      ti_date: todayLocalIso(),
      item_no: "",
      approval_status: "pending_check",
      approved_by: "",
      checked_by: "",
      created_by: profile.initials,
      created_by_user_id: profile.id,
      rejection_items: [],
    },
  });
  const watchedItemNo = useWatch({ control: form.control, name: "item_no" });
  const watchedCustomerName = useWatch({ control: form.control, name: "customer_name" });
  const watchedApprovalStatus = useWatch({ control: form.control, name: "approval_status" });
  const activeDrawing = useMemo(
    () => getActiveItemDrawing(activeItemNo, itemNoInput, watchedItemNo, itemData, allItemsData?.items || []),
    [activeItemNo, allItemsData?.items, itemData, itemNoInput, watchedItemNo]
  );
  const currentApprovalStatus = (watchedApprovalStatus || tiRecordData?.approval_status || "pending_check") as ApprovalStatus;
  const hasPersistedTiRecord = Boolean(currentTiNo);
  const isChecked = currentApprovalStatus === "checked";
  const isRejected = currentApprovalStatus === "rejected";
  const isLockedStatus = isChecked;
  const canManageRejectionItems = userCanCheck && !!currentTiNo && currentApprovalStatus === "pending_check" && !isEditMode && !isNewMode;

  useEffect(() => {
    if (!activeDrawing) setIsDrawingViewerOpen(false);
  }, [activeDrawing]);

  useEffect(() => {
    let cancelled = false;
    if (!isNewMode || !watchedItemNo || !watchedCustomerName) {
      if (isNewMode) form.setValue("ref_ti", "");
      return;
    }

    const timer = window.setTimeout(() => {
      getFirstTiForItemCustomerAsync(watchedItemNo, watchedCustomerName)
        .then((firstTiNo) => {
          if (!cancelled) form.setValue("ref_ti", firstTiNo);
        })
        .catch(() => {
          if (!cancelled) form.setValue("ref_ti", "");
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [form, isNewMode, watchedCustomerName, watchedItemNo]);

  // When item loads â€” populate fields + auto-fill customer from history
  useEffect(() => {
    let cancelled = false;
    if (itemData && (isNewMode || isEditMode)) {
      getCustomerForItemAsync(itemData.item_no).catch(() => "").then((historicCustomer) => {
        if (cancelled) return;
        toast({ title: "Item loaded", className: "bg-green-50 border-green-200 text-green-800" });
        const current = form.getValues();
        form.reset(mergeTiFormWithItemMaster(current, itemData, historicCustomer));
        if (pendingItemFocusRef.current) {
          const nextField = pendingItemFocusRef.current;
          pendingItemFocusRef.current = null;
          focusFieldByName(nextField);
        }
      });
    }
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemData, isEditMode, isNewMode]);

  useEffect(() => {
    if (isItemError && activeItemNo) {
      setItemModalMode("create");
      setIsAddItemModalOpen(true);
    }
  }, [isItemError, activeItemNo]);

  useEffect(() => {
    if (!activeItemNo || !isNonStandardItem) return;
    toast({
      variant: "destructive",
      title: "Item not compatible",
      description: "This item uses a different TI flow and cannot be created in the standard TI format.",
    });
  }, [activeItemNo, isNonStandardItem, toast]);

  useEffect(() => {
    if (tiRecordData) {
      if (viewerOnlyChecked && (tiRecordData.approval_status || "pending_check") !== "checked") {
        pendingSearchEditRef.current = null;
        setCurrentTiNo(null);
        setEditedTiNo("");
        setItemNoInput("");
        setActiveItemNo("");
        setRejectionItems([]);
        form.reset({
          ti_date: todayLocalIso(),
          item_no: "",
          approval_status: "pending_check",
          approved_by: "",
          checked_by: "",
          created_by: profile.initials,
          created_by_user_id: profile.id,
          rejection_items: [],
        });
        toast({
          variant: "destructive",
          title: "Viewer access limited",
          description: "Viewer role can only open checked TIs.",
        });
        return;
      }
      const shouldOpenInEditMode = pendingSearchEditRef.current === tiRecordData.ti_no;
      const cachedItemData =
        (allItemsData?.items || []).find((item) => item.item_no === (tiRecordData.item_no || "")) ||
        (itemData?.item_no === (tiRecordData.item_no || "") ? itemData : null);
      pendingSearchEditRef.current = null;
      setQueuedWorkOrderId(null);
      setIsNewMode(false);
      setIsEditMode(shouldOpenInEditMode);
      setEditedTiNo(tiRecordData.ti_no);
      setItemNoInput(tiRecordData.item_no || "");
      setActiveItemNo(tiRecordData.item_no || "");
      setRejectionItems(normalizeRejectionItems(tiRecordData.rejection_items));
      form.reset(mergeTiFormWithItemMaster(tiRecordData, cachedItemData));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItemsData?.items, itemData, profile.id, profile.initials, tiRecordData, toast, viewerOnlyChecked]);

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

  // Form is always visually enabled â€” no grey overlay after save
  const isFormEnabled = userCanWrite && !!activeItemNo && !isItemError && !isNonStandardItem && (isNewMode || isEditMode) && !isLockedStatus;
  const fieldDisabled = !isFormEnabled && !canManageRejectionItems;
  const correctedRejectionItems = useMemo(
    () => rejectionItems.filter((item) => String(item.corrected_value || "").trim()),
    [rejectionItems]
  );
  const hasCorrectedRejectionItems = correctedRejectionItems.length > 0;

  // â”€â”€ Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const handleMarkRejectionField = (path: string, label: string, fieldValue: string) => {
    setRejectionItems((current) => {
      const existing = current.find((item) => item.field_path === path);
      if (existing) {
        return current.map((item) =>
          item.field_path === path
            ? { ...item, field_label: label, field_value: fieldValue }
            : item
        );
      }
      return [
        ...current,
        {
          id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `rejection-${Date.now()}`,
          field_path: path,
          field_label: label,
          field_value: fieldValue,
          corrected_value: "",
        },
      ];
    });
  };

  const handleUpdateRejectionField = (path: string, correctedValue: string) => {
    setRejectionItems((current) =>
      current.map((item) =>
        item.field_path === path ? { ...item, corrected_value: correctedValue } : item
      )
    );
  };

  const handleUpdateRejectionItem = (id: string | undefined, index: number, correctedValue: string) => {
    setRejectionItems((current) =>
      current.map((item, itemIndex) =>
        (id ? item.id === id : itemIndex === index)
          ? { ...item, corrected_value: correctedValue }
          : item
      )
    );
  };

  const handleRemoveRejectionItem = (id: string | undefined, index: number) => {
    setRejectionItems((current) =>
      current.filter((item, itemIndex) => (id ? item.id !== id : itemIndex !== index))
    );
  };

  const handleRemoveRejectionField = (path: string) => {
    setRejectionItems((current) => current.filter((item) => item.field_path !== path));
  };

  const getReviewConfig = (path: string, label: string): FieldReviewConfig | undefined => {
    const item = rejectionItems.find((entry) => entry.field_path === path);
    if (!canManageRejectionItems && !item) return undefined;
    return {
      path,
      label,
      item,
      editable: canManageRejectionItems,
      onMark: handleMarkRejectionField,
      onUpdate: handleUpdateRejectionField,
      onRemove: handleRemoveRejectionField,
    };
  };

  const resetNewTiForm = () => {
    setCurrentTiNo(null);
    setDraftTiNo("");
    setEditedTiNo("");
    setQueuedWorkOrderId(null);
    setIsNewMode(true);
    setIsEditMode(true);
    setItemNoInput("");
    setActiveItemNo("");
    setFormErrors({});
    setRejectionItems([]);
    form.reset({
      ti_date: todayLocalIso(),
      item_no: "",
      approval_status: "pending_check",
      created_by: profile.initials,
      created_by_user_id: profile.id,
      checked_by: "",
      approved_by: "",
      checked_by_user_id: null,
      approved_by_user_id: null,
      checked_at: null,
      approved_at: null,
      rejection_items: [],
    });
  };

  const loadWorkOrderIntoTi = (workOrder: WorkOrderRecord) => {
    const workOrderItemNo = normalizeItemNo(workOrder.our_item_code);
    const itemFormat = itemTiFormats[workOrderItemNo];
    if (itemFormat !== "standard") {
      toast({
        variant: "destructive",
        title: "Item not compatible",
        description:
          itemFormat === "non_standard"
            ? "This Work Order uses a non-standard TI flow and was skipped."
            : "This Work Order item is not marked as Standard TI Format, so it was skipped.",
      });
      return false;
    }

    const draft = { ...mapWorkOrderToTiDraft(workOrder), item_no: workOrderItemNo };
    const cachedItemData =
      (allItemsData?.items || []).find((item) => normalizeItemNo(item.item_no) === workOrderItemNo) ||
      (normalizeItemNo(itemData?.item_no) === workOrderItemNo ? itemData : null);
    const nextFormValues = mergeTiFormWithItemMaster(
      {
        ti_date: todayLocalIso(),
        approval_status: "pending_check",
        created_by: profile.initials,
        created_by_user_id: profile.id,
        checked_by: "",
        approved_by: "",
        checked_by_user_id: null,
        approved_by_user_id: null,
        checked_at: null,
        approved_at: null,
        rejection_items: [],
        ...draft,
      },
      cachedItemData || undefined
    );

    setQueuedWorkOrderId(workOrder.id);
    setCurrentTiNo(null);
    setDraftTiNo(workOrder.ti_no || "");
    setEditedTiNo(workOrder.ti_no || "");
    setIsNewMode(true);
    setIsEditMode(true);
    setItemNoInput(workOrderItemNo);
    setActiveItemNo(workOrderItemNo);
    setFormErrors({});
    setRejectionItems([]);
    form.reset(nextFormValues);
    return true;
  };

  const handleFetchNextWorkOrder = () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Only TI creators can fetch Work Orders." });
      return;
    }
    if (!allItemsData?.items) {
      toast({ title: "Loading item formats", description: "Please wait a moment and click Fetch WO again." });
      return;
    }
    if (!pendingWorkOrderSummary.fetchableCount) {
      toast({
        title: "No Work Orders ready for TI",
        description: pendingWorkOrderSummary.blockedCount
          ? `${pendingWorkOrderSummary.blockedCount} non-standard Work Order(s) were skipped.`
          : "Every saved Work Order already has a TI or none are waiting.",
      });
      return;
    }
    const nextFetchable = pendingWorkOrderSummary.fetchable[0];
    if (!nextFetchable) {
      return;
    }
    const loaded = loadWorkOrderIntoTi(nextFetchable);
    if (!loaded) return;
    toast({
      title: `Fetched ${nextFetchable.ti_no}`,
      description:
        pendingWorkOrderSummary.blockedCount > 0
          ? `${pendingWorkOrderSummary.blockedCount} non-standard Work Order(s) were skipped.`
          : "Review the TI and save it.",
    });
  };

  const handleNew = async () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Checker can review and check TIs, but cannot create new TIs." });
      return;
    }
    resetNewTiForm();
  };

  const handleEdit = () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Checker can review and check TIs, but cannot edit TIs." });
      return;
    }
    if (isLockedStatus) {
      toast({ title: "TI is checked", description: "Admin must reopen it before editing." });
      return;
    }
    if (currentTiNo) {
      setEditedTiNo(currentTiNo);
      setIsEditMode(true);
    }
  };

  const handleEditItem = () => {
    if (!userCanWrite) return;
    if (!activeItemNo || !itemData) return;
    setItemModalMode("edit");
    setIsAddItemModalOpen(true);
  };

  const handleSave = async () => {
    if (!userCanWrite) return;
    if (!isFormEnabled) return;
    const rawFormData = form.getValues();
    let data: TiRecordInput;
    try {
      data = isRejected
        ? applyTiCorrectionsFromRejections(rawFormData, rejectionItems)
        : rawFormData;
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error saving record",
        description: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!data.item_no) {
      toast({ variant: "destructive", title: "Item number is required" });
      return;
    }
    if (isNewMode && !draftTiNo.trim()) {
      toast({ variant: "destructive", title: "Fetch Work Order first", description: "TI numbers now come from saved Work Orders." });
      return;
    }
    if (isNonStandardItem) {
      toast({
        variant: "destructive",
        title: "Item not compatible",
        description: "This item uses a different TI flow and cannot be saved in the standard TI screen.",
      });
      return;
    }
    if (!validateRequired(data)) {
      toast({ variant: "destructive", title: "Please fill all required fields", description: "Fields marked with * are mandatory." });
      return;
    }
    try {
      const normalizedDataItemNo = normalizeItemNo(data.item_no || "");
      const normalizedOriginalItemNo = normalizeItemNo(rawFormData.item_no || data.item_no || "");
      const currentMasterItem =
        (normalizeItemNo(itemData?.item_no) === normalizedOriginalItemNo ? itemData : null) ||
        (allItemsData?.items || []).find((item) => normalizeItemNo(item.item_no) === normalizedOriginalItemNo) ||
        (normalizeItemNo(itemData?.item_no) === normalizedDataItemNo ? itemData : null) ||
        (allItemsData?.items || []).find((item) => normalizeItemNo(item.item_no) === normalizedDataItemNo) ||
        null;
      let nextMasterItem = currentMasterItem;

      if (isRejected) {
        const correctedMasterItem = buildUpdatedMasterItemFromCorrections(currentMasterItem, rejectionItems);
        if (correctedMasterItem) {
          nextMasterItem = await updateItemMutation.mutateAsync({
            itemNo: currentMasterItem?.item_no || correctedMasterItem.item_no,
            data: correctedMasterItem,
          });
          queryClient.setQueryData(getGetItemQueryKey(correctedMasterItem.item_no), nextMasterItem);
        }

        const linkedWorkOrder = findLinkedWorkOrderForTi(currentTiNo, data, workOrderRecords);
        const correctedWorkOrder = buildUpdatedWorkOrderFromCorrections(linkedWorkOrder, rejectionItems);
        if (linkedWorkOrder && correctedWorkOrder) {
          await updateWorkOrderMutation.mutateAsync({
            id: linkedWorkOrder.id,
            data: correctedWorkOrder,
          });
        }
      }

      const mergedFormData = nextMasterItem
        ? mergeTiFormWithItemMaster(data, nextMasterItem, data.customer_name || "")
        : data;
      const workflowData: TiRecordInput = {
        ...mergedFormData,
        approval_status: "pending_check",
        created_by: mergedFormData.created_by || profile.initials,
        created_by_user_id: mergedFormData.created_by_user_id || profile.id,
        checked_by: "",
        checked_by_user_id: null,
        checked_at: null,
        approved_by: "",
        approved_by_user_id: null,
        approved_at: null,
        rejection_items: [],
      };
      if (isNewMode) {
        const res = await createTiMutation.mutateAsync({ data: { ...workflowData, ti_no: draftTiNo || undefined } });
        if (queuedWorkOrderId) {
          const remainingSummary = getPendingWorkOrderSummaryFromRecords(
            workOrderRecords,
            new Set([...existingTiNos, res.ti_no]),
            itemTiFormats
          );
          setQueuedWorkOrderId(null);
          setCurrentTiNo(res.ti_no);
          setEditedTiNo(res.ti_no);
          setDraftTiNo("");
          setIsNewMode(false);
          setIsEditMode(false);
          toast({
            title: "TI saved successfully",
            description:
              remainingSummary.fetchableCount > 0
                ? `${remainingSummary.fetchableCount} Work Order(s) are ready. Click Fetch WO when you want the next one.`
                : remainingSummary.blockedCount > 0
                  ? `${remainingSummary.blockedCount} non-standard Work Order(s) were skipped from the TI queue.`
                  : "No more Work Orders are waiting.",
          });
        } else {
          setCurrentTiNo(res.ti_no);
          setEditedTiNo(res.ti_no);
          setDraftTiNo("");
          setIsNewMode(false);
          setIsEditMode(false);
          toast({ title: "Record saved successfully" });
        }
      } else if (currentTiNo) {
        const nextTiNo = String(workflowData.ti_no || currentTiNo).trim();
        if (!nextTiNo) {
          toast({ variant: "destructive", title: "TI number is required" });
          return;
        }
        const updated = await updateTiMutation.mutateAsync({
          tiNo: currentTiNo,
          data: { ...workflowData, ti_no: nextTiNo },
        });
        setCurrentTiNo(updated.ti_no);
        setEditedTiNo(updated.ti_no);
        setItemNoInput(normalizeItemNo(updated.item_no || ""));
        setActiveItemNo(normalizeItemNo(updated.item_no || ""));
        setIsEditMode(false);
        form.reset(nextMasterItem ? mergeTiFormWithItemMaster(updated, nextMasterItem, updated.customer_name || "") : updated);
        toast({ title: "Record updated successfully" });
      }
      setFormErrors({});
      setRejectionItems([]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isTiPolicyError =
        errorMessage.includes("row-level security policy") && errorMessage.includes("ct_ti_records");
      toast({
        variant: "destructive",
        title: "Error saving record",
        description: isTiPolicyError
          ? "This login is not allowed to create TIs. Only an active User role can save a new TI. Check the profile role or sign out and sign in again."
          : errorMessage,
      });
    }
  };

  const handlePrev = () => {
    if (effectiveAdjacentData?.prev) {
      setDraftTiNo("");
      setCurrentTiNo(effectiveAdjacentData.prev);
      return;
    }
    if (!navigationTiNo && navigableTiRecords.length) {
      setDraftTiNo("");
      setCurrentTiNo(navigableTiRecords.at(-1)!.ti_no);
      return;
    }
    else toast({ title: "No previous record" });
  };
  const handleNext = () => {
    if (effectiveAdjacentData?.next) {
      setDraftTiNo("");
      setCurrentTiNo(effectiveAdjacentData.next);
      return;
    }
    if (!navigationTiNo && navigableTiRecords.length) {
      setDraftTiNo("");
      setCurrentTiNo(navigableTiRecords[0]!.ti_no);
      return;
    }
    else toast({ title: "No next record" });
  };

  const openSearchWithStatus = (status: ApprovalStatus | "all") => {
    setSearchStatusFilter(viewerOnlyChecked ? "checked" : status);
    setIsSearchModalOpen(true);
  };

  const handleDownloadPdf = async () => {
    if (!isChecked) {
      toast({ variant: "destructive", title: "TI is not checked", description: "PDF is available only after checking." });
      return;
    }
    try { await downloadTiPdf({ ...form.getValues(), ti_no: currentTiNo || draftTiNo || "" }); }
    catch (err) { toast({ title: "PDF failed", description: String(err), variant: "destructive" }); }
  };
  const handlePrintPdf = async () => {
    if (!isChecked) {
      toast({ variant: "destructive", title: "TI is not checked", description: "Print is available only after checking." });
      return;
    }
    try { await printTiPdf({ ...form.getValues(), ti_no: currentTiNo || draftTiNo || "" }); }
    catch (err) { toast({ title: "PDF failed", description: String(err), variant: "destructive" }); }
  };

  const handleDownloadLabels = async () => {
    if (!canUseLabels) return;
    if (!isChecked) {
      toast({ variant: "destructive", title: "TI is not checked", description: "Labels are available only after checking." });
      return;
    }
    setIsLabelEditorOpen(true);
  };

  const handleCheckTi = async () => {
    if (!currentTiNo || !userCanCheck || isChecked || isRejected) return;
    if (hasCorrectedRejectionItems) {
      toast({
        variant: "destructive",
        title: "Corrected fields added",
        description: "Reject this TI to save the corrected field notes, or clear them before checking.",
      });
      return;
    }
    try {
      const checked = await checkTiMutation.mutateAsync({ tiNo: currentTiNo });
      form.reset(checked);
      setRejectionItems([]);
      setCurrentTiNo(checked.ti_no);
      setEditedTiNo(checked.ti_no);
      setIsEditMode(false);
      setIsNewMode(false);
      toast({ title: "TI checked", description: "Print and PDF are now available." });
    } catch (error) {
      toast({ variant: "destructive", title: "Check failed", description: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleRejectTi = async () => {
    if (!currentTiNo || !userCanCheck || isChecked || isRejected) return;
    if (!hasCorrectedRejectionItems) {
      toast({
        variant: "destructive",
        title: "No corrected field added",
        description: "Enter at least one corrected value before rejecting this TI.",
      });
      return;
    }
    try {
      const rejected = await rejectTiMutation.mutateAsync({
        tiNo: currentTiNo,
        rejectionItems: correctedRejectionItems,
      });
      form.reset(rejected);
      setRejectionItems(normalizeRejectionItems(rejected.rejection_items));
      setCurrentTiNo(rejected.ti_no);
      setEditedTiNo(rejected.ti_no);
      setIsEditMode(false);
      setIsNewMode(false);
      toast({ title: "TI rejected", description: "Field-wise correction notes were saved with the rejected TI." });
    } catch (error) {
      toast({ variant: "destructive", title: "Reject failed", description: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleReopenTi = async () => {
    if (!currentTiNo || !userIsAdmin || !isLockedStatus) return;
    try {
      const reopened = await reopenTiMutation.mutateAsync({ tiNo: currentTiNo });
      form.reset(reopened);
      setRejectionItems([]);
      setCurrentTiNo(reopened.ti_no);
      setEditedTiNo(reopened.ti_no);
      setIsEditMode(false);
      setIsNewMode(false);
      toast({ title: "TI reopened", description: "The TI must be checked again before print/PDF." });
    } catch (error) {
      toast({ variant: "destructive", title: "Reopen failed", description: error instanceof Error ? error.message : String(error) });
    }
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

  // â”€â”€ Arrow-key navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const hideTopBar = isSearchModalOpen || isAddItemModalOpen || isAdminPanelOpen || isLabelEditorOpen;

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="w-[60px] bg-[#2a4080] flex flex-col items-center py-4 space-y-4 no-print shrink-0 fixed h-full z-10">
        {userCanWrite && <SidebarButton icon={<Save />} title="Save" onClick={handleSave} disabled={!isFormEnabled} />}
        {userCanWrite && <SidebarButton icon={<FilePlus />} title="New" onClick={handleNew} />}
        {userCanWrite && (
          <SidebarButton
            icon={<ClipboardList />}
            title="Fetch WO"
            onClick={handleFetchNextWorkOrder}
            badgeCount={pendingWorkOrderSummary.fetchableCount}
          />
        )}
        <SidebarButton icon={<Search />} title="Search" onClick={() => openSearchWithStatus("all")} />
        <SidebarButton icon={<ChevronLeft />} title="Prev" onClick={handlePrev} />
        <SidebarButton icon={<ChevronRight />} title="Next" onClick={handleNext} />
        {userCanWrite && <SidebarButton icon={<Edit3 />} title="Edit" onClick={handleEdit} disabled={!currentTiNo || isEditMode || isLockedStatus} />}
        {userCanCheck && <SidebarButton icon={<CheckCircle2 />} title="Check" onClick={handleCheckTi}
          disabled={!currentTiNo || isLockedStatus || isRejected || isEditMode || isNewMode || hasCorrectedRejectionItems || checkTiMutation.isPending} />}
        {userCanCheck && <SidebarButton icon={<XCircle />} title="Reject" onClick={handleRejectTi}
          disabled={!currentTiNo || isLockedStatus || isRejected || isEditMode || isNewMode || !hasCorrectedRejectionItems || rejectTiMutation.isPending} />}
        {userIsAdmin && <SidebarButton icon={<LockKeyhole />} title="Reopen" onClick={handleReopenTi} disabled={!currentTiNo || !isLockedStatus || reopenTiMutation.isPending} />}
        <SidebarButton icon={<Printer />} title="Print" onClick={handlePrintPdf} disabled={!isChecked} />
        <SidebarButton icon={<FileText />} title="PDF" onClick={handleDownloadPdf} disabled={!isChecked} />
        {canUseLabels && <SidebarButton icon={<Tags />} title="Labels" onClick={handleDownloadLabels} disabled={!isChecked} />}
        <div className="flex-1" />
        {userIsAdmin && <SidebarButton icon={<ShieldCheck />} title="Admin" onClick={() => setIsAdminPanelOpen(true)} />}
      </aside>
      <main className="ml-[60px] min-h-screen">
        {!hideTopBar && (
          <ProfileTopBar
            profile={profile}
            onLogout={onLogout}
            onModulesClick={onBackToModules}
            pendingCount={userCanCheck ? statusCounts.pending_check : 0}
            onPendingClick={userCanCheck ? () => openSearchWithStatus("pending_check") : undefined}
            rejectedCount={viewerOnlyChecked ? 0 : statusCounts.rejected}
            onRejectedClick={viewerOnlyChecked ? undefined : () => openSearchWithStatus("rejected")}
          />
        )}

          {/* Main */}
        <DrawingSplitLayout
          open={isDrawingViewerOpen}
          drawing={activeDrawing}
          onClose={() => setIsDrawingViewerOpen(false)}
        >
        <div id="ti-form" onFocusCapture={handleFormFocus} onKeyDown={handleFormKeyDown} className="px-6 py-6 flex justify-center">
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
              <div className="flex items-center space-x-2 px-3 py-1 rounded bg-white/20">
                <span className="text-sm font-semibold whitespace-nowrap">TI No:</span>
                <ReviewableFieldFrame review={getReviewConfig("ti_no", "TI No")} value={currentTiNo || editedTiNo || draftTiNo} compact>
                <span className="font-mono font-bold tracking-wider">
                  {currentTiNo || draftTiNo || "Fetch from Work Order"}
                </span>
                </ReviewableFieldFrame>
              </div>
              <div className="flex items-center space-x-2 justify-end">
                <span className="text-sm font-semibold">TI DATE:</span>
                <Controller name="ti_date" control={form.control} render={({ field }) => (
                  <ReviewableFieldFrame review={getReviewConfig("ti_date", "TI Date")} value={formatDisplayDate(field.value || "")} compact>
                  <FormattedDateInput
                    value={field.value || ""}
                    onChange={field.onChange}
                    disabled={(!isEditMode && !isNewMode) && !canManageRejectionItems}
                    readOnly={canManageRejectionItems}
                    className="w-40 bg-transparent border border-white/30 rounded px-3 py-1 text-sm outline-none text-white placeholder:text-blue-100/60 disabled:opacity-90"
                  />
                  </ReviewableFieldFrame>
                )} />
              </div>
              {hasPersistedTiRecord && (
                <div className="flex justify-end">
                  <span className={`inline-flex items-center rounded px-3 py-1 text-xs font-bold uppercase tracking-wide ${approvalStatusBadgeClass(currentApprovalStatus)}`}>
                    {approvalStatusLabel(currentApprovalStatus)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Form Content */}
          <div className="p-6 space-y-8">
            {/* Item Number */}
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-md">
              <Label className="text-lg font-bold text-[#2a4080] mb-2 block">Item Number</Label>
              <div className="flex space-x-2">
                <ReviewableFieldFrame review={getReviewConfig("item_no", "Item Number")} value={itemNoInput}>
                  <Input value={itemNoInput}
                    onChange={e => {
                      if (canManageRejectionItems) return;
                      setItemNoInput(e.target.value);
                      form.setValue("item_no", e.target.value);
                    }}
                    onBlur={() => { if (!canManageRejectionItems) handleItemSearch(); }}
                    onKeyDown={(event) => { if (!canManageRejectionItems) handleItemNoKeyDown(event); }}
                    readOnly={canManageRejectionItems}
                    placeholder="Enter numeric item number..."
                    className={`text-lg py-6 max-w-sm border-[#4a6fa5] focus-visible:ring-[#4a6fa5] ${canManageRejectionItems ? "pr-16" : ""} ${reviewInputStateClass(getReviewConfig("item_no", "Item Number"), itemNoInput)}`}
                    disabled={!canManageRejectionItems && (!userCanWrite || (!isNewMode && !isEditMode))} />
                </ReviewableFieldFrame>
                <Button onClick={() => handleItemSearch("customer_name")} className="bg-[#4a6fa5] hover:bg-[#3b5fc0] h-auto px-6"
                  disabled={!userCanWrite || (!isNewMode && !isEditMode)}>Load Item</Button>
                {userCanWrite && (
                  <Button onClick={handleEditItem} variant="outline" className="h-auto px-6 border-[#4a6fa5] text-[#4a6fa5] hover:bg-[#4a6fa5] hover:text-white"
                    disabled={!itemData}>Edit Item</Button>
                )}
                {activeDrawing && (
                  <Button
                    type="button"
                    onClick={() => setIsDrawingViewerOpen((open) => !open)}
                    variant="outline"
                    title={isDrawingViewerOpen ? "Hide drawing" : "See drawing"}
                    className={`h-auto px-3 border-[#4a6fa5] text-[#2a4080] hover:bg-[#4a6fa5] hover:text-white ${
                      isDrawingViewerOpen ? "bg-[#2a4080] text-white hover:bg-[#1a2850]" : ""
                    }`}
                  >
                    {isDrawingViewerOpen ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    <span className="ml-2 text-xs font-bold uppercase tracking-wide">
                      {isDrawingViewerOpen ? "Hide DRG" : "See DRG"}
                    </span>
                  </Button>
                )}
              </div>
              {isItemError && <p className="text-red-500 text-sm mt-2 font-medium">Item not found. Please add it.</p>}
              {isNonStandardItem && <p className="text-red-500 text-sm mt-2 font-medium">This item uses a different TI format and cannot be created in this screen.</p>}
            </div>

            {/* All sections â€” always full opacity, never greyed */}
            <div className={`space-y-8 ${fieldDisabled && rejectionItems.length === 0 ? "pointer-events-none" : ""}`}>

              {/* Customer Details */}
              <section>
                <SectionHeader title="CUSTOMER DETAILS" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {/* Customer Name â€” autocomplete from history, editable */}
                  <AutocompleteField
                    form={form} name="customer_name" label="Customer Name" required
                    options={distinctCustomers} disabled={!isFormEnabled}
                    review={getReviewConfig("customer_name", "Customer Name")}
                    error={formErrors["customer_name"]}
                  />
                  <FormField form={form} name="cust_part_code" label="Cust. Part Name/Item No." disabled={!isFormEnabled} review={getReviewConfig("cust_part_code", "Cust. Part Name/Item No.")} />
                  {/* Customer Order No â€” suggestion dropdown on 3+ chars */}
                  <SuggestionField
                    form={form} name="cus_order_no" label="Customer Order No." required
                    fetchField="cus_order_no" disabled={!isFormEnabled}
                    review={getReviewConfig("cus_order_no", "Customer Order No.")}
                    error={formErrors["cus_order_no"]}
                  />
                  <DateFormField form={form} name="cus_order_date" label="Customer Order Date" required
                    disabled={!isFormEnabled} review={getReviewConfig("cus_order_date", "Customer Order Date")} error={formErrors["cus_order_date"]} />
                </div>
              </section>

              {/* Order Details */}
              <section>
                <SectionHeader title="ORDER DETAILS" />
                <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                  {/* W.O. Number â€” suggestion dropdown */}
                  <SuggestionField
                    form={form} name="wo_number" label="W.O. Number" required
                    fetchField="wo_number" disabled={!isFormEnabled}
                    review={getReviewConfig("wo_number", "W.O. Number")}
                    error={formErrors["wo_number"]}
                  />
                  {/* CT Type â€” auto-dropdown from history, free-type */}
                  <AutocompleteField
                    form={form} name="ct_type" label="CT Type"
                    options={distinctCtTypes} disabled={!isFormEnabled}
                    review={getReviewConfig("ct_type", "CT Type")}
                  />
                  <FormField form={form} name="po_item_no" label="PO Item No." required
                    disabled={!isFormEnabled} review={getReviewConfig("po_item_no", "PO Item No.")} error={formErrors["po_item_no"]} />
                  {/* Serial Number â€” suggestion dropdown */}
                  <SuggestionField
                    form={form} name="serial_number" label="Serial Number"
                    fetchField="serial_number" disabled={!isFormEnabled}
                    review={getReviewConfig("serial_number", "Serial Number")}
                  />
                  {/* Quantity */}
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
                      Quantity {REQ}
                    </label>
                    <div className="flex">
                      <Controller name="quantity" control={form.control} render={({ field }) => (
                        <ReviewableFieldFrame review={getReviewConfig("quantity", "Quantity")} value={field.value}>
                          <Input {...field} value={field.value || ""} disabled={fieldDisabled} readOnly={canManageRejectionItems}
                            className={`rounded-r-none border-r-0 bg-gray-50 ${canManageRejectionItems ? "pr-16" : ""} ${reviewInputStateClass(getReviewConfig("quantity", "Quantity"), field.value)} ${formErrors["quantity"] ? "border-red-400" : ""}`} />
                        </ReviewableFieldFrame>
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
                  <FormField form={form} name="ratio"            label="Ratio"          disabled={!isFormEnabled} review={getReviewConfig("ratio", "Ratio")} />
                  <FormField form={form} name="rated_voltage"    label="Rated Voltage"  disabled={!isFormEnabled} review={getReviewConfig("rated_voltage", "Rated Voltage")} />
                  <FormField form={form} name="stc"              label="STC"            disabled={!isFormEnabled} review={getReviewConfig("stc", "STC")} />
                  <FormField form={form} name="insulation_level" label="I.L."           disabled={!isFormEnabled} review={getReviewConfig("insulation_level", "I.L.")} />
                  <FormField form={form} name="frequency"        label="Frequency"      disabled={!isFormEnabled} review={getReviewConfig("frequency", "Frequency")} />
                  <FormField form={form} name="ref_std"          label="Ref. Std."      disabled={!isFormEnabled} review={getReviewConfig("ref_std", "Ref. Std.")} />
                </div>
              </section>

              {/* Core Particulars */}
              <section>
                <SectionHeader title="CORE PARTICULARS" />
                <div className="overflow-visible border border-[#dee2e6] rounded-md">
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
                                    disabled={!isFormEnabled} gridRow={idx} gridCol={colIdx}
                                    review={getReviewConfig(`${coreKey}.${row.key}`, `${row.label} - Core ${colIdx + 1}`)} />
                                ) : (
                                  <TableInput form={form} name={`${coreKey}.${row.key}`}
                                    disabled={!isFormEnabled} gridRow={idx} gridCol={colIdx}
                                    review={getReviewConfig(`${coreKey}.${row.key}`, `${row.label} - Core ${colIdx + 1}`)} />
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
                  <FormField form={form} name="ct_final_dim" label="CT Final Dim" disabled={!isFormEnabled} dataField="ct_final_dim" review={getReviewConfig("ct_final_dim", "CT Final Dim")} />
                  <FormField form={form} name="ga_drg"        label="GA Drg"      disabled={!isFormEnabled} review={getReviewConfig("ga_drg", "GA Drg")} />
                  <FormField form={form} name="ins_class"     label="INS Class"   disabled={!isFormEnabled} review={getReviewConfig("ins_class", "INS Class")} />
                  <FormField form={form} name="ref_ti"        label="Ref TI"      disabled={!isFormEnabled} review={getReviewConfig("ref_ti", "Ref TI")} />
                  <FormField form={form} name="pri_turns"     label="PRI Turns"   disabled={!isFormEnabled} review={getReviewConfig("pri_turns", "PRI Turns")} />
                  <FormField form={form} name="pri_copper"    label="PRI Copper"  disabled={!isFormEnabled} review={getReviewConfig("pri_copper", "PRI Copper")} />
                  <FormField form={form} name="former"        label="Former"      disabled={!isFormEnabled} review={getReviewConfig("former", "Former")} />
                  <FormField form={form} name="pri_length"    label="PRI Length"  disabled={!isFormEnabled} review={getReviewConfig("pri_length", "PRI Length")} />
                  <FormField form={form} name="pri_weight"    label="PRI Weight"  disabled={!isFormEnabled} review={getReviewConfig("pri_weight", "PRI Weight")} />
                  <FormField form={form} name="sec_terminal"  label="Sec. Terminal" disabled={!isFormEnabled} review={getReviewConfig("sec_terminal", "Sec. Terminal")} />
                  <FormField form={form} name="total_weight"  label="Total Weight"  disabled={!isFormEnabled} review={getReviewConfig("total_weight", "Total Weight")} />
                </div>
              </section>

              {/* Notes */}
              <section>
                <SectionHeader title="NOTES & REVISION" />
                <div className="grid grid-cols-4 gap-4">
                  <FormField form={form} name="rev_no" label="Rev No." disabled={!isFormEnabled} review={getReviewConfig("rev_no", "Rev No.")} />
                  <div className="col-span-3 space-y-1">
                    <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Note</label>
                    <Controller name="note" control={form.control} render={({ field }) => (
                      <ReviewableFieldFrame review={getReviewConfig("note", "Note")} value={field.value}>
                        <textarea {...field} value={field.value || ""} disabled={fieldDisabled} readOnly={canManageRejectionItems} rows={3}
                          className={`w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900 resize-none ${canManageRejectionItems ? "pr-16" : ""} ${reviewInputStateClass(getReviewConfig("note", "Note"), field.value)}`} />
                      </ReviewableFieldFrame>
                    )} />
                  </div>
                </div>
              </section>

              {/* Signatures â€” always editable, persist via localStorage */}
              <section className="pb-8">
                <SectionHeader title="SIGNATURES" />
                <div className="grid grid-cols-3 gap-6">
                  {(["approved_by", "checked_by", "created_by"] as const).map((fieldName, i) => {
                    const labels = ["Approved By", "Checked By", "Created By"];
                    return (
                      <div key={fieldName} className="space-y-1">
                        <label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">{labels[i]}</label>
                        <Controller name={fieldName} control={form.control} render={({ field }) => (
                          <Input {...field} value={field.value || ""}
                            disabled
                            className="h-9 bg-gray-50 border-gray-300 text-gray-800"
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
        </DrawingSplitLayout>
      </main>

      <SearchModal open={isSearchModalOpen} onOpenChange={setIsSearchModalOpen}
        statusFilter={viewerOnlyChecked ? "checked" : searchStatusFilter}
        canEditRecords={userCanWrite}
        onSelect={tiNo => {
          pendingSearchEditRef.current = null;
          setCurrentTiNo(tiNo);
          setIsSearchModalOpen(false);
        }}
        onEdit={userCanWrite ? tiNo => {
          if (tiNo === currentTiNo) {
            setIsEditMode(true);
            setIsSearchModalOpen(false);
            return;
          }
          pendingSearchEditRef.current = tiNo;
          setCurrentTiNo(tiNo);
          setIsSearchModalOpen(false);
        } : undefined} />
      <AddItemModal open={isAddItemModalOpen} onOpenChange={setIsAddItemModalOpen} itemNo={activeItemNo}
        mode={itemModalMode} itemData={itemData || null}
        onSuccess={(savedItem) => {
          const savedItemNo = normalizeItemNo(savedItem.item_no || activeItemNo);
          if (savedItemNo) {
            queryClient.setQueryData(getGetItemQueryKey(savedItemNo), savedItem);
            setItemNoInput(savedItemNo);
            setActiveItemNo(savedItemNo);
            form.setValue("item_no", savedItemNo, { shouldDirty: true });
          }
          if (isNewMode || isEditMode) {
            const current = form.getValues();
            form.reset(mergeTiFormWithItemMaster(
              { ...current, item_no: savedItemNo || current.item_no },
              savedItem,
              current.customer_name || ""
            ));
          }
          queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(savedItemNo || activeItemNo) });
          queryClient.invalidateQueries({ queryKey: ["items"] });
          setIsAddItemModalOpen(false);
        }} />
      {userIsAdmin && (
        <AdminPanel open={isAdminPanelOpen} onOpenChange={setIsAdminPanelOpen} />
      )}
      <TiLabelEditorDialog
        open={isLabelEditorOpen}
        onOpenChange={setIsLabelEditorOpen}
        data={{ ...form.getValues(), ti_no: currentTiNo || draftTiNo || "" }}
      />
    </div>
  );
}

type ActiveItemDrawing = {
  url: string;
  fileName: string;
  contentType: string;
};

function getActiveItemDrawing(
  activeItemNo: string,
  itemNoInput: string,
  watchedItemNo: string | undefined,
  itemData: Partial<ItemInput> | null | undefined,
  items: Array<Partial<ItemInput>>
): ActiveItemDrawing | null {
  const targetItemNo = normalizeItemNo(activeItemNo || itemNoInput || watchedItemNo || itemData?.item_no);
  if (!targetItemNo) return null;

  const candidates = [itemData, ...items].filter(Boolean) as Array<Partial<ItemInput>>;
  const item = candidates.find((candidate) => {
    return normalizeItemNo(candidate.item_no) === targetItemNo && String(candidate.drawing_url || "").trim();
  });
  const drawingUrl = String(item?.drawing_url || "").trim();
  if (!drawingUrl) return null;

  return {
    url: drawingUrl,
    fileName: String(item?.drawing_file_name || item?.ga_drg || `${targetItemNo} drawing`).trim(),
    contentType: String(item?.drawing_content_type || "").trim(),
  };
}

function DrawingSplitLayout({
  open,
  drawing,
  onClose,
  children,
}: {
  open: boolean;
  drawing: ActiveItemDrawing | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open || !drawing) return <>{children}</>;

  return (
    <ResizablePanelGroup direction="horizontal" className="h-[calc(100vh-3.5rem)] min-h-[640px] bg-gray-100">
      <ResizablePanel defaultSize={58} minSize={34} className="min-w-0 overflow-y-auto">
        {children}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        className="w-2 bg-[#d8e4f8] transition-colors hover:bg-[#b9cff4] data-[resize-handle-state=drag]:bg-[#4a6fa5]"
      />
      <ResizablePanel defaultSize={42} minSize={26} className="min-w-[320px]">
        <DrawingViewerPanel drawing={drawing} onClose={onClose} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function DrawingViewerPanel({ drawing, onClose }: { drawing: ActiveItemDrawing; onClose: () => void }) {
  const isPdf = isPdfDrawing(drawing);

  return (
    <section className="flex h-full min-h-0 flex-col border-l border-gray-200 bg-white">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-gray-200 px-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-[#20366f]" title={drawing.fileName}>
            {drawing.fileName}
          </div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">DRG Preview</div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          className="h-9 border-[#4a6fa5] px-3 text-[#2a4080] hover:bg-[#4a6fa5] hover:text-white"
          title="Hide drawing"
        >
          <EyeOff className="h-4 w-4" />
          <span className="ml-2 text-xs font-bold uppercase tracking-wide">Hide DRG</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 bg-gray-100">
        {isPdf ? (
          <iframe title={`Drawing ${drawing.fileName}`} src={drawing.url} className="h-full w-full border-0 bg-white" />
        ) : (
          <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
            <img src={drawing.url} alt={drawing.fileName} className="max-h-full max-w-full object-contain" />
          </div>
        )}
      </div>
    </section>
  );
}

function isPdfDrawing(drawing: ActiveItemDrawing): boolean {
  const contentType = drawing.contentType.toLowerCase();
  const path = drawing.url.split("?")[0].toLowerCase();
  return contentType.includes("pdf") || path.endsWith(".pdf");
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// REUSABLE COMPONENTS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizeRejectionItems(value: unknown): RejectionItem[] {
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item, index) => ({
      id: typeof item.id === "string" ? item.id : `rejection-${index}`,
      field_path: typeof item.field_path === "string" ? item.field_path : "",
      field_label: typeof item.field_label === "string" ? item.field_label : "Field",
      field_value: typeof item.field_value === "string" ? item.field_value : stringifyFieldValue(item.field_value),
      corrected_value: typeof item.corrected_value === "string" ? item.corrected_value : stringifyFieldValue(item.corrected_value),
    }))
    .filter((item) => item.field_path || item.field_label);
}

function cloneTiRecordInput(data: TiRecordInput): TiRecordInput {
  return {
    ...data,
    core1: { ...(data.core1 || {}) },
    core2: { ...(data.core2 || {}) },
    core3: { ...(data.core3 || {}) },
  };
}

function applyNestedRecordValue(target: Record<string, unknown>, path: string, value: string) {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
}

function normalizeCorrectedRejectionValue(item: RejectionItem): string {
  const correctedValue = String(item.corrected_value || "").trim();
  if (item.field_path === "ti_date" || item.field_path === "cus_order_date") {
    const parsedDate = parseDisplayDate(correctedValue);
    if (parsedDate === null) {
      throw new Error(`Corrected ${item.field_label} must be a valid date.`);
    }
    return parsedDate;
  }

  return String(item.corrected_value || "");
}

function isItemMasterCorrectionPath(path: string): boolean {
  const root = path.split(".")[0];
  return ITEM_MASTER_FIELD_ROOTS.has(path) || ITEM_MASTER_FIELD_ROOTS.has(root);
}

function isWritableItemMasterCorrectionPath(path: string): boolean {
  const root = path.split(".")[0];
  return isItemMasterCorrectionPath(path) && !["id", "created_at", "updated_at"].includes(root);
}

function applyTiCorrectionsFromRejections(
  data: TiRecordInput,
  corrections: RejectionItem[]
): TiRecordInput {
  const relevantCorrections = corrections.filter((item) => {
    const correctedValue = String(item.corrected_value || "").trim();
    return correctedValue;
  });
  if (!relevantCorrections.length) return data;

  const nextData = cloneTiRecordInput(data);
  relevantCorrections.forEach((item) => {
    applyNestedRecordValue(
      nextData as unknown as Record<string, unknown>,
      item.field_path,
      normalizeCorrectedRejectionValue(item)
    );
  });

  return nextData;
}

function buildUpdatedMasterItemFromCorrections(
  baseItem: ItemInput | null | undefined,
  corrections: RejectionItem[]
): ItemInput | null {
  if (!baseItem?.item_no) return null;

  const relevantCorrections = corrections.filter((item) => {
    const correctedValue = String(item.corrected_value || "").trim();
    return correctedValue && isWritableItemMasterCorrectionPath(item.field_path);
  });
  if (!relevantCorrections.length) return null;

  const nextItem: ItemInput = {
    ...baseItem,
    core1: { ...(baseItem.core1 || {}) },
    core2: { ...(baseItem.core2 || {}) },
    core3: { ...(baseItem.core3 || {}) },
  };

  relevantCorrections.forEach((item) => {
    applyNestedRecordValue(
      nextItem as unknown as Record<string, unknown>,
      item.field_path,
      normalizeCorrectedRejectionValue(item)
    );
  });

  return nextItem;
}

function findLinkedWorkOrderForTi(
  currentTiNo: string | null,
  data: TiRecordInput,
  records: WorkOrderRecord[]
): WorkOrderRecord | null {
  const tiNo = String(currentTiNo || data.ti_no || "").trim();
  if (tiNo) {
    const byTiNo = records.find((record) => record.ti_no === tiNo);
    if (byTiNo) return byTiNo;
  }

  const workOrderNo = String(data.wo_number || "").trim();
  const itemNo = normalizeItemNo(data.item_no || "");
  if (!workOrderNo || !itemNo) return null;

  return (
    records.find(
      (record) =>
        String(record.work_order || "").trim() === workOrderNo &&
        normalizeItemNo(record.our_item_code) === itemNo
    ) || null
  );
}

function buildUpdatedWorkOrderFromCorrections(
  baseWorkOrder: WorkOrderRecord | null | undefined,
  corrections: RejectionItem[]
): WorkOrderInput | null {
  if (!baseWorkOrder) return null;

  const relevantCorrections = corrections.filter((item) => {
    const correctedValue = String(item.corrected_value || "").trim();
    return (
      correctedValue &&
      (!isItemMasterCorrectionPath(item.field_path) || MIRRORED_ITEM_WORK_ORDER_PATHS.has(item.field_path)) &&
      WORK_ORDER_REJECTION_FIELD_MAP[item.field_path]
    );
  });
  if (!relevantCorrections.length) return null;

  const nextWorkOrder = workOrderRecordToInput(baseWorkOrder);
  relevantCorrections.forEach((item) => {
    const workOrderField = WORK_ORDER_REJECTION_FIELD_MAP[item.field_path];
    (nextWorkOrder as unknown as Record<string, unknown>)[workOrderField] = normalizeCorrectedRejectionValue(item);
  });

  return nextWorkOrder;
}

function workOrderRecordToInput(record: WorkOrderRecord): WorkOrderInput {
  return {
    work_order: record.work_order || "",
    customer: record.customer || "",
    po_no: record.po_no || "",
    po_date: record.po_date || "",
    po_line_no: record.po_line_no || "",
    item_code: record.item_code || "",
    our_item_code: record.our_item_code || "",
    specification: record.specification || "",
    qty: record.qty || "",
    sr_no: record.sr_no || "",
    ti_no: record.ti_no || "",
    traceability_sr_no: record.traceability_sr_no || "",
    created_by: record.created_by || "",
    created_by_user_id: record.created_by_user_id || null,
  };
}

function getRecordFieldValue(record: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[part];
  }, record);

  if (path === "ti_date" || path === "cus_order_date") {
    return formatDisplayDate(typeof value === "string" ? value : "") || stringifyFieldValue(value);
  }
  return stringifyFieldValue(value);
}

function stringifyFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function comparableFieldValue(value: unknown): string {
  return stringifyFieldValue(value).trim().replace(/\s+/g, " ").toUpperCase();
}

function isCorrectedFieldValue(review: FieldReviewConfig | undefined, value: unknown): boolean {
  const correctedValue = comparableFieldValue(review?.item?.corrected_value);
  if (!review?.item || !correctedValue) return false;
  return comparableFieldValue(value) === correctedValue;
}

function reviewInputStateClass(review: FieldReviewConfig | undefined, value: unknown): string {
  if (!review?.item) return "";
  return isCorrectedFieldValue(review, value)
    ? "border-emerald-300 bg-emerald-50/80"
    : "border-red-300 bg-red-50/70";
}

function reviewTableStateClass(review: FieldReviewConfig | undefined, value: unknown): string {
  if (!review?.item) return "";
  return isCorrectedFieldValue(review, value)
    ? "bg-emerald-50/90 text-emerald-950"
    : "bg-red-50/80 text-red-950";
}

type FieldReviewConfig = {
  path: string;
  label: string;
  item?: RejectionItem;
  editable: boolean;
  onMark: (path: string, label: string, fieldValue: string) => void;
  onUpdate: (path: string, correctedValue: string) => void;
  onRemove: (path: string) => void;
};

function ReviewableFieldFrame({
  review,
  value,
  children,
  compact = false,
}: {
  review?: FieldReviewConfig;
  value: unknown;
  children: React.ReactNode;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const fieldValue = stringifyFieldValue(value);
  const isMarked = Boolean(review?.item);
  const correctedValue = review?.item?.corrected_value || "";
  const canEditCorrection = Boolean(review?.editable);

  const markField = () => {
    if (!review) return;
    review.onMark(review.path, review.label, fieldValue);
    setOpen(true);
  };

  if (!review) return <>{children}</>;

  return (
    <div className="group relative">
      {children}
      {canEditCorrection && (
      <div className={`absolute z-20 flex items-center gap-1 transition-opacity ${
        open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
      } ${compact ? "right-1 top-1" : "right-1 top-1/2 -translate-y-1/2"}`}>
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(event) => event.preventDefault()}
          onClick={markField}
          className="inline-flex h-6 w-6 items-center justify-center bg-transparent text-slate-500 transition-colors hover:text-red-600 focus-visible:outline-none"
          title={isMarked ? "Edit correction" : "Mark this field wrong"}
          aria-label={isMarked ? "Edit correction" : "Mark this field wrong"}
        >
          <X className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </button>
        {isMarked && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen(true)}
            className="inline-flex h-6 w-6 items-center justify-center bg-transparent text-lg leading-none text-slate-500 transition-colors hover:text-red-600 focus-visible:outline-none"
            title="Enter corrected value"
            aria-label="Enter corrected value"
          >
            +
          </button>
        )}
      </div>
      )}

      {isMarked && correctedValue.trim() && !open && (
        <div className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden max-w-sm rounded-md border border-gray-200 bg-white px-3 py-2 text-left text-xs shadow-lg group-hover:block group-focus-within:block">
          <div className="font-semibold uppercase tracking-wide text-[#2a4080]">Corrected Value</div>
          <div className="mt-1 whitespace-pre-wrap break-words text-gray-800">{correctedValue}</div>
        </div>
      )}

      {canEditCorrection && open && isMarked && review.item && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-md border border-gray-200 bg-white p-3 text-left shadow-xl">
          <div className="mb-2">
            <p className="text-xs font-bold uppercase tracking-wider text-[#2a4080]">{review.label}</p>
            <p className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 break-words">
              {fieldValue || "-"}
            </p>
          </div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-gray-600">Corrected Value</Label>
          <Input
            value={correctedValue}
            onChange={(event) => review.onUpdate(review.path, event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Enter corrected value..."
            className="mt-1 h-9 border-gray-300 bg-gray-50 focus-visible:ring-[#4a6fa5]"
            autoFocus
          />
          <div className="mt-3 flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                review.onRemove(review.path);
                setOpen(false);
              }}
              className="h-8 border-gray-300 px-3 text-xs text-gray-700 hover:bg-gray-50"
            >
              Remove
            </Button>
            <Button
              type="button"
              onClick={() => setOpen(false)}
              className="h-8 bg-[#2a4080] px-4 text-xs hover:bg-[#243872]"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RejectionPad({
  items,
  editable,
  onUpdateItem,
  onRemoveItem,
}: {
  items: RejectionItem[];
  editable: boolean;
  onUpdateItem: (id: string | undefined, index: number, correctedValue: string) => void;
  onRemoveItem: (id: string | undefined, index: number) => void;
}) {
  return (
    <section className="rounded-md border border-red-200 bg-red-50/50 p-4">
      <div className="mb-3 flex items-center gap-2 text-red-800">
        <ClipboardList className="h-5 w-5" />
        <h3 className="text-sm font-bold uppercase tracking-wide">Rejected Field Correction Pad</h3>
        <span className="ml-auto rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-red-700 shadow-sm">
          {items.length} field{items.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-red-100 bg-white">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-red-700 text-white">
            <tr>
              <th className="w-[7%] px-3 py-2 font-semibold">Sr.</th>
              <th className="w-[25%] px-3 py-2 font-semibold">Field Name</th>
              <th className="w-[28%] px-3 py-2 font-semibold">Field Value</th>
              <th className="px-3 py-2 font-semibold">Corrected Value</th>
              {editable && <th className="w-[8%] px-3 py-2 font-semibold">Remove</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-red-100">
            {items.map((item, index) => (
              <tr key={item.id || `${item.field_path}-${index}`} className="align-top">
                <td className="px-3 py-2 font-semibold text-gray-700">{index + 1}</td>
                <td className="px-3 py-2 text-gray-800">{item.field_label}</td>
                <td className="px-3 py-2 text-gray-600 break-words">{item.field_value || "-"}</td>
                <td className="px-3 py-2">
                  {editable ? (
                    <Input
                      value={item.corrected_value || ""}
                      onChange={(event) => onUpdateItem(item.id, index, event.target.value)}
                      className="h-8 bg-gray-50"
                    />
                  ) : (
                    <span className="text-gray-900 break-words">{item.corrected_value || "-"}</span>
                  )}
                </td>
                {editable && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onRemoveItem(item.id, index)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={editable ? 5 : 4} className="px-3 py-5 text-center text-sm text-gray-500">
                  {editable
                    ? "Tab through the TI and mark wrong fields using the red icon beside each field."
                    : "No rejected fields added yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SidebarButton({
  icon,
  title,
  onClick,
  disabled,
  badgeCount,
}: {
  icon: React.ReactNode;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  badgeCount?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`relative w-12 h-12 flex flex-col items-center justify-center rounded-md transition-colors group ${
        disabled
          ? "text-white/30 cursor-not-allowed"
          : "text-white/80 hover:text-white hover:bg-white/10"
      }`}
    >
      {typeof badgeCount === "number" && (
        <span className={`absolute -right-1 -top-1 min-w-5 rounded-full border border-[#2a4080] px-1 text-center text-[10px] font-bold leading-5 shadow-sm ${
          badgeCount > 0 ? "bg-amber-400 text-[#20366f]" : "bg-white/15 text-white/70"
        }`}>
          {badgeCount}
        </span>
      )}
      <span className={`mb-1 [&>svg]:h-5 [&>svg]:w-5 transition-transform ${!disabled ? "group-hover:scale-110" : ""}`}>
        {icon}
      </span>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}

function approvalStatusLabel(status?: ApprovalStatus | null): string {
  if (status === "checked") return "Checked";
  if (status === "rejected") return "Rejected";
  return "Pending Check";
}

function approvalStatusBadgeClass(status?: ApprovalStatus | null): string {
  if (status === "checked") return "bg-emerald-100 text-emerald-800";
  if (status === "rejected") return "bg-red-100 text-red-800";
  return "bg-amber-100 text-amber-800";
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="bg-blue-50/80 border-l-4 border-[#4a6fa5] py-2 px-4 mb-4">
      <h3 className="text-[#4a6fa5] font-bold tracking-wide text-sm">{title}</h3>
    </div>
  );
}

function FormField({ form, name, label, type = "text", disabled, dataField, required, error, review }: {
  form: any; name: string; label: string; type?: string;
  disabled?: boolean; dataField?: string; required?: boolean; error?: string; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <Controller name={name} control={form.control} render={({ field }) => (
        <ReviewableFieldFrame review={review} value={field.value}>
          <Input {...field} type={type} value={field.value || ""} disabled={effectiveDisabled} readOnly={reviewMode} data-field={dataField}
            onChange={(event) => {
              if (reviewMode) return;
              field.onChange(event);
              if (name === "ratio") {
                expandRatioByCore(event.target.value).forEach((coreRatio, index) => {
                  const coreKey = `core${index + 1}`;
                  form.setValue(`${coreKey}.ratio`, coreRatio, { shouldDirty: true });
                  applyTapTurnCalculation(form, coreKey, coreRatio, form.getValues("pri_turns"));
                });
              }
              if (name !== "pri_turns") return;
              (["core1", "core2", "core3"] as const).forEach((coreKey) => {
                applyTapTurnCalculation(form, coreKey, form.getValues(`${coreKey}.ratio`), event.target.value);
              });
            }}
            className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900 ${reviewMode ? "pr-16" : ""} ${reviewInputStateClass(review, field.value)} ${error ? "border-red-400" : ""}`} />
        </ReviewableFieldFrame>
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
    </div>
  );
}

function DateFormField({ form, name, label, disabled, required, error, review }: {
  form: any; name: string; label: string; disabled?: boolean; required?: boolean; error?: string; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  return (
    <div className="space-y-1">
      <Label className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </Label>
      <Controller name={name} control={form.control} render={({ field }) => (
        <ReviewableFieldFrame review={review} value={formatDisplayDate(field.value || "")}>
          <FormattedDateInput
            value={field.value || ""}
            onChange={field.onChange}
            disabled={effectiveDisabled}
            readOnly={reviewMode}
            className={`h-9 w-full rounded-md border bg-gray-50 px-3 text-sm outline-none focus:ring-1 focus:ring-[#4a6fa5] disabled:text-gray-900 disabled:opacity-100 ${reviewMode ? "pr-16" : ""} ${reviewInputStateClass(review, formatDisplayDate(field.value || ""))} ${error ? "border-red-400" : "border-gray-300"}`}
          />
        </ReviewableFieldFrame>
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
    </div>
  );
}

function FormattedDateInput({ value, onChange, disabled, readOnly, className }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(formatDisplayDate(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayValue(formatDisplayDate(value));
  }, [value]);

  const commit = () => {
    if (readOnly) return;
    const parsed = parseDisplayDate(displayValue);
    if (parsed !== null) {
      onChange(parsed);
      setDisplayValue(formatDisplayDate(parsed));
    } else {
      setDisplayValue(formatDisplayDate(value));
    }
  };

  return (
    <div className="relative">
      <input
        type="text"
        value={displayValue}
        disabled={disabled}
        readOnly={readOnly}
        placeholder="DD-MMM-YYYY"
        onChange={(event) => {
          if (readOnly) return;
          setDisplayValue(event.target.value);
        }}
        onBlur={commit}
        className={`${className || ""} ${disabled || readOnly ? "" : "pr-9"}`}
      />
      <button
        type="button"
        disabled={disabled || readOnly}
        title="Choose date"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const picker = pickerRef.current;
          if (!picker) return;
          if (typeof picker.showPicker === "function") picker.showPicker();
          else picker.click();
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-current opacity-70 hover:opacity-100 disabled:hidden"
      >
        <CalendarDays className="w-4 h-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value || ""}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          if (readOnly) return;
          onChange(event.target.value);
          setDisplayValue(formatDisplayDate(event.target.value));
        }}
        className="absolute right-1 top-1/2 w-1 h-1 opacity-0 pointer-events-none"
      />
    </div>
  );
}

/**
 * AutocompleteField â€” free-type input with dropdown from historical data.
 * Shows all options on focus if field empty, or filters as you type.
 * Used for: Customer Name, CT Type
 */
function AutocompleteField({ form, name, label, options, disabled, required, error, review }: {
  form: any; name: string; label: string; options: string[];
  disabled?: boolean; required?: boolean; error?: string; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const fieldValue = useWatch({ control: form.control, name });

  // Sync query with form value
  useEffect(() => { setQuery(fieldValue || ""); }, [fieldValue]);

  const filtered = options.filter(o => !query || o.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    setActiveIndex(filtered.length ? 0 : -1);
  }, [query, open, filtered.length]);

  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-dropdown-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

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
        <ReviewableFieldFrame review={review} value={field.value}>
          <Input {...field} value={field.value || ""} disabled={effectiveDisabled} readOnly={reviewMode}
            className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900 ${reviewMode ? "pr-16" : ""} ${reviewInputStateClass(review, field.value)} ${error ? "border-red-400" : ""}`}
            autoComplete="off"
            onFocus={() => { if (!effectiveDisabled && !reviewMode) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 100)}
            onChange={e => {
              if (reviewMode) return;
              field.onChange(e.target.value);
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={e => {
              if (reviewMode) return;
              if (e.key === "ArrowDown" && filtered.length) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
                setActiveIndex(index => index < filtered.length - 1 ? index + 1 : 0);
              } else if (e.key === "ArrowUp" && filtered.length) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
                setActiveIndex(index => index > 0 ? index - 1 : filtered.length - 1);
              } else if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
                e.preventDefault();
                form.setValue(name, filtered[activeIndex], { shouldDirty: true });
                setQuery(filtered[activeIndex]);
                setOpen(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </ReviewableFieldFrame>
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      {open && !effectiveDisabled && !reviewMode && filtered.length > 0 && (
        <ul className="absolute z-50 mt-0.5 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-44 overflow-y-auto text-sm">
          {filtered.map((opt, index) => (
            <li key={opt}
              data-dropdown-index={index}
              onMouseDown={e => { e.preventDefault(); form.setValue(name, opt, { shouldDirty: true }); setQuery(opt); setOpen(false); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                index === activeIndex ? "bg-[#4a6fa5] text-white" : "hover:bg-[#4a6fa5]/10 hover:text-[#2a4080]"
              }`}>
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * SuggestionField â€” regular input that shows a dropdown of matching suggestions
 * only after the user has typed at least 3 characters.
 * Used for: Customer Order No., W.O. Number, Serial Number
 */
function SuggestionField({ form, name, label, fetchField, disabled, required, error, review }: {
  form: any; name: string; label: string; fetchField: keyof TiRecordInput;
  disabled?: boolean; required?: boolean; error?: string; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  const { data: allValues = [] } = useDistinctTiValues(fetchField);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentValue: string = useWatch({ control: form.control, name }) || "";

  const filtered = currentValue.length >= 3
    ? allValues.filter(v => v.toLowerCase().includes(currentValue.toLowerCase()))
    : [];

  useEffect(() => {
    setActiveIndex(filtered.length ? 0 : -1);
  }, [currentValue, open, filtered.length]);

  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-dropdown-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

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
        <ReviewableFieldFrame review={review} value={field.value}>
          <Input {...field} value={field.value || ""} disabled={effectiveDisabled} readOnly={reviewMode}
            className={`h-9 bg-gray-50 border-gray-300 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900 ${reviewMode ? "pr-16" : ""} ${reviewInputStateClass(review, field.value)} ${error ? "border-red-400" : ""}`}
            autoComplete="off"
            onChange={e => {
              if (reviewMode) return;
              field.onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => { if (!reviewMode && currentValue.length >= 3) setOpen(true); }}
            onBlur={() => setTimeout(() => setOpen(false), 100)}
            onKeyDown={e => {
              if (reviewMode) return;
              if (e.key === "ArrowDown" && filtered.length) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
                setActiveIndex(index => index < filtered.length - 1 ? index + 1 : 0);
              } else if (e.key === "ArrowUp" && filtered.length) {
                e.preventDefault();
                e.stopPropagation();
                setOpen(true);
                setActiveIndex(index => index > 0 ? index - 1 : filtered.length - 1);
              } else if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
                e.preventDefault();
                form.setValue(name, filtered[activeIndex], { shouldDirty: true });
                setOpen(false);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
            }}
          />
        </ReviewableFieldFrame>
      )} />
      {error && <p className="text-red-500 text-xs mt-0.5">{error}</p>}
      {open && !effectiveDisabled && !reviewMode && filtered.length > 0 && (
        <ul className="absolute z-50 mt-0.5 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-44 overflow-y-auto text-sm">
          {filtered.map((opt, index) => (
            <li key={opt}
              data-dropdown-index={index}
              onMouseDown={e => { e.preventDefault(); form.setValue(name, opt, { shouldDirty: true }); setOpen(false); }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                index === activeIndex ? "bg-[#4a6fa5] text-white" : "hover:bg-[#4a6fa5]/10 hover:text-[#2a4080]"
              }`}>
              {opt}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** VK2 checkbox cell â€” checkbox only visible when field has value */
function VK2CheckboxCell({ form, mainName, checkboxName, disabled, gridRow, gridCol, review }: {
  form: any; mainName: string; checkboxName: string;
  disabled?: boolean; gridRow?: number; gridCol?: number; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  const mainValue = useWatch({ control: form.control, name: mainName });
  const hasValue = !!(mainValue && String(mainValue).trim());
  return (
    <div className="flex flex-col">
      <Controller name={mainName} control={form.control} render={({ field }) => (
        <ReviewableFieldFrame review={review} value={field.value} compact>
          <Input {...field} value={field.value || ""} disabled={effectiveDisabled} readOnly={reviewMode}
            data-grid-row={gridRow} data-grid-col={gridCol}
            className={`border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] focus-visible:ring-inset bg-transparent disabled:bg-transparent disabled:text-gray-900 px-3 ${reviewMode ? "pr-16" : ""} ${reviewTableStateClass(review, field.value)}`} />
        </ReviewableFieldFrame>
      )} />
      {hasValue && (
        <Controller name={checkboxName} control={form.control} render={({ field }) => {
          const checked = field.value === "true" || field.value === true;
          return (
            <label className={`flex items-center gap-1.5 px-3 py-[3px] border-t border-gray-100 cursor-pointer select-none ${disabled || reviewMode ? "opacity-60 pointer-events-none" : "hover:bg-blue-50/50"}`}>
              <input type="checkbox" checked={checked} disabled={disabled || reviewMode}
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

function TableInput({ form, name, disabled, gridRow, gridCol, review }: {
  form: any; name: string; disabled?: boolean; gridRow?: number; gridCol?: number; review?: FieldReviewConfig;
}) {
  const reviewMode = Boolean(review?.editable);
  const effectiveDisabled = Boolean(disabled) && !reviewMode;
  return (
    <Controller name={name} control={form.control} render={({ field }) => (
      <ReviewableFieldFrame review={review} value={field.value} compact>
      <Input {...field} value={field.value || ""} disabled={effectiveDisabled} readOnly={reviewMode}
        onChange={(event) => {
          if (reviewMode) return;
          field.onChange(event);
          if (name.endsWith(".ratio")) {
            const coreKey = name.split(".")[0];
            applyTapTurnCalculation(form, coreKey, event.target.value, form.getValues("pri_turns"));
          }
          if (!name.endsWith(".bare_core_dim")) return;
          const result = calculateCoreFromDimensions(event.target.value);
          if (result) {
            form.setValue(
              name.replace(/\.bare_core_dim$/, ".core_weight_kg"),
              formatCoreWeight(result.weightKg),
              { shouldDirty: true }
            );
          }
        }}
        data-grid-row={gridRow} data-grid-col={gridCol}
        className={`border-0 shadow-none h-8 rounded-none focus-visible:ring-1 focus-visible:ring-[#4a6fa5] focus-visible:ring-inset bg-transparent disabled:bg-transparent disabled:text-gray-900 px-3 ${reviewMode ? "pr-16" : ""} ${reviewTableStateClass(review, field.value)}`} />
      </ReviewableFieldFrame>
    )} />
  );
}

function applyTapTurnCalculation(form: any, coreKey: string, ratio: string, primaryTurns?: string) {
  const result = calculateTapTurns(ratio, primaryTurns);
  if (!result) return;

  const expandedRatios = expandRatioByCore(form.getValues("ratio"));
  const coreIndex = Number(coreKey.replace("core", "")) - 1;
  const populatedCoreCount = ["core1", "core2", "core3"].filter(
    (key) => String(form.getValues(`${key}.ratio`) || "").trim()
  ).length;
  const isMultiCore = expandedRatios.length > 1 || populatedCoreCount > 1;
  const terminalPrefix = isMultiCore
    ? String(coreIndex + 1)
    : "";

  form.setValue(`${coreKey}.sec_total_turns`, String(result.totalTurns), { shouldDirty: true });
  form.setValue(
    `${coreKey}.sec_ter_marking`,
    Array.from(
      { length: result.segmentTurns.length + 1 },
      (_, index) => `${terminalPrefix}S${index + 1}`
    ).join("-"),
    { shouldDirty: true }
  );
  const segmentFields = [
    "sec_turns_s1s2",
    "sec_turns_s2s3",
    "sec_turns_s3s4",
    "sec_turns_s4s5",
  ];
  segmentFields.forEach((field, index) => {
    form.setValue(
      `${coreKey}.${field}`,
      result.segmentTurns[index] !== undefined ? String(result.segmentTurns[index]) : "",
      { shouldDirty: true }
    );
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}



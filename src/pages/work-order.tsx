import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Edit3,
  FilePlus,
  Save,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  canWriteWorkOrder,
  getGetItemQueryKey,
  useCreateWorkOrder,
  useGetItem,
  useListWorkOrders,
  usePreviewWorkOrderTiNumber,
  useUpdateWorkOrder,
  type CoreData,
  type ItemInput,
  type UserProfile,
} from "@/api-client";
import { ProfileTopBar } from "@/components/ProfileTopBar";
import { AddItemModal } from "@/components/ti-form/AddItemModal";
import { WorkOrderSearchModal } from "@/components/work-order/WorkOrderSearchModal";
import {
  EMPTY_WORK_ORDER,
  type WorkOrderFormData,
  type WorkOrderRecord,
} from "@/lib/work-orders";
import { buildWorkOrderSerialRange } from "@/lib/work-order-serials";

const ORDER_FIELDS: Array<{ name: keyof WorkOrderFormData; label: string; type?: string; required?: boolean }> = [
  { name: "work_order", label: "Work Order", required: true },
  { name: "customer", label: "Customer", required: true },
  { name: "po_no", label: "PO No.", required: true },
  { name: "po_date", label: "PO Date", type: "date" },
  { name: "po_line_no", label: "ITEM NO OF P.O." },
];

const ITEM_FIELDS: Array<{ name: keyof WorkOrderFormData; label: string; required?: boolean }> = [
  { name: "item_code", label: "Item Code" },
  { name: "qty", label: "Qty", required: true },
];

const TRACEABILITY_FIELDS: Array<{ name: keyof WorkOrderFormData; label: string }> = [
  { name: "sr_no", label: "SR No." },
  { name: "traceability_sr_no", label: "Traceability Sr. No." },
];

const WORK_ORDER_FIELDS: Array<{
  name: keyof WorkOrderFormData;
  label: string;
  type?: string;
  required?: boolean;
}> = [...ORDER_FIELDS, ...ITEM_FIELDS, ...TRACEABILITY_FIELDS];

export default function WorkOrder({
  profile,
  onLogout,
  onBackToModules,
}: {
  profile: UserProfile;
  onLogout: () => void | Promise<void>;
  onBackToModules: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const userCanWrite = canWriteWorkOrder(profile.role);
  const { data: workOrdersData } = useListWorkOrders();
  const { data: previewTiData } = usePreviewWorkOrderTiNumber({ query: { enabled: userCanWrite } });
  const createWorkOrderMutation = useCreateWorkOrder();
  const updateWorkOrderMutation = useUpdateWorkOrder();
  const records = workOrdersData?.records || [];
  const [formData, setFormData] = useState<WorkOrderFormData>(() => createEmptyWorkOrderDraft());
  const [currentRecordId, setCurrentRecordId] = useState<string | null>(null);
  const [isEditMode, setIsEditMode] = useState(true);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [activeOurItemCode, setActiveOurItemCode] = useState("");
  const [isAddItemModalOpen, setIsAddItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<"create" | "edit">("create");
  const pendingOurItemFocusRef = useRef<string | null>(null);
  const lastAutoSpecificationRef = useRef("");
  const specificationManuallyEditedRef = useRef(false);
  const pendingSpecificationRefreshRef = useRef(false);
  const lastSuggestedTiNoRef = useRef("");
  const lastAutoSrNoRef = useRef("");
  const srNoManuallyEditedRef = useRef(false);
  const isSaving = createWorkOrderMutation.isPending || updateWorkOrderMutation.isPending;

  const sortedRecords = useMemo(
    () => [...records].sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [records]
  );
  const distinctCustomers = useMemo(() => getDistinctWorkOrderValues(records, "customer"), [records]);
  const distinctWorkOrders = useMemo(() => getDistinctWorkOrderValues(records, "work_order"), [records]);
  const distinctPoNos = useMemo(() => getDistinctWorkOrderValues(records, "po_no"), [records]);

  const currentIndex = currentRecordId
    ? sortedRecords.findIndex((record) => record.id === currentRecordId)
    : -1;
  const currentRecord = currentRecordId
    ? records.find((record) => record.id === currentRecordId) || null
    : null;
  const hasCurrentRecord = Boolean(currentRecord);
  const isFormEnabled = userCanWrite && (!hasCurrentRecord || isEditMode) && !isSaving;
  const normalizedOurItemCode = cleanMasterItemCode(formData.our_item_code);
  const { data: masterItemData, isError: isMasterItemError, isFetching: isMasterItemFetching } = useGetItem(activeOurItemCode, {
    query: { enabled: !!activeOurItemCode, retry: false },
  });

  useEffect(() => {
    const suggestedTiNo = previewTiData?.ti_no?.trim() || "";
    if (!suggestedTiNo || currentRecordId) return;
    if (formData.ti_no.trim() && formData.ti_no.trim() !== lastSuggestedTiNoRef.current) return;
    if (formData.ti_no.trim() === suggestedTiNo) return;

    lastSuggestedTiNoRef.current = suggestedTiNo;
    setFormData((current) => ({ ...current, ti_no: suggestedTiNo }));
  }, [currentRecordId, formData.ti_no, previewTiData?.ti_no]);

  const updateField = (name: keyof WorkOrderFormData, value: string) => {
    setFormData((current) => ({ ...current, [name]: value }));
    if (name === "our_item_code") {
      const cleaned = cleanMasterItemCode(value);
      specificationManuallyEditedRef.current = false;
      lastAutoSpecificationRef.current = "";
      pendingSpecificationRefreshRef.current = Boolean(cleaned);
      if (!srNoManuallyEditedRef.current) lastAutoSrNoRef.current = "";
      if (!cleaned || cleaned !== activeOurItemCode) setActiveOurItemCode("");
    } else if (name === "specification") {
      specificationManuallyEditedRef.current = true;
    } else if (name === "sr_no") {
      const trimmed = value.trim();
      srNoManuallyEditedRef.current = trimmed !== lastAutoSrNoRef.current || (!trimmed && Boolean(currentRecordId));
    }
  };

  useEffect(() => {
    if (!masterItemData) return;
    const generatedSpecification = buildSpecificationFromItemMaster(masterItemData);
    const savedSpecification = getLatestWorkOrderSpecificationForItem(
      records,
      masterItemData.item_no,
      currentRecordId
    );
    const isRefreshingSpecification = pendingSpecificationRefreshRef.current;
    const preferredSpecification = isRefreshingSpecification
      ? generatedSpecification
      : savedSpecification || generatedSpecification;
    const masterItemCode = cleanWorkOrderValue(masterItemData.cust_part_code);
    const shouldAutofillSpecification =
      Boolean(preferredSpecification) &&
      !specificationManuallyEditedRef.current &&
      (isRefreshingSpecification ||
        (!lastAutoSpecificationRef.current && !formData.specification.trim()) ||
        (Boolean(lastAutoSpecificationRef.current) &&
          formData.specification.trim() === lastAutoSpecificationRef.current &&
          formData.specification.trim() !== preferredSpecification));

    if (
      formData.our_item_code !== masterItemData.item_no ||
      formData.item_code !== masterItemCode ||
      shouldAutofillSpecification
    ) {
      setFormData((current) => ({
        ...current,
        our_item_code: masterItemData.item_no,
        item_code: masterItemCode,
        specification: shouldAutofillSpecification ? preferredSpecification : current.specification,
      }));
      if (shouldAutofillSpecification) lastAutoSpecificationRef.current = preferredSpecification;
    }
    if (isRefreshingSpecification) pendingSpecificationRefreshRef.current = false;
    if (pendingOurItemFocusRef.current) {
      const nextField = pendingOurItemFocusRef.current;
      pendingOurItemFocusRef.current = null;
      focusWorkOrderFieldByName(nextField);
    }
  }, [currentRecordId, formData.item_code, formData.our_item_code, formData.specification, masterItemData, records]);

  useEffect(() => {
    if (!isMasterItemError || !activeOurItemCode || !isFormEnabled) return;
    setItemModalMode("create");
    setIsAddItemModalOpen(true);
  }, [activeOurItemCode, isFormEnabled, isMasterItemError]);

  useEffect(() => {
    if (!isFormEnabled || !masterItemData) return;

    const generatedSrNo = buildWorkOrderSerialRange({
      ctType: masterItemData.ct_type,
      quantity: formData.qty,
      records,
      currentRecordId,
    });
    if (!generatedSrNo) return;

    const currentSrNo = formData.sr_no.trim();
    const canAutofillSrNo =
      !srNoManuallyEditedRef.current && (!currentSrNo || currentSrNo === lastAutoSrNoRef.current);
    if (!canAutofillSrNo || currentSrNo === generatedSrNo) return;

    lastAutoSrNoRef.current = generatedSrNo;
    setFormData((current) =>
      current.sr_no.trim() === generatedSrNo ? current : { ...current, sr_no: generatedSrNo }
    );
  }, [currentRecordId, formData.qty, formData.sr_no, isFormEnabled, masterItemData, records]);

  const handleNew = () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Only User role can create or edit Work Orders." });
      return;
    }
    const suggestedTiNo = previewTiData?.ti_no?.trim() || "";
    lastSuggestedTiNoRef.current = suggestedTiNo;
    setFormData(createEmptyWorkOrderDraft(suggestedTiNo));
    setCurrentRecordId(null);
    setIsEditMode(true);
    setActiveOurItemCode("");
    pendingOurItemFocusRef.current = null;
    specificationManuallyEditedRef.current = false;
    lastAutoSpecificationRef.current = "";
    pendingSpecificationRefreshRef.current = false;
    lastAutoSrNoRef.current = "";
    srNoManuallyEditedRef.current = false;
  };

  const handleSave = async () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Only User role can create or edit Work Orders." });
      return;
    }
    if (!normalizedOurItemCode) {
      toast({ variant: "destructive", title: "Our Item Code is required" });
      return;
    }
    if (normalizedOurItemCode !== activeOurItemCode) {
      pendingOurItemFocusRef.current = "work_order";
      setFormData((current) => ({ ...current, our_item_code: normalizedOurItemCode }));
      setActiveOurItemCode(normalizedOurItemCode);
      toast({
        variant: "destructive",
        title: "Check Our Item Code",
        description: "Confirm the master item before saving this Work Order.",
      });
      return;
    }
    if (isMasterItemFetching) {
      toast({ title: "Checking Our Item Code", description: "Please wait for the master item lookup to finish." });
      return;
    }
    if (!masterItemData || isMasterItemError) {
      toast({
        variant: "destructive",
        title: "Our Item Code not found",
        description: "Add this item in the master first, then save the Work Order.",
      });
      setItemModalMode("create");
      setIsAddItemModalOpen(true);
      return;
    }
    const missingRequiredField = WORK_ORDER_FIELDS.find((field) => {
      if (!field.required) return false;
      return !String(formData[field.name] || "").trim();
    });
    if (missingRequiredField) {
      toast({ variant: "destructive", title: `${missingRequiredField.label} is required` });
      return;
    }

    const payload = {
      ...normalizeWorkOrderForm(formData),
      ti_no: formData.ti_no.trim(),
      item_code: cleanWorkOrderValue(masterItemData.cust_part_code),
      our_item_code: normalizedOurItemCode,
      created_by: profile.initials,
      created_by_user_id: profile.id,
    };

    try {
      const savedRecord = currentRecordId
        ? await updateWorkOrderMutation.mutateAsync({ id: currentRecordId, data: payload })
        : await createWorkOrderMutation.mutateAsync({ data: payload });

      setCurrentRecordId(savedRecord.id);
      setFormData(recordToForm(savedRecord));
      setIsEditMode(false);
      setActiveOurItemCode(cleanMasterItemCode(savedRecord.our_item_code || ""));
      lastSuggestedTiNoRef.current = "";
      lastAutoSrNoRef.current = "";
      srNoManuallyEditedRef.current = Boolean(savedRecord.sr_no?.trim());
      toast({ title: currentRecordId ? "Work Order updated" : "Work Order saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error saving Work Order",
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleEdit = () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Only User role can create or edit Work Orders." });
      return;
    }
    if (!currentRecord) return;
    lastAutoSrNoRef.current = "";
    srNoManuallyEditedRef.current = Boolean(currentRecord.sr_no?.trim());
    setIsEditMode(true);
  };

  const openRecord = (record: WorkOrderRecord) => {
    setCurrentRecordId(record.id);
    setFormData(recordToForm(record));
    setIsEditMode(false);
    setIsSearchOpen(false);
    setActiveOurItemCode(cleanMasterItemCode(record.our_item_code || ""));
    pendingOurItemFocusRef.current = null;
    specificationManuallyEditedRef.current = false;
    lastAutoSpecificationRef.current = "";
    pendingSpecificationRefreshRef.current = false;
    lastSuggestedTiNoRef.current = "";
    lastAutoSrNoRef.current = "";
    srNoManuallyEditedRef.current = Boolean(record.sr_no?.trim());
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      openRecord(sortedRecords[currentIndex - 1]);
      return;
    }
    if (!hasCurrentRecord && sortedRecords.length) {
      openRecord(sortedRecords.at(-1)!);
      return;
    }
    toast({ title: "No previous Work Order" });
  };

  const handleNext = () => {
    if (currentIndex >= 0 && currentIndex < sortedRecords.length - 1) {
      openRecord(sortedRecords[currentIndex + 1]);
      return;
    }
    if (!hasCurrentRecord && sortedRecords.length) {
      openRecord(sortedRecords.at(-1)!);
      return;
    }
    toast({ title: "No next Work Order" });
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    if (target.tagName.toLowerCase() === "textarea") return;
    if (!target.matches("input")) return;
    event.preventDefault();
    focusNextWorkOrderField(target);
  };

  const handleOurItemCodeLookup = (nextFocusName?: string) => {
    if (!isFormEnabled) return;
    const cleaned = cleanMasterItemCode(formData.our_item_code);
    if (!cleaned) {
      toast({ variant: "destructive", title: "Our Item Code is required" });
      return;
    }
    pendingSpecificationRefreshRef.current = true;
    pendingOurItemFocusRef.current = nextFocusName || null;
    setFormData((current) => (current.our_item_code === cleaned ? current : { ...current, our_item_code: cleaned }));
    if (cleaned === activeOurItemCode) {
      if (masterItemData) {
        const generatedSpecification = buildSpecificationFromItemMaster(masterItemData);
        const shouldSyncSpecification = Boolean(generatedSpecification) && !specificationManuallyEditedRef.current;
        setFormData((current) => ({
          ...current,
          our_item_code: masterItemData.item_no,
          item_code: cleanWorkOrderValue(masterItemData.cust_part_code),
          specification: shouldSyncSpecification ? generatedSpecification : current.specification,
        }));
        if (shouldSyncSpecification) lastAutoSpecificationRef.current = generatedSpecification;
        pendingSpecificationRefreshRef.current = false;
        pendingOurItemFocusRef.current = null;
        if (nextFocusName) focusWorkOrderFieldByName(nextFocusName);
        return;
      }
      if (isMasterItemError) {
        setItemModalMode("create");
        setIsAddItemModalOpen(true);
      }
      return;
    }
    setActiveOurItemCode(cleaned);
  };

  const handleEditMasterItem = () => {
    if (!userCanWrite) {
      toast({ title: "Not allowed", description: "Only User role can create or edit Work Orders." });
      return;
    }
    if (!masterItemData) {
      toast({
        variant: "destructive",
        title: "Check item first",
        description: "Load a valid master item before editing it.",
      });
      return;
    }
    setItemModalMode("edit");
    setIsAddItemModalOpen(true);
  };

  const handleOurItemCodeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    handleOurItemCodeLookup("work_order");
  };

  const hideTopBar = isSearchOpen || isAddItemModalOpen;

  return (
    <div className="min-h-screen bg-gray-100">
      <aside className="fixed z-10 flex h-full w-[60px] shrink-0 flex-col items-center space-y-4 bg-[#2a4080] py-4 no-print">
        <WorkOrderSidebarButton icon={<Save />} title="Save" onClick={handleSave} disabled={!isFormEnabled} />
        <WorkOrderSidebarButton icon={<FilePlus />} title="New" onClick={handleNew} disabled={!userCanWrite} />
        <WorkOrderSidebarButton icon={<Search />} title="Search" onClick={() => setIsSearchOpen(true)} />
        <WorkOrderSidebarButton icon={<ChevronLeft />} title="Prev" onClick={handlePrevious} disabled={!sortedRecords.length} />
        <WorkOrderSidebarButton icon={<ChevronRight />} title="Next" onClick={handleNext} disabled={!sortedRecords.length} />
        <WorkOrderSidebarButton icon={<Edit3 />} title="Edit" onClick={handleEdit} disabled={!hasCurrentRecord || isEditMode || !userCanWrite} />
        <div className="flex-1" />
      </aside>

      <main className="ml-[60px] min-h-screen">
        {!hideTopBar && (
          <ProfileTopBar
            profile={profile}
            onLogout={onLogout}
            title="Work Order"
            onModulesClick={onBackToModules}
          />
        )}

        <div className="flex justify-center px-6 py-6" onKeyDown={handleFormKeyDown}>
          <div className="w-full max-w-5xl border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between bg-gradient-to-r from-[#3b5fc0] to-[#6b8dd6] p-6 text-white">
              <div className="flex items-center space-x-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-md bg-white text-[#3b5fc0] shadow">
                  <ClipboardList className="h-7 w-7" />
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-wider">WORK ORDER</h1>
                  <h2 className="text-sm font-medium text-blue-100">CURRENT TRANSFORMER</h2>
                </div>
              </div>

              <div className="space-y-2 text-right">
                <div className="flex items-center space-x-2 rounded bg-white/20 px-3 py-1">
                  <span className="whitespace-nowrap text-sm font-semibold">TI Number:</span>
                  <input
                    type="text"
                    value={formData.ti_no}
                    onChange={(event) => updateField("ti_no", event.target.value)}
                    disabled={!isFormEnabled}
                    data-work-order-field
                    data-work-order-name="ti_no"
                    className="w-48 border-b border-white/60 bg-transparent text-right font-mono font-bold tracking-wider text-white outline-none placeholder:text-white/50 disabled:opacity-90"
                    placeholder="Enter or keep suggested TI no."
                  />
                </div>
                <div className="flex justify-end">
                  <span className="inline-flex rounded bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                    {hasCurrentRecord ? (isEditMode ? "Editing" : "Saved") : userCanWrite ? "New" : "View Only"}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-8 p-6">
              <section>
                <SectionHeader title="Master Item" />
                <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-1">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                        Our Item Code
                        <span className="ml-0.5 text-red-500">*</span>
                      </Label>
                      <Input
                        value={formData.our_item_code}
                        onChange={(event) => updateField("our_item_code", event.target.value)}
                        onBlur={() => {
                          if (isFormEnabled) handleOurItemCodeLookup();
                        }}
                        onKeyDown={handleOurItemCodeKeyDown}
                        disabled={!isFormEnabled}
                        data-work-order-field
                        data-work-order-name="our_item_code"
                        className="h-10 max-w-sm border-[#4a6fa5] bg-white focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900"
                        placeholder="Enter our item code..."
                      />
                      {activeOurItemCode && isMasterItemFetching && activeOurItemCode === normalizedOurItemCode ? (
                        <p className="text-xs font-medium text-[#4a6fa5]">Checking master item...</p>
                      ) : activeOurItemCode && isMasterItemError && activeOurItemCode === normalizedOurItemCode ? (
                        <p className="text-xs font-medium text-red-600">Item code not found in master. Add it to continue.</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => handleOurItemCodeLookup("work_order")}
                        disabled={!isFormEnabled}
                        className="bg-[#4a6fa5] hover:bg-[#3b5fc0]"
                      >
                        Check Item
                      </Button>
                      {userCanWrite && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleEditMasterItem}
                          disabled={!masterItemData || isMasterItemFetching}
                          className="border-[#4a6fa5] text-[#4a6fa5] hover:bg-[#4a6fa5] hover:text-white"
                        >
                          Edit Item
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <SectionHeader title="Order Details" />
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {ORDER_FIELDS.map((field) => (
                    <WorkOrderField
                      key={field.name}
                      fieldName={field.name}
                      label={field.label}
                      value={formData[field.name]}
                      type={field.type}
                      required={field.required}
                      disabled={!isFormEnabled}
                      suggestions={
                        field.name === "customer"
                          ? distinctCustomers
                          : field.name === "work_order"
                            ? distinctWorkOrders
                            : field.name === "po_no"
                              ? distinctPoNos
                              : undefined
                      }
                      suggestionMode={
                        field.name === "customer"
                          ? "autocomplete"
                          : field.name === "work_order" || field.name === "po_no"
                            ? "suggestion"
                            : "none"
                      }
                      onChange={(value) => updateField(field.name, value)}
                    />
                  ))}
                </div>
              </section>

              <section>
                <SectionHeader title="Item Details" />
                <div className="grid gap-4 md:grid-cols-3">
                  {ITEM_FIELDS.map((field) => (
                    <WorkOrderField
                      key={field.name}
                      fieldName={field.name}
                      label={field.label}
                      value={formData[field.name]}
                      required={field.required}
                      disabled={!isFormEnabled || field.name === "item_code"}
                      onChange={(value) => updateField(field.name, value)}
                    />
                  ))}
                </div>
                <div className="mt-4 space-y-1">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                    Specification
                  </Label>
                  <WorkOrderTextareaField
                    fieldName="specification"
                    value={formData.specification}
                    onChange={(value) => updateField("specification", value)}
                    disabled={!isFormEnabled}
                    placeholder="Enter specification..."
                  />
                </div>
              </section>

              <section>
                <SectionHeader title="Traceability" />
                <div className="grid gap-4 md:grid-cols-3">
                  {TRACEABILITY_FIELDS.map((field) => (
                    <WorkOrderField
                      key={field.name}
                      fieldName={field.name}
                      label={field.label}
                      value={formData[field.name]}
                      disabled={!isFormEnabled}
                      onChange={(value) => updateField(field.name, value)}
                    />
                  ))}
                </div>
              </section>

            </div>
          </div>
        </div>
      </main>

      <WorkOrderSearchModal
        open={isSearchOpen}
        records={sortedRecords}
        onClose={() => setIsSearchOpen(false)}
        onSelect={openRecord}
      />
      <AddItemModal
        open={isAddItemModalOpen}
        onOpenChange={setIsAddItemModalOpen}
        itemNo={activeOurItemCode}
        mode={itemModalMode}
        itemData={itemModalMode === "edit" ? masterItemData || null : null}
        onSuccess={(savedItem) => {
          const savedItemNo = cleanMasterItemCode(savedItem.item_no || activeOurItemCode);
          if (savedItemNo) {
            const generatedSpecification = buildSpecificationFromItemMaster(savedItem);
            const shouldSyncSpecification = Boolean(generatedSpecification) && !specificationManuallyEditedRef.current;
            queryClient.setQueryData(getGetItemQueryKey(savedItemNo), savedItem);
            setActiveOurItemCode(savedItemNo);
            setFormData((current) => ({
              ...current,
              our_item_code: savedItemNo,
              item_code: cleanWorkOrderValue(savedItem.cust_part_code),
              specification: shouldSyncSpecification ? generatedSpecification : current.specification,
            }));
            if (shouldSyncSpecification) lastAutoSpecificationRef.current = generatedSpecification;
            pendingSpecificationRefreshRef.current = false;
          }
          queryClient.invalidateQueries({ queryKey: getGetItemQueryKey(savedItemNo || activeOurItemCode) });
          setIsAddItemModalOpen(false);
        }}
      />
    </div>
  );
}

function WorkOrderField({
  fieldName,
  label,
  value,
  onChange,
  type = "text",
  disabled,
  required,
  suggestions,
  suggestionMode = "none",
}: {
  fieldName: keyof WorkOrderFormData;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
  required?: boolean;
  suggestions?: string[];
  suggestionMode?: "none" | "autocomplete" | "suggestion";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const filteredSuggestions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const allSuggestions = suggestions || [];
    if (suggestionMode === "autocomplete") {
      return allSuggestions.filter((option) => !normalizedQuery || option.toLowerCase().includes(normalizedQuery));
    }
    if (suggestionMode === "suggestion" && normalizedQuery.length >= 3) {
      return allSuggestions.filter((option) => option.toLowerCase().includes(normalizedQuery));
    }
    return [];
  }, [query, suggestionMode, suggestions]);

  useEffect(() => {
    setQuery(value || "");
  }, [value]);

  useEffect(() => {
    setActiveIndex(filteredSuggestions.length ? 0 : -1);
  }, [filteredSuggestions.length, open, query]);

  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>(`[data-dropdown-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative space-y-1" ref={containerRef}>
      <Label className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setQuery(event.target.value);
          if (suggestionMode === "autocomplete") setOpen(true);
          else if (suggestionMode === "suggestion") setOpen(event.target.value.trim().length >= 3);
        }}
        onFocus={() => {
          if (disabled) return;
          if (suggestionMode === "autocomplete") setOpen(true);
          else if (suggestionMode === "suggestion" && value.trim().length >= 3) setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        onKeyDown={(event) => {
          if (disabled || !filteredSuggestions.length) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            setActiveIndex((index) => (index < filteredSuggestions.length - 1 ? index + 1 : 0));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            setActiveIndex((index) => (index > 0 ? index - 1 : filteredSuggestions.length - 1));
          } else if (event.key === "Enter" && open && activeIndex >= 0 && filteredSuggestions[activeIndex]) {
            event.preventDefault();
            event.stopPropagation();
            onChange(filteredSuggestions[activeIndex]);
            setQuery(filteredSuggestions[activeIndex]);
            setOpen(false);
            focusNextWorkOrderField(event.currentTarget);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        disabled={disabled}
        autoComplete="off"
        data-work-order-field
        data-work-order-name={fieldName}
        className="h-9 border-gray-300 bg-gray-50 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900"
      />
      {open && !disabled && filteredSuggestions.length > 0 && (
        <ul className="absolute z-50 mt-0.5 max-h-44 w-full overflow-y-auto rounded-md border border-gray-200 bg-white text-sm shadow-lg">
          {filteredSuggestions.map((option, index) => (
            <li
              key={`${fieldName}-${option}`}
              data-dropdown-index={index}
              onMouseDown={(event) => {
                event.preventDefault();
                onChange(option);
                setQuery(option);
                setOpen(false);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={`cursor-pointer px-3 py-1.5 transition-colors ${
                index === activeIndex ? "bg-[#4a6fa5] text-white" : "hover:bg-[#4a6fa5]/10 hover:text-[#2a4080]"
              }`}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkOrderTextareaField({
  fieldName,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  fieldName: keyof WorkOrderFormData;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 96)}px`;
  }, [value]);

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        focusNextWorkOrderField(event.currentTarget);
      }}
      disabled={disabled}
      data-work-order-field
      data-work-order-name={fieldName}
      className="min-h-24 overflow-hidden resize-none border-gray-300 bg-gray-50 focus-visible:ring-[#4a6fa5] disabled:bg-gray-50 disabled:text-gray-900"
      placeholder={placeholder}
    />
  );
}

function WorkOrderSidebarButton({
  icon,
  title,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`flex h-12 w-12 flex-col items-center justify-center rounded-md transition-colors group ${
        disabled
          ? "cursor-not-allowed text-white/30"
          : "text-white/80 hover:bg-white/10 hover:text-white"
      }`}
    >
      <span className={`mb-1 transition-transform [&>svg]:h-5 [&>svg]:w-5 ${!disabled ? "group-hover:scale-110" : ""}`}>
        {icon}
      </span>
      <span className="text-[10px] font-medium">{title}</span>
    </button>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-4 border-l-4 border-[#4a6fa5] bg-blue-50/80 px-4 py-2">
      <h3 className="text-sm font-bold tracking-wide text-[#4a6fa5]">{title}</h3>
    </div>
  );
}

function getDistinctWorkOrderValues(
  records: WorkOrderRecord[],
  field: keyof Pick<WorkOrderRecord, "customer" | "work_order" | "po_no">
) {
  return Array.from(
    new Set(
      records
        .map((record) => String(record[field] || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeWorkOrderForm(data: WorkOrderFormData): WorkOrderFormData {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, value.trim()])
  ) as WorkOrderFormData;
}

function recordToForm(record: WorkOrderRecord): WorkOrderFormData {
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
  };
}

function focusNextWorkOrderField(currentField: HTMLElement) {
  const fields = Array.from(
    document.querySelectorAll<HTMLElement>("[data-work-order-field]:not(:disabled)")
  ).filter((field) => field.tabIndex !== -1);
  const index = fields.indexOf(currentField);
  const next = fields[index + 1] || fields[0];
  next?.focus();
}

function focusWorkOrderFieldByName(name: string) {
  document
    .querySelector<HTMLElement>(`[data-work-order-name="${name}"]:not(:disabled)`)
    ?.focus();
}

function cleanMasterItemCode(value: string) {
  return value.replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, "");
}

function buildSpecificationFromItemMaster(item?: Partial<ItemInput> | null) {
  if (!item) return "";

  const ctType = cleanSpecificationValue(item.ct_type);
  const ratio = cleanSpecificationValue(item.ratio);
  const accuracyClass = cleanSpecificationValue(findPrimaryAccuracyClass(item));
  const bil = cleanSpecificationValue(item.insulation_level);
  const frequency = cleanSpecificationValue(item.frequency);
  const refStd = cleanSpecificationValue(item.ref_std);
  const gaDrg = cleanSpecificationValue(item.ga_drg);
  const dimensions = parseSpecificationDimensions(item.ct_final_dim);

  const parts = [
    `CT Type : ${ctType || "-"}`,
    `Ratio : ${ratio || "-"}`,
    `Class : ${accuracyClass || "-"}`,
    `BIL : ${bil || "-"}`,
    `Frequency : ${frequency || "-"}`,
    `Ref Std : ${refStd || "-"}`,
    `ID : ${dimensions.id ? `${dimensions.id} mm` : "-"}`,
    `OD : ${dimensions.od ? `${dimensions.od} mm` : "-"}`,
    dimensions.h
      ? `H : ${dimensions.h} mm${gaDrg ? ` to Drg ${gaDrg}` : ""}`
      : `H : -${gaDrg ? ` to Drg ${gaDrg}` : ""}`,
  ];

  return parts.join(", ");
}

function getLatestWorkOrderSpecificationForItem(
  records: WorkOrderRecord[],
  itemNo?: string | null,
  currentRecordId?: string | null
) {
  const normalizedItemNo = cleanMasterItemCode(itemNo || "");
  if (!normalizedItemNo) return "";

  return [...records]
    .filter((record) => {
      if (currentRecordId && record.id === currentRecordId) return false;
      return cleanMasterItemCode(record.our_item_code || "") === normalizedItemNo && Boolean(record.specification?.trim());
    })
    .sort((a, b) =>
      (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "")
    )[0]?.specification?.trim() || "";
}

function findPrimaryAccuracyClass(item: Partial<ItemInput>) {
  const cores = [item.core1, item.core2, item.core3] as Array<CoreData | undefined>;
  return cores.map((core) => core?.accuracy_class?.trim() || "").find(Boolean) || "";
}

function parseSpecificationDimensions(value?: string | null) {
  const raw = cleanSpecificationValue(value);
  if (!raw) return { id: "", od: "", h: "" };

  const labelledId = extractLabelledDimension(raw, /\bID\s*[:=@]?\s*([0-9.\sXx*×]+)/i);
  const labelledOd = extractLabelledDimension(raw, /\bOD\s*[:=@]?\s*([0-9.\sXx*×]+)/i);
  const labelledH = extractLabelledDimension(raw, /\b(?:HT|HGT|HEIGHT|H)\s*[:=@]?\s*([0-9.\sXx*×]+)/i);
  if (labelledId || labelledOd || labelledH) {
    return { id: labelledId, od: labelledOd, h: labelledH };
  }

  const numbers = raw.match(/\d+(?:\.\d+)?/g) || [];
  if (numbers.length === 3) {
    return {
      id: formatDimensionGroup(numbers.slice(0, 1)),
      od: formatDimensionGroup(numbers.slice(1, 2)),
      h: formatDimensionGroup(numbers.slice(2, 3)),
    };
  }
  if (numbers.length >= 5) {
    return {
      id: formatDimensionGroup(numbers.slice(0, 2)),
      od: formatDimensionGroup(numbers.slice(2, 4)),
      h: formatDimensionGroup(numbers.slice(4, 5)),
    };
  }

  return { id: "", od: "", h: "" };
}

function extractLabelledDimension(source: string, pattern: RegExp) {
  const value = source.match(pattern)?.[1] || "";
  if (!value) return "";
  return formatDimensionGroup(value.match(/\d+(?:\.\d+)?/g) || []);
}

function formatDimensionGroup(values: string[]) {
  return values.map((value) => formatDimensionValue(value)).filter(Boolean).join("X");
}

function formatDimensionValue(value?: string | null) {
  const trimmed = cleanSpecificationValue(value);
  if (!trimmed) return "";
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? String(numeric) : trimmed;
}

function cleanSpecificationValue(value?: string | null) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function cleanWorkOrderValue(value?: string | null) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function createEmptyWorkOrderDraft(tiNo = ""): WorkOrderFormData {
  return {
    ...EMPTY_WORK_ORDER,
    ti_no: tiNo,
  };
}

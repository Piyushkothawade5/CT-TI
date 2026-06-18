import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface CoreData {
  ratio?: string;
  burden_va?: string;
  accuracy_class?: string;
  isf?: string;
  min_knee_pt_volt?: string;
  max_rct_75c?: string;
  max_exc_vk2?: string;
  max_exc_is_vk2?: string;
  bare_core_dim?: string;
  core_material?: string;
  core_weight_kg?: string;
  sec_total_turns?: string;
  sec_ter_marking?: string;
  sec_cond_s1s2?: string;
  sec_turns_s1s2?: string;
  sec_cond_s2s3?: string;
  sec_turns_s2s3?: string;
  sec_cond_s3s4?: string;
  sec_turns_s3s4?: string;
  sec_cond_s4s5?: string;
  sec_turns_s4s5?: string;
  sec_copper_wt?: string;
  finished_core_dim?: string;
  sec_connection?: string;
  wire_length?: string;
  wire_colour?: string;
  [key: string]: string | undefined;
}

export interface ItemInput {
  item_no: string;
  ct_type?: string;
  cust_part_code?: string;
  ratio?: string;
  rated_voltage?: string;
  stc?: string;
  insulation_level?: string;
  frequency?: string;
  ref_std?: string;
  core1?: CoreData;
  core2?: CoreData;
  core3?: CoreData;
  ct_final_dim?: string;
  ga_drg?: string;
  ins_class?: string;
  ref_ti?: string;
  pri_turns?: string;
  pri_copper?: string;
  former?: string;
  pri_length?: string;
  pri_weight?: string;
  sec_terminal?: string;
  total_weight?: string;
  default_customer?: string;
}

export interface TiRecordInput {
  item_no?: string;
  ti_no?: string;
  ti_date?: string;
  wo_number?: string;
  customer_name?: string;
  cus_order_no?: string;
  cus_order_date?: string;
  quantity?: string;
  ct_type?: string;
  cust_part_code?: string;
  po_item_no?: string;
  serial_number?: string;
  ratio?: string;
  rated_voltage?: string;
  stc?: string;
  insulation_level?: string;
  frequency?: string;
  ref_std?: string;
  core1?: CoreData;
  core2?: CoreData;
  core3?: CoreData;
  ct_final_dim?: string;
  ga_drg?: string;
  ins_class?: string;
  ref_ti?: string;
  pri_turns?: string;
  pri_copper?: string;
  former?: string;
  pri_length?: string;
  pri_weight?: string;
  sec_terminal?: string;
  total_weight?: string;
  created_by?: string;
  checked_by?: string;
  approved_by?: string;
  remarks?: string;
  rev_no?: string;
  note?: string;
  [key: string]: unknown;
}

interface TiRecord extends TiRecordInput {
  id: string;
  ti_no: string;
}

interface Item extends ItemInput {
  id: string;
}

type ListFilters = {
  tiNo?: string;
  itemNo?: string;
  customer?: string;
  woNo?: string;
  ctType?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "") || "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const CUSTOMER_ALIASES: Record<string, string> = {
  "ALANAR": "ALFANAR",
  "CREATIVE ENGINNERS": "CREATIVE ENGINEERS",
  "LI=UCY NASHIK": "LUCY NASHIK",
  "LUCY DUBAI'": "LUCY DUBAI",
  "LUCY NASHIK'": "LUCY NASHIK",
  "LUCY NASHK": "LUCY NASHIK",
  "LUCY": "LUCY NASHIK",
  "POWER CONTROL ELECTRO": "POWER CONTROL",
  "POWER CONTROL ELECTRO SYSTEM": "POWER CONTROL",
  "POWER CONTROL ELECTRO SYSTEMS": "POWER CONTROL",
  "STELMEC LIMITED": "STELMEC",
  "VOLTMAP TRANSFORMERS": "VOLTAMP TRANSFORMERS",
};

const CT_TYPE_ALIASES: Record<string, string> = {
  "FG INSULATED CT": "FG TAPE INSULATED CT",
  "PLASIC CASE CT": "PLASTIC CASE CT",
  "PVC TAPE INSULATED CT.": "PVC TAPE INSULATED CT",
  "RESIN CASAT CT": "RESIN CAST CT",
  "RESIN CAST CT//////": "RESIN CAST CT",
  "RESIN CASTCT": "RESIN CAST CT",
  "RESIN INSULATED CT": "RESIN CAST CT",
  "TAPE INSULATED CT": "PVC TAPE INSULATED CT",
  "TAPE WOUND  CT": "PVC TAPE INSULATED CT",
  "TAPE WOUND CT": "PVC TAPE INSULATED CT",
  "TAPE WOUNDC CT": "PVC TAPE INSULATED CT",
};

function normalizeText(value?: string): string | undefined {
  const text = value?.trim().replace(/\s+/g, " ");
  return text || undefined;
}

function normalizeCustomer(value?: string): string | undefined {
  const text = normalizeText(value)?.replace(/’/g, "'").toUpperCase();
  if (!text) return undefined;
  return CUSTOMER_ALIASES[text] || text;
}

function normalizeCtType(value?: string): string | undefined {
  const text = normalizeText(value)?.toUpperCase();
  if (!text || text === "5010000386" || text === "LUCY DUBAI" || /^\d+$/.test(text)) {
    return undefined;
  }
  return CT_TYPE_ALIASES[text] || text;
}

function cleanItemNo(itemNo: string): string {
  return itemNo.replace(/[\s,\.]+/g, "").replace(/[^0-9]/g, "");
}

function todayIso(): string {
  return new Date().toISOString().split("T")[0];
}

function normalizeCore(core?: CoreData): CoreData {
  return core || {};
}

function normalizeItemInput(data: ItemInput): ItemInput {
  return {
    ...data,
    item_no: cleanItemNo(data.item_no),
    ct_type: normalizeCtType(data.ct_type),
    default_customer: normalizeCustomer(data.default_customer),
    core1: normalizeCore(data.core1),
    core2: normalizeCore(data.core2),
    core3: normalizeCore(data.core3),
  };
}

function normalizeTiInput(data: TiRecordInput): TiRecordInput {
  return {
    ...data,
    item_no: data.item_no ? cleanItemNo(data.item_no) : data.item_no,
    customer_name: normalizeCustomer(data.customer_name),
    ct_type: normalizeCtType(data.ct_type),
    core1: normalizeCore(data.core1),
    core2: normalizeCore(data.core2),
    core3: normalizeCore(data.core3),
  };
}

function getItems(): Item[] {
  try {
    return JSON.parse(localStorage.getItem("ct_items") || "[]");
  } catch {
    return [];
  }
}

function setItems(items: Item[]) {
  localStorage.setItem("ct_items", JSON.stringify(items));
}

function getTiRecords(): TiRecord[] {
  try {
    return JSON.parse(localStorage.getItem("ct_ti_records") || "[]");
  } catch {
    return [];
  }
}

function setTiRecords(records: TiRecord[]) {
  localStorage.setItem("ct_ti_records", JSON.stringify(records));
}

type TiNumberParts = {
  prefix: string;
  financialYearStart: number;
  financialYearEnd: number;
  sequence: number;
};

function parseTiNumber(tiNo?: string | null): TiNumberParts | null {
  const match = tiNo?.trim().match(/^LTCT-(\d{2})-(\d{2})-(\d+)$/i);
  if (!match) return null;
  return {
    prefix: `LTCT-${match[1]}-${match[2]}-`,
    financialYearStart: Number(match[1]),
    financialYearEnd: Number(match[2]),
    sequence: Number(match[3]),
  };
}

function compareTiNumbers(a: TiRecord, b: TiRecord): number {
  const aParts = parseTiNumber(a.ti_no);
  const bParts = parseTiNumber(b.ti_no);
  if (aParts && bParts) {
    return (
      aParts.financialYearStart - bParts.financialYearStart ||
      aParts.financialYearEnd - bParts.financialYearEnd ||
      aParts.sequence - bParts.sequence
    );
  }
  if (aParts) return 1;
  if (bParts) return -1;
  return a.ti_no.localeCompare(b.ti_no, undefined, { numeric: true });
}

function currentFinancialYearPrefix(): string {
  return formatTiNo(0).replace(/\d+$/, "");
}

function currentTiCounterKey(): string {
  return `ct_ti_counter_${currentFinancialYearPrefix()}`;
}

function getTiCounter(): number {
  const stored = parseInt(localStorage.getItem(currentTiCounterKey()) || "0", 10);
  const currentPrefix = currentFinancialYearPrefix();
  const recordMax = getTiRecords().reduce((max, record) => {
    const parts = parseTiNumber(record.ti_no);
    return parts?.prefix === currentPrefix ? Math.max(max, parts.sequence) : max;
  }, 0);
  return Math.max(Number.isFinite(stored) ? stored : 0, recordMax);
}

function incrementTiCounter(): number {
  const next = getTiCounter() + 1;
  localStorage.setItem(currentTiCounterKey(), String(next));
  return next;
}

function formatTiNo(seq: number): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const y = now.getFullYear() % 100;
  const fyS = m >= 4 ? y : y - 1;
  const fyE = fyS + 1;
  const fy = `${String(fyS).padStart(2, "0")}-${String(fyE).padStart(2, "0")}`;
  return `LTCT-${fy}-${String(seq).padStart(4, "0")}`;
}

function previewLocalTiNo(): string {
  return formatTiNo(getTiCounter() + 1);
}

function generateLocalTiNo(): string {
  return formatTiNo(incrementTiCounter());
}

async function supabaseFetch<T>(
  path: string,
  init: RequestInit & { prefer?: string } = {}
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function eqFilter(value: string): string {
  return encodeURIComponent(value);
}

async function rpc<T>(name: string, body: Record<string, unknown> = {}): Promise<T> {
  return supabaseFetch<T>(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function findSupabaseItem(itemNo: string): Promise<Item> {
  const rows = await supabaseFetch<Item[]>(
    `ct_items?item_no=eq.${eqFilter(cleanItemNo(itemNo))}&select=*&limit=1`
  );
  const item = rows[0];
  if (!item) throw new Error("Item not found");
  return item;
}

async function findSupabaseTiRecord(tiNo: string): Promise<TiRecord> {
  const rows = await supabaseFetch<TiRecord[]>(
    `ct_ti_records?ti_no=eq.${eqFilter(tiNo)}&select=*&limit=1`
  );
  const record = rows[0];
  if (!record) throw new Error("TI record not found");
  return record;
}

async function listSupabaseTiRecords(filters: ListFilters = {}): Promise<TiRecord[]> {
  const records = await supabaseFetch<TiRecord[]>(
    "ct_ti_records?select=*"
  );
  return filterTiRecords(records, filters);
}

async function listSupabaseItems(): Promise<Item[]> {
  return supabaseFetch<Item[]>("ct_items?select=*&order=item_no.asc");
}

async function createSupabaseItem(data: ItemInput): Promise<Item> {
  const rows = await supabaseFetch<Item[]>("ct_items", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(normalizeItemInput(data)),
  });
  return rows[0];
}

async function updateSupabaseItem(itemNo: string, data: Partial<ItemInput>): Promise<Item> {
  const rows = await supabaseFetch<Item[]>(
    `ct_items?item_no=eq.${eqFilter(cleanItemNo(itemNo))}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(data),
    }
  );
  return rows[0];
}

async function createSupabaseTiRecord(data: TiRecordInput): Promise<TiRecord> {
  const normalized = normalizeTiInput(data);
  const tiNo = await rpc<string>("allocate_ti_number", {
    preferred_ti_no: normalized.ti_no || null,
  });
  const rows = await supabaseFetch<TiRecord[]>("ct_ti_records", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      ...normalized,
      ti_no: tiNo,
      ti_date: normalized.ti_date || todayIso(),
    }),
  });
  const record = rows[0];

  if (normalized.item_no && normalized.customer_name) {
    const item = await findSupabaseItem(normalized.item_no);
    if (!item.default_customer) {
      await updateSupabaseItem(normalized.item_no, {
        default_customer: String(normalized.customer_name),
      });
    }
  }

  return record;
}

async function updateSupabaseTiRecord(
  tiNo: string | null,
  data: TiRecordInput
): Promise<TiRecord> {
  if (!tiNo) throw new Error("TI number is required");
  const rows = await supabaseFetch<TiRecord[]>(
    `ct_ti_records?ti_no=eq.${eqFilter(tiNo)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ ...normalizeTiInput(data), ti_no: tiNo }),
    }
  );
  const record = rows[0];
  if (!record) throw new Error("TI record not found");
  return record;
}

function filterTiRecords(records: TiRecord[], filters: ListFilters): TiRecord[] {
  let filtered = [...records];
  if (filters.tiNo) {
    filtered = filtered.filter((r) =>
      r.ti_no?.toLowerCase().includes(filters.tiNo!.toLowerCase())
    );
  }
  if (filters.itemNo) {
    filtered = filtered.filter((r) =>
      r.item_no?.toLowerCase().includes(filters.itemNo!.toLowerCase())
    );
  }
  if (filters.customer) {
    filtered = filtered.filter((r) =>
      r.customer_name?.toLowerCase().includes(filters.customer!.toLowerCase())
    );
  }
  if (filters.woNo) {
    filtered = filtered.filter((r) =>
      r.wo_number?.toLowerCase().includes(filters.woNo!.toLowerCase())
    );
  }
  if (filters.ctType) {
    filtered = filtered.filter((r) =>
      r.ct_type?.toLowerCase().includes(filters.ctType!.toLowerCase())
    );
  }
  return filtered.sort((a, b) => compareTiNumbers(b, a));
}

export function getGetItemQueryKey(itemNo: string) {
  return ["item", itemNo];
}

export function getGetTiRecordQueryKey(tiNo: string) {
  return ["ti-record", tiNo];
}

export function getDistinctTiField(field: keyof TiRecordInput): string[] {
  const seen = new Set<string>();
  for (const r of getTiRecords()) {
    const v = r[field];
    if (typeof v === "string" && v.trim()) seen.add(v.trim());
  }
  return Array.from(seen).sort();
}

export function getDistinctCtTypes(): string[] {
  const seen = new Set<string>();
  for (const item of getItems()) {
    if (item.ct_type?.trim()) seen.add(item.ct_type.trim());
  }
  return Array.from(seen).sort();
}

export function getCustomerForItem(itemNo: string): string {
  const records = getTiRecords();
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (r.item_no === itemNo && r.customer_name?.trim()) {
      const c = r.customer_name.trim();
      counts[c] = (counts[c] || 0) + 1;
    }
  }
  let best = "";
  let max = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = name;
    }
  }
  if (!best) {
    const item = getItems().find((i) => i.item_no === itemNo);
    best = item?.default_customer || "";
  }
  return best;
}

export async function getCustomerForItemAsync(itemNo: string): Promise<string> {
  if (!isSupabaseConfigured) return getCustomerForItem(itemNo);

  const records = await supabaseFetch<Array<Pick<TiRecord, "customer_name">>>(
    `ct_ti_records?item_no=eq.${eqFilter(cleanItemNo(itemNo))}&select=customer_name`
  );
  const counts: Record<string, number> = {};
  for (const r of records) {
    if (r.customer_name?.trim()) {
      const customer = r.customer_name.trim();
      counts[customer] = (counts[customer] || 0) + 1;
    }
  }
  let best = "";
  let max = 0;
  for (const [name, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = name;
    }
  }
  if (best) return best;

  const item = await findSupabaseItem(itemNo);
  return item.default_customer || "";
}

export function useGetItem(
  itemNo: string,
  options?: { query?: { enabled?: boolean; retry?: boolean } }
) {
  return useQuery({
    queryKey: getGetItemQueryKey(itemNo),
    queryFn: () => {
      if (isSupabaseConfigured) return findSupabaseItem(itemNo);
      const found = getItems().find((i) => i.item_no === itemNo);
      if (!found) throw new Error("Item not found");
      return found;
    },
    enabled: options?.query?.enabled !== false && !!itemNo,
    retry: options?.query?.retry ?? false,
  });
}

export function useGetTiRecord(
  tiNo: string,
  options?: { query?: { enabled?: boolean; retry?: boolean } }
) {
  return useQuery({
    queryKey: getGetTiRecordQueryKey(tiNo),
    queryFn: () => {
      if (isSupabaseConfigured) return findSupabaseTiRecord(tiNo);
      const found = getTiRecords().find((r) => r.ti_no === tiNo);
      if (!found) throw new Error("TI record not found");
      return found;
    },
    enabled: options?.query?.enabled !== false && !!tiNo,
    retry: options?.query?.retry ?? false,
  });
}

export function useGetAdjacentTiRecords(
  tiNo: string,
  options?: { query?: { enabled?: boolean } }
) {
  return useQuery({
    queryKey: ["ti-adjacent", tiNo],
    queryFn: async () => {
      const records = isSupabaseConfigured
        ? await supabaseFetch<TiRecord[]>("ct_ti_records?select=ti_no")
        : getTiRecords();
      const selectedParts = parseTiNumber(tiNo);
      if (!selectedParts) return { prev: null, next: null };

      const financialYearRecords = records
        .filter((record) => parseTiNumber(record.ti_no)?.prefix === selectedParts.prefix)
        .sort(compareTiNumbers);

      const previousRecords = financialYearRecords.filter((record) => {
        const parts = parseTiNumber(record.ti_no);
        return parts && parts.sequence < selectedParts.sequence;
      });
      const nextRecord = financialYearRecords.find((record) => {
        const parts = parseTiNumber(record.ti_no);
        return parts && parts.sequence > selectedParts.sequence;
      });

      return {
        prev: previousRecords.at(-1)?.ti_no || null,
        next: nextRecord?.ti_no || null,
      };
    },
    enabled: options?.query?.enabled !== false && !!tiNo,
    retry: false,
  });
}

export function useListTiRecords(
  filters: ListFilters,
  options?: { query?: { enabled?: boolean } }
) {
  return useQuery({
    queryKey: ["ti-records", filters],
    queryFn: async () => {
      const records = isSupabaseConfigured
        ? await listSupabaseTiRecords(filters)
        : filterTiRecords(getTiRecords(), filters);
      return { records };
    },
    enabled: options?.query?.enabled !== false,
    retry: false,
  });
}

export function useDistinctTiValues(field: keyof TiRecordInput) {
  return useQuery({
    queryKey: ["distinct-ti", field],
    queryFn: async () => {
      if (!isSupabaseConfigured) return getDistinctTiField(field);
      const rows = await supabaseFetch<Array<Record<string, unknown>>>(
        `ct_ti_records?select=${encodeURIComponent(String(field))}`
      );
      const seen = new Set<string>();
      for (const row of rows) {
        const value = row[field as string];
        if (typeof value === "string" && value.trim()) seen.add(value.trim());
      }
      return Array.from(seen).sort();
    },
    staleTime: 5000,
  });
}

export function useDistinctCtTypes() {
  return useQuery({
    queryKey: ["distinct-ct-types"],
    queryFn: async () => {
      if (!isSupabaseConfigured) return getDistinctCtTypes();
      const items = await listSupabaseItems();
      const seen = new Set<string>();
      for (const item of items) {
        if (item.ct_type?.trim()) seen.add(item.ct_type.trim());
      }
      return Array.from(seen).sort();
    },
    staleTime: 5000,
  });
}

export function useGenerateTiNumber() {
  return useMutation({
    mutationFn: async (_args: Record<string, never>) => {
      const tiNo = isSupabaseConfigured
        ? await rpc<string>("preview_ti_number")
        : previewLocalTiNo();
      return { ti_no: tiNo };
    },
  });
}

export function useCreateTiRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: TiRecordInput }) => {
      if (isSupabaseConfigured) {
        return createSupabaseTiRecord(data);
      }

      const records = getTiRecords();
      let tiNo = data.ti_no;
      if (tiNo) {
        if (tiNo === previewLocalTiNo()) incrementTiCounter();
      } else {
        tiNo = generateLocalTiNo();
      }
      if (records.some((record) => record.ti_no === tiNo)) {
        throw new Error("TI number already exists");
      }
      const newRecord: TiRecord = {
        ...normalizeTiInput(data),
        id: crypto.randomUUID(),
        ti_no: tiNo,
        ti_date: data.ti_date || todayIso(),
      };
      records.push(newRecord);
      setTiRecords(records);
      if (data.item_no && data.customer_name) {
        const items = getItems();
        const itemIdx = items.findIndex((i) => i.item_no === data.item_no);
        if (itemIdx !== -1 && !items[itemIdx].default_customer) {
          items[itemIdx].default_customer = String(data.customer_name);
          setItems(items);
        }
      }
      return newRecord;
    },
    onSuccess: (record) => {
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-ti"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-ct-types"] });
      queryClient.invalidateQueries({
        queryKey: getGetTiRecordQueryKey(record.ti_no),
      });
    },
  });
}

export function useUpdateTiRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      tiNo,
      data,
    }: {
      tiNo: string | null;
      data: TiRecordInput;
    }) => {
      if (isSupabaseConfigured) {
        return updateSupabaseTiRecord(tiNo, data);
      }

      const records = getTiRecords();
      const idx = records.findIndex((r) => r.ti_no === tiNo);
      if (idx === -1) throw new Error("TI record not found");
      records[idx] = { ...records[idx], ...normalizeTiInput(data), ti_no: tiNo! };
      setTiRecords(records);
      return records[idx];
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-ti"] });
      queryClient.invalidateQueries({
        queryKey: getGetTiRecordQueryKey(variables.tiNo || ""),
      });
    },
  });
}

export function useCreateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: ItemInput }) => {
      if (isSupabaseConfigured) {
        return createSupabaseItem(data);
      }

      const items = getItems();
      const cleanedItemNo = cleanItemNo(data.item_no);
      if (items.some((item) => item.item_no === cleanedItemNo)) {
        throw new Error("Item already exists");
      }
      const newItem: Item = {
        ...normalizeItemInput(data),
        item_no: cleanedItemNo,
        id: crypto.randomUUID(),
      };
      items.push(newItem);
      setItems(items);
      return newItem;
    },
    onSuccess: (item, variables) => {
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(cleanItemNo(variables.data.item_no)),
      });
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(item.item_no),
      });
      queryClient.invalidateQueries({ queryKey: ["distinct-ct-types"] });
    },
  });
}

export function useUpdateItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      itemNo,
      data,
    }: {
      itemNo: string;
      data: ItemInput;
    }) => {
      const normalized = normalizeItemInput({ ...data, item_no: itemNo });
      if (isSupabaseConfigured) {
        return updateSupabaseItem(itemNo, normalized);
      }

      const items = getItems();
      const cleanedItemNo = cleanItemNo(itemNo);
      const idx = items.findIndex((item) => item.item_no === cleanedItemNo);
      if (idx === -1) throw new Error("Item not found");
      items[idx] = { ...items[idx], ...normalized, item_no: cleanedItemNo };
      setItems(items);
      return items[idx];
    },
    onSuccess: (item, variables) => {
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(cleanItemNo(variables.itemNo)),
      });
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(item.item_no),
      });
      queryClient.invalidateQueries({ queryKey: ["distinct-ct-types"] });
    },
  });
}

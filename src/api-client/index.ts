import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type AppRole = "viewer" | "user" | "checker" | "admin";
export type ApprovalStatus = "pending_check" | "checked" | "rejected";

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  initials: string;
  role: AppRole;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface AppSettings {
  id: boolean;
  default_approver_user_id?: string | null;
  updated_at?: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: {
    id: string;
    email?: string;
  };
}

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

export interface RejectionItem {
  id?: string;
  field_path: string;
  field_label: string;
  field_value?: string;
  corrected_value?: string;
}

export interface ItemInput {
  item_no: string;
  ti_format?: "standard" | "non_standard";
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
  drawing_url?: string;
  drawing_file_name?: string;
  drawing_content_type?: string;
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
  approval_status?: ApprovalStatus;
  created_by_user_id?: string | null;
  checked_by_user_id?: string | null;
  approved_by_user_id?: string | null;
  checked_at?: string | null;
  approved_at?: string | null;
  rejection_items?: RejectionItem[];
  remarks?: string;
  rev_no?: string;
  note?: string;
  [key: string]: unknown;
}

export interface TiRecord extends TiRecordInput {
  id: string;
  ti_no: string;
}

export interface WorkOrderInput {
  work_order: string;
  customer?: string;
  po_no?: string;
  po_date?: string;
  po_line_no?: string;
  item_code?: string;
  our_item_code?: string;
  specification?: string;
  qty?: string;
  sr_no?: string;
  ti_no?: string;
  traceability_sr_no?: string;
  created_by?: string;
  created_by_user_id?: string | null;
}

export interface WorkOrderRecord extends WorkOrderInput {
  id: string;
  created_at: string;
  updated_at: string;
}

interface Item extends ItemInput {
  id: string;
}

type TiNumberRecord = Pick<TiRecord, "ti_no">;
type TiNumberListQueryData = { records: TiNumberRecord[] };

const TI_RECORD_NUMBERS_QUERY_KEY = ["ti-record-numbers"] as const;

type ListFilters = {
  tiNo?: string;
  itemNo?: string;
  customer?: string;
  woNo?: string;
  cusOrderNo?: string;
  ctType?: string;
  dateFrom?: string;
  dateTo?: string;
  approvalStatus?: ApprovalStatus | "all";
};

const directSupabaseUrl = (
  import.meta.env.VITE_SUPABASE_URL || "https://zsjmijuofklsybtynhrm.supabase.co"
).replace(/\/$/, "");
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_915Oeq1rcCOEHW2C6l1QPA_DE0I3Kwf";
export const isSupabaseConfigured = Boolean(directSupabaseUrl && supabaseAnonKey);
const AUTH_SESSION_KEY = "ct_ti_auth_session";
const AUTH_PROFILE_KEY = "ct_ti_auth_profile";
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const proxySupabaseUrl = "/api/supabase";

function readSupabaseErrorMessage(message: string): string {
  if (!message) return "";
  try {
    const parsed = JSON.parse(message);
    if (typeof parsed?.msg === "string") return parsed.msg;
    if (typeof parsed?.message === "string") return parsed.message;
    if (typeof parsed?.error_description === "string") return parsed.error_description;
    if (typeof parsed?.error === "string") return parsed.error;
  } catch {
    // Plain-text Supabase messages are already useful.
  }
  return message;
}

type SupabaseAuthResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  user: {
    id: string;
    email?: string;
  };
};

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
    ti_format: data.ti_format === "non_standard" ? "non_standard" : "standard",
    ct_type: normalizeCtType(data.ct_type),
    default_customer: normalizeCustomer(data.default_customer),
    drawing_url: normalizeText(data.drawing_url),
    drawing_file_name: normalizeText(data.drawing_file_name),
    drawing_content_type: normalizeText(data.drawing_content_type),
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

function getWorkOrders(): WorkOrderRecord[] {
  try {
    return JSON.parse(localStorage.getItem("ct_work_order_records") || "[]");
  } catch {
    return [];
  }
}

function setWorkOrders(records: WorkOrderRecord[]) {
  localStorage.setItem("ct_work_order_records", JSON.stringify(records));
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

export function compareTiNumberValues(a?: string | null, b?: string | null): number {
  const left = a?.trim() || "";
  const right = b?.trim() || "";
  const aParts = parseTiNumber(left);
  const bParts = parseTiNumber(right);
  if (aParts && bParts) {
    return (
      aParts.financialYearStart - bParts.financialYearStart ||
      aParts.financialYearEnd - bParts.financialYearEnd ||
      aParts.sequence - bParts.sequence
    );
  }
  if (aParts) return 1;
  if (bParts) return -1;
  return left.localeCompare(right, undefined, { numeric: true });
}

function compareTiNumbers(a: TiRecord, b: TiRecord): number {
  return compareTiNumberValues(a.ti_no, b.ti_no);
}

function upsertTiNumber(records: TiNumberRecord[], tiNo: string): TiNumberRecord[] {
  if (!tiNo.trim()) return records;
  const nextRecords = records.some((record) => record.ti_no === tiNo)
    ? [...records]
    : [...records, { ti_no: tiNo }];
  return nextRecords.sort((a, b) => compareTiNumberValues(a.ti_no, b.ti_no));
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

function syncLocalTiCounterTo(tiNo?: string | null) {
  const parts = parseTiNumber(tiNo);
  const currentPrefix = currentFinancialYearPrefix();
  if (parts?.prefix !== currentPrefix) return;
  const next = Math.max(getTiCounter(), parts.sequence);
  localStorage.setItem(currentTiCounterKey(), String(next));
}

function allocateLocalTiNo(
  preferredTiNo?: string | null,
  options?: { ignoreWorkOrderId?: string | null; allowExistingTiNo?: string | null }
): string {
  const trimmedTiNo = preferredTiNo?.trim() || "";
  if (!trimmedTiNo) return generateLocalTiNo();

  const allowedExistingTiNo = options?.allowExistingTiNo?.trim() || "";
  const tiExists = getTiRecords().some(
    (record) => record.ti_no === trimmedTiNo && trimmedTiNo !== allowedExistingTiNo
  );
  const workOrderExists = getWorkOrders().some(
    (record) => record.id !== options?.ignoreWorkOrderId && record.ti_no === trimmedTiNo
  );
  if (tiExists || workOrderExists) {
    throw new Error(`TI number already exists: ${trimmedTiNo}`);
  }

  syncLocalTiCounterTo(trimmedTiNo);
  return trimmedTiNo;
}

function readStoredSession(): AuthSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredSession(session: AuthSession | null) {
  if (session) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(AUTH_SESSION_KEY);
}

function readStoredProfile(): UserProfile | null {
  try {
    return JSON.parse(localStorage.getItem(AUTH_PROFILE_KEY) || "null");
  } catch {
    return null;
  }
}

function writeStoredProfile(profile: UserProfile | null) {
  if (profile) localStorage.setItem(AUTH_PROFILE_KEY, JSON.stringify(profile));
  else localStorage.removeItem(AUTH_PROFILE_KEY);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort(
      new DOMException(
        "Request timed out while connecting to the server. Please check your internet connection.",
        "TimeoutError"
      )
    );
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    const errorName = (err as { name?: string })?.name;
    const errorMsg = String((err as { message?: string })?.message || "");
    if (
      errorName === "AbortError" ||
      errorName === "TimeoutError" ||
      errorMsg.toLowerCase().includes("aborted") ||
      errorMsg.includes("signal is aborted")
    ) {
      const customReason = (controller.signal as { reason?: { message?: string } | string })?.reason;
      const customMessage =
        typeof customReason === "object" && customReason?.message
          ? customReason.message
          : typeof customReason === "string" && !customReason.includes("without reason")
          ? customReason
          : null;

      if (customMessage) {
        throw new Error(customMessage);
      }
      throw new Error(
        "Connection timed out or was interrupted. Unable to reach the server. Please check your internet connection or try in a new tab."
      );
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchSupabaseEndpoint(
  subpath: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const cleanPath = subpath.startsWith("/") ? subpath : `/${subpath}`;
  const directUrl = `${directSupabaseUrl}${cleanPath}`;

  // Always use the direct Supabase URL first (standard for production deployments like Vercel, Netlify, etc.)
  if (directSupabaseUrl) {
    try {
      return await fetchWithTimeout(directUrl, init, timeoutMs);
    } catch (directErr) {
      // In local development mode ONLY, if direct call fails (e.g. strict dev restrictions), try dev server proxy
      if (import.meta.env.DEV && typeof window !== "undefined") {
        try {
          const proxyUrl = `${proxySupabaseUrl}${cleanPath}`;
          const proxyRes = await fetchWithTimeout(proxyUrl, init, timeoutMs);
          if (proxyRes.ok || (proxyRes.status !== 404 && proxyRes.status !== 502)) {
            return proxyRes;
          }
        } catch {
          // Dev proxy also failed, throw direct error
        }
      }
      throw directErr;
    }
  }

  // Fallback if directSupabaseUrl is somehow not set
  return await fetchWithTimeout(`${proxySupabaseUrl}${cleanPath}`, init, timeoutMs);
}

function sessionFromAuthResponse(response: SupabaseAuthResponse): AuthSession {
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: response.expires_at || Math.floor(Date.now() / 1000) + (response.expires_in || 3600),
    user: {
      id: response.user.id,
      email: response.user.email,
    },
  };
}

async function authFetch<T>(
  path: string,
  init: RequestInit = {},
  bearerToken?: string
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }

  const response = await fetchSupabaseEndpoint(`/auth/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      ...(bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    const cleanMsg = readSupabaseErrorMessage(message);
    throw new Error(cleanMsg || `Supabase Auth request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function refreshAuthSession(session: AuthSession): Promise<AuthSession> {
  const refreshed = await authFetch<SupabaseAuthResponse>("token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  const nextSession = sessionFromAuthResponse(refreshed);
  writeStoredSession(nextSession);
  return nextSession;
}

async function getValidAuthSession(): Promise<AuthSession | null> {
  const session = readStoredSession();
  if (!session) return null;
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at && session.expires_at - now < 60) {
    try {
      return await refreshAuthSession(session);
    } catch {
      writeStoredSession(null);
      writeStoredProfile(null);
      return null;
    }
  }
  return session;
}

export function getStoredAuthSession(): AuthSession | null {
  return readStoredSession();
}

export function getStoredUserProfile(): UserProfile | null {
  return readStoredProfile();
}

export function canWriteTi(role?: AppRole): boolean {
  return String(role || "").toLowerCase() === "user";
}

export function canWriteWorkOrder(role?: AppRole): boolean {
  return String(role || "").toLowerCase() === "user";
}

export function canCheckTi(role?: AppRole): boolean {
  const normalizedRole = String(role || "").toLowerCase();
  return normalizedRole === "checker" || normalizedRole === "admin";
}

function assertCanWriteWorkOrder() {
  if (!canWriteWorkOrder(readStoredProfile()?.role)) {
    throw new Error("Only User role can create or edit Work Orders.");
  }
}

export async function fetchCurrentProfile(): Promise<UserProfile> {
  const session = await getValidAuthSession();
  if (!session) throw new Error("Please sign in again");

  const rows = await supabaseFetch<UserProfile[]>(
    `profiles?id=eq.${eqFilter(session.user.id)}&select=*&limit=1`
  );
  const profile = rows[0];
  if (!profile) throw new Error("Your user profile is not configured");
  if (!profile.is_active) throw new Error("Your user account is inactive");
  writeStoredProfile(profile);
  return profile;
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ session: AuthSession; profile: UserProfile }> {
  const response = await authFetch<SupabaseAuthResponse>("token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  const session = sessionFromAuthResponse(response);
  writeStoredSession(session);
  const profile = await fetchCurrentProfile();
  return { session, profile };
}

export async function restoreAuthSession(): Promise<{ session: AuthSession; profile: UserProfile } | null> {
  const session = await getValidAuthSession();
  if (!session) return null;
  const profile = await fetchCurrentProfile();
  return { session, profile };
}

export async function signOut(): Promise<void> {
  const session = readStoredSession();
  if (session) {
    try {
      await authFetch("logout", { method: "POST" }, session.access_token);
    } catch {
      // Local cleanup is still required if the remote logout call fails.
    }
  }
  writeStoredSession(null);
  writeStoredProfile(null);
}

async function supabaseFetch<T>(
  path: string,
  init: RequestInit & { prefer?: string } = {}
): Promise<T> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }

  const session = await getValidAuthSession();
  if (!session) {
    throw new Error("Please sign in again");
  }

  const response = await fetchSupabaseEndpoint(`/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(init.prefer ? { Prefer: init.prefer } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(readSupabaseErrorMessage(message) || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function eqFilter(value: string): string {
  return encodeURIComponent(value);
}

function ilikeContainsFilter(value: string): string {
  return encodeURIComponent(`*${value.trim().replace(/\*/g, "")}*`);
}

function buildTiRecordsPath(filters: ListFilters = {}, select = "*"): string {
  const params = [`select=${encodeURIComponent(select)}`];

  if (filters.tiNo) params.push(`ti_no=ilike.${ilikeContainsFilter(filters.tiNo)}`);
  if (filters.itemNo) params.push(`item_no=ilike.${ilikeContainsFilter(filters.itemNo)}`);
  if (filters.customer) params.push(`customer_name=ilike.${ilikeContainsFilter(filters.customer)}`);
  if (filters.woNo) params.push(`wo_number=ilike.${ilikeContainsFilter(filters.woNo)}`);
  if (filters.cusOrderNo) params.push(`cus_order_no=ilike.${ilikeContainsFilter(filters.cusOrderNo)}`);
  if (filters.ctType) params.push(`ct_type=ilike.${ilikeContainsFilter(filters.ctType)}`);
  if (filters.dateFrom) params.push(`ti_date=gte.${eqFilter(filters.dateFrom)}`);
  if (filters.dateTo) params.push(`ti_date=lte.${eqFilter(filters.dateTo)}`);
  if (filters.approvalStatus && filters.approvalStatus !== "all") {
    params.push(`approval_status=eq.${eqFilter(filters.approvalStatus)}`);
  }

  params.push("order=ti_no.desc");
  return `ct_ti_records?${params.join("&")}`;
}

async function countSupabaseRows(table: string, filters: string[] = []): Promise<number> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured");
  }

  const session = await getValidAuthSession();
  if (!session) {
    throw new Error("Please sign in again");
  }

  const query = [`select=id`, `limit=1`, ...filters].join("&");
  const response = await fetchSupabaseEndpoint(`/rest/v1/${table}?${query}`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      Prefer: "count=exact",
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(readSupabaseErrorMessage(message) || `Supabase request failed with ${response.status}`);
  }

  const contentRange = response.headers.get("content-range");
  const total = Number(contentRange?.split("/")[1]);
  if (Number.isFinite(total)) {
    return total;
  }

  const rows = await supabaseFetch<Array<{ id: string }>>(
    `${table}?select=id${filters.length ? `&${filters.join("&")}` : ""}`
  );
  return rows.length;
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
  const records = await supabaseFetch<TiRecord[]>(buildTiRecordsPath(filters));
  return records.sort((a, b) => compareTiNumbers(b, a));
}

async function listSupabaseWorkOrders(): Promise<WorkOrderRecord[]> {
  return supabaseFetch<WorkOrderRecord[]>("ct_work_orders?select=*&order=created_at.asc");
}

async function listSupabaseItems(): Promise<Item[]> {
  return supabaseFetch<Item[]>("ct_items?select=*&order=item_no.asc");
}

async function listSupabaseTiNumbers(prefix?: string): Promise<TiNumberRecord[]> {
  const params = ["select=ti_no", "order=ti_no.asc"];
  if (prefix) {
    params.push(`ti_no=like.${encodeURIComponent(`${prefix}%`)}`);
  }
  return supabaseFetch<TiNumberRecord[]>(`ct_ti_records?${params.join("&")}`);
}

async function listSupabaseProfiles(): Promise<UserProfile[]> {
  return supabaseFetch<UserProfile[]>("profiles?select=*&order=full_name.asc");
}

async function getSupabaseAppSettings(): Promise<AppSettings> {
  const rows = await supabaseFetch<AppSettings[]>("app_settings?id=eq.true&select=*&limit=1");
  return rows[0] || { id: true, default_approver_user_id: null };
}

async function updateSupabaseAppSettings(data: Partial<AppSettings>): Promise<AppSettings> {
  const rows = await supabaseFetch<AppSettings[]>("app_settings?id=eq.true", {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({
      default_approver_user_id: data.default_approver_user_id || null,
    }),
  });
  return rows[0];
}

async function adminUsersRequest<T>(body: Record<string, unknown>): Promise<T> {
  const session = await getValidAuthSession();
  if (!session) throw new Error("Please sign in again");

  const response = await fetchSupabaseEndpoint(`/functions/v1/admin-users`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Admin function failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export type HistoricalDrawingDimensions = {
  dimensions: string[];
  matchedItems: number;
  matchedTokens: string[];
};

export async function findHistoricalDrawingDimensions(
  fileName: string,
  extractedText: string
): Promise<HistoricalDrawingDimensions> {
  const primaryTokens = drawingReferenceTokens(fileName);
  const evidenceTokens = primaryTokens.length ? primaryTokens : drawingReferenceTokens(extractedText);
  if (!evidenceTokens.length) return { dimensions: [], matchedItems: 0, matchedTokens: [] };

  const items = isSupabaseConfigured ? await listSupabaseItems() : getItems();
  const matchedTokens = new Set<string>();
  const matched = items.filter((item) => {
    const itemTokens = drawingReferenceTokens(`${item.ga_drg || ""} ${item.cust_part_code || ""}`);
    const shared = itemTokens.filter((token) => evidenceTokens.includes(token));
    shared.forEach((token) => matchedTokens.add(token));
    return shared.length > 0;
  });
  const dimensions = Array.from(new Set(
    matched.map((item) => item.ct_final_dim?.trim()).filter((value): value is string => Boolean(value))
  )).sort();
  return { dimensions, matchedItems: matched.length, matchedTokens: Array.from(matchedTokens).sort() };
}

function drawingReferenceTokens(value: string): string[] {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return Array.from(new Set(
    normalized.match(/SH\d{2}G\d{3,}|ER\d{6,}|THM\d{5,}|DUB\d{5,}|4CT\d{4,}|\d{9,}/g) || []
  ));
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
  const cleanedItemNo = cleanItemNo(itemNo);
  const nextItemNo = data.item_no ? cleanItemNo(data.item_no) : cleanedItemNo;
  const normalized = normalizeItemInput({ ...data, item_no: nextItemNo } as ItemInput);
  const rows = await supabaseFetch<Item[]>(
    `ct_items?item_no=eq.${eqFilter(cleanedItemNo)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(normalized),
    }
  );
  const item = rows[0];
  if (!item) throw new Error("Item not found or this login cannot update item master");
  return item;
}

function normalizeWorkOrderInput(data: WorkOrderInput): WorkOrderInput {
  return {
    work_order: normalizeText(data.work_order) || "",
    customer: normalizeText(data.customer),
    po_no: normalizeText(data.po_no),
    po_date: normalizeText(data.po_date),
    po_line_no: normalizeText(data.po_line_no),
    item_code: normalizeText(data.item_code),
    our_item_code: data.our_item_code ? cleanItemNo(data.our_item_code) : undefined,
    specification: normalizeText(data.specification),
    qty: normalizeText(data.qty),
    sr_no: normalizeText(data.sr_no),
    ti_no: normalizeText(data.ti_no),
    traceability_sr_no: normalizeText(data.traceability_sr_no),
    created_by: normalizeText(data.created_by),
    created_by_user_id: data.created_by_user_id || null,
  };
}

async function createSupabaseWorkOrder(data: WorkOrderInput): Promise<WorkOrderRecord> {
  const normalized = normalizeWorkOrderInput(data);
  const preferredTiNo = normalized.ti_no?.trim() || null;
  if (preferredTiNo) {
    const duplicate = await supabaseFetch<Array<Pick<WorkOrderRecord, "id">>>(
      `ct_work_orders?ti_no=eq.${eqFilter(preferredTiNo)}&select=id&limit=1`
    );
    if (duplicate.length) throw new Error(`TI number already exists: ${preferredTiNo}`);
  }
  const profile = readStoredProfile();
  const tiNo = await rpc<string>("allocate_work_order_ti_number", {
    preferred_ti_no: preferredTiNo,
    current_work_order_id: null,
  });
  const rows = await supabaseFetch<WorkOrderRecord[]>("ct_work_orders", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify({
      ...normalized,
      ti_no: tiNo,
      created_by: profile?.initials || normalized.created_by || "",
      created_by_user_id: profile?.id || normalized.created_by_user_id || null,
    }),
  });
  return rows[0];
}

async function updateSupabaseWorkOrder(id: string, data: WorkOrderInput): Promise<WorkOrderRecord> {
  const normalized = normalizeWorkOrderInput(data);
  const existingRows = await supabaseFetch<Array<Pick<WorkOrderRecord, "id" | "ti_no">>>(
    `ct_work_orders?id=eq.${eqFilter(id)}&select=id,ti_no&limit=1`
  );
  const existingRecord = existingRows[0];
  if (!existingRecord) throw new Error("Work Order not found");

  const existingTiNo = existingRecord.ti_no?.trim() || "";
  const preferredTiNo = normalized.ti_no?.trim() || existingTiNo || null;
  let tiNo = existingTiNo;

  if (preferredTiNo && preferredTiNo !== existingTiNo) {
    const duplicate = await supabaseFetch<Array<Pick<WorkOrderRecord, "id">>>(
      `ct_work_orders?id=neq.${eqFilter(id)}&ti_no=eq.${eqFilter(preferredTiNo)}&select=id&limit=1`
    );
    if (duplicate.length) throw new Error(`TI number already exists: ${preferredTiNo}`);
    tiNo = await rpc<string>("allocate_work_order_ti_number", {
      preferred_ti_no: preferredTiNo,
      current_work_order_id: id,
    });
  } else if (!tiNo) {
    tiNo = await rpc<string>("allocate_work_order_ti_number", {
      preferred_ti_no: null,
      current_work_order_id: id,
    });
  }

  const rows = await supabaseFetch<WorkOrderRecord[]>(
    `ct_work_orders?id=eq.${eqFilter(id)}`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify({ ...normalized, ti_no: tiNo }),
    }
  );
  return rows[0];
}

async function createSupabaseTiRecord(data: TiRecordInput): Promise<TiRecord> {
  const normalized = normalizeTiInput(data);
  const profile = readStoredProfile();
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
      approval_status: "pending_check",
      created_by: profile?.initials || normalized.created_by || "",
      created_by_user_id: profile?.id || normalized.created_by_user_id || null,
      checked_by: null,
      checked_by_user_id: null,
      checked_at: null,
      approved_by: null,
      approved_by_user_id: null,
      approved_at: null,
      rejection_items: [],
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
  const nextTiNo = data.ti_no?.trim() || tiNo;
  if (nextTiNo !== tiNo) {
    const duplicate = await supabaseFetch<TiRecord[]>(
      `ct_ti_records?ti_no=eq.${eqFilter(nextTiNo)}&select=ti_no&limit=1`
    );
    if (duplicate.length) throw new Error(`TI number already exists: ${nextTiNo}`);
  }

  const record = normalizeRpcRecordResult(await rpc<TiRecord | TiRecord[]>("update_ti_record", {
    p_ti_no: tiNo,
    p_data: { ...normalizeTiInput(data), ti_no: nextTiNo },
  }));
  if (!record) throw new Error("TI record was not updated");
  if (record.ti_no !== nextTiNo) {
    throw new Error(`TI number was not changed to ${nextTiNo}`);
  }
  return record;
}

function normalizeRpcRecordResult(result: TiRecord | TiRecord[]): TiRecord {
  return Array.isArray(result) ? result[0] : result;
}

async function checkSupabaseTiRecord(tiNo: string): Promise<TiRecord> {
  const result = await rpc<TiRecord | TiRecord[]>("check_ti_record", { p_ti_no: tiNo });
  const record = normalizeRpcRecordResult(result);
  if (!record) throw new Error("TI record was not checked");
  return record;
}

async function reopenSupabaseTiRecord(tiNo: string): Promise<TiRecord> {
  const result = await rpc<TiRecord | TiRecord[]>("reopen_ti_record", { p_ti_no: tiNo });
  const record = normalizeRpcRecordResult(result);
  if (!record) throw new Error("TI record was not reopened");
  return record;
}

async function rejectSupabaseTiRecord(tiNo: string, rejectionItems: RejectionItem[] = []): Promise<TiRecord> {
  const result = await rpc<TiRecord | TiRecord[]>("reject_ti_record", {
    p_ti_no: tiNo,
    p_rejection_items: rejectionItems,
  });
  const record = normalizeRpcRecordResult(result);
  if (!record) throw new Error("TI record was not rejected");
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
  if (filters.cusOrderNo) {
    filtered = filtered.filter((r) =>
      r.cus_order_no?.toLowerCase().includes(filters.cusOrderNo!.toLowerCase())
    );
  }
  if (filters.ctType) {
    filtered = filtered.filter((r) =>
      r.ct_type?.toLowerCase().includes(filters.ctType!.toLowerCase())
    );
  }
  if (filters.dateFrom) {
    filtered = filtered.filter((r) => !!r.ti_date && r.ti_date >= filters.dateFrom!);
  }
  if (filters.dateTo) {
    filtered = filtered.filter((r) => !!r.ti_date && r.ti_date <= filters.dateTo!);
  }
  if (filters.approvalStatus && filters.approvalStatus !== "all") {
    filtered = filtered.filter((r) => (r.approval_status || "pending_check") === filters.approvalStatus);
  }
  return filtered.sort((a, b) => compareTiNumbers(b, a));
}

export function getGetItemQueryKey(itemNo: string) {
  return ["item", cleanItemNo(itemNo)];
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

export async function getFirstTiForItemCustomerAsync(
  itemNo: string,
  customerName: string
): Promise<string> {
  const cleanedItemNo = cleanItemNo(itemNo);
  const normalizedCustomer = normalizeCustomer(customerName);
  if (!cleanedItemNo || !normalizedCustomer) return "";

  const records = isSupabaseConfigured
    ? await supabaseFetch<TiRecord[]>(
        `ct_ti_records?item_no=eq.${eqFilter(cleanedItemNo)}&customer_name=eq.${eqFilter(normalizedCustomer)}&select=ti_no`
      )
    : getTiRecords().filter(
        (record) =>
          cleanItemNo(record.item_no || "") === cleanedItemNo &&
          normalizeCustomer(record.customer_name) === normalizedCustomer
      );

  return [...records].sort(compareTiNumbers)[0]?.ti_no || "";
}

export function useGetItem(
  itemNo: string,
  options?: { query?: { enabled?: boolean; retry?: boolean } }
) {
  return useQuery({
    queryKey: getGetItemQueryKey(itemNo),
    queryFn: () => {
      if (isSupabaseConfigured) return findSupabaseItem(itemNo);
      const cleanedItemNo = cleanItemNo(itemNo);
      const found = getItems().find((i) => cleanItemNo(i.item_no) === cleanedItemNo);
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

export function useTiNumberExists(
  tiNo: string,
  options?: { query?: { enabled?: boolean } }
) {
  return useQuery({
    queryKey: ["ti-number-exists", tiNo],
    queryFn: async () => {
      if (isSupabaseConfigured) {
        const rows = await supabaseFetch<Array<Pick<TiRecord, "ti_no">>>(
          `ct_ti_records?ti_no=eq.${eqFilter(tiNo)}&select=ti_no&limit=1`
        );
        return rows.length > 0;
      }
      return getTiRecords().some((record) => record.ti_no === tiNo);
    },
    enabled: options?.query?.enabled !== false && !!tiNo,
    retry: false,
    staleTime: 0,
  });
}

export function useGetAdjacentTiRecords(
  tiNo: string,
  options?: { query?: { enabled?: boolean } }
) {
  return useQuery({
    queryKey: ["ti-adjacent", tiNo],
    queryFn: async () => {
      const selectedParts = parseTiNumber(tiNo);
      if (!selectedParts) return { prev: null, next: null };

      const records = isSupabaseConfigured
        ? await listSupabaseTiNumbers(selectedParts.prefix)
        : getTiRecords();

      const financialYearRecords = records
        .filter((record) => parseTiNumber(record.ti_no)?.prefix === selectedParts.prefix)
        .sort((a, b) => compareTiNumberValues(a.ti_no, b.ti_no));

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

export function useTiStatusCounts(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["ti-status-counts"],
    queryFn: async () => {
      if (isSupabaseConfigured) {
        const [all, pendingCheck, checked, rejected] = await Promise.all([
          countSupabaseRows("ct_ti_records"),
          countSupabaseRows("ct_ti_records", ["approval_status=eq.pending_check"]),
          countSupabaseRows("ct_ti_records", ["approval_status=eq.checked"]),
          countSupabaseRows("ct_ti_records", ["approval_status=eq.rejected"]),
        ]);
        return {
          all,
          pending_check: pendingCheck,
          checked,
          rejected,
        };
      }

      const records = filterTiRecords(getTiRecords(), {});
      const counts = {
        all: records.length,
        pending_check: 0,
        checked: 0,
        rejected: 0,
      };
      for (const record of records) {
        const status = record.approval_status || "pending_check";
        if (status === "checked") counts.checked += 1;
        else if (status === "rejected") counts.rejected += 1;
        else counts.pending_check += 1;
      }
      return counts;
    },
    enabled: options?.query?.enabled !== false,
    retry: false,
  });
}

export function useListTiNumbers(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: TI_RECORD_NUMBERS_QUERY_KEY,
    queryFn: async () => {
      const records = isSupabaseConfigured ? await listSupabaseTiNumbers() : getTiRecords();
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

export function useProfiles(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["profiles"],
    queryFn: listSupabaseProfiles,
    enabled: options?.query?.enabled !== false && isSupabaseConfigured,
    retry: false,
  });
}

export function useAppSettings(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["app-settings"],
    queryFn: getSupabaseAppSettings,
    enabled: options?.query?.enabled !== false && isSupabaseConfigured,
    retry: false,
  });
}

export function useUpdateAppSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ data }: { data: Partial<AppSettings> }) => updateSupabaseAppSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
  });
}

export function useListWorkOrders(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["work-orders"],
    queryFn: async () => {
      const records = isSupabaseConfigured ? await listSupabaseWorkOrders() : getWorkOrders();
      return { records };
    },
    enabled: options?.query?.enabled !== false,
    retry: false,
  });
}

export function useListItems(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const items = isSupabaseConfigured ? await listSupabaseItems() : getItems();
      return { items };
    },
    enabled: options?.query?.enabled !== false,
    retry: false,
  });
}

export function usePreviewWorkOrderTiNumber(options?: { query?: { enabled?: boolean } }) {
  return useQuery({
    queryKey: ["work-order-ti-preview"],
    queryFn: async () => {
      const tiNo = isSupabaseConfigured
        ? await rpc<string>("preview_work_order_ti_number")
        : previewLocalTiNo();
      return { ti_no: tiNo };
    },
    enabled: options?.query?.enabled !== false,
    retry: false,
  });
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }: { data: WorkOrderInput }) => {
      assertCanWriteWorkOrder();
      if (isSupabaseConfigured) {
        return createSupabaseWorkOrder(data);
      }

      const records = getWorkOrders();
      const normalized = normalizeWorkOrderInput(data);
      const tiNo = allocateLocalTiNo(normalized.ti_no || null);
      const now = new Date().toISOString();
      const profile = readStoredProfile();
      const newRecord: WorkOrderRecord = {
        ...normalized,
        id: crypto.randomUUID(),
        ti_no: tiNo,
        created_by: profile?.initials || normalized.created_by || "",
        created_by_user_id: profile?.id || normalized.created_by_user_id || null,
        created_at: now,
        updated_at: now,
      };
      records.push(newRecord);
      setWorkOrders(records);
      return newRecord;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-ti-preview"] });
    },
  });
}

export function useUpdateWorkOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: WorkOrderInput }) => {
      assertCanWriteWorkOrder();
      if (isSupabaseConfigured) {
        return updateSupabaseWorkOrder(id, data);
      }

      const records = getWorkOrders();
      const index = records.findIndex((record) => record.id === id);
      if (index === -1) throw new Error("Work Order not found");

      const currentRecord = records[index];
      const normalized = normalizeWorkOrderInput(data);
      const tiNo = allocateLocalTiNo(normalized.ti_no || currentRecord.ti_no || null, {
        ignoreWorkOrderId: id,
        allowExistingTiNo: currentRecord.ti_no || null,
      });

      records[index] = {
        ...currentRecord,
        ...normalized,
        ti_no: tiNo,
        updated_at: new Date().toISOString(),
      };
      setWorkOrders(records);
      return records[index];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-orders"] });
      queryClient.invalidateQueries({ queryKey: ["work-order-ti-preview"] });
    },
  });
}

export function useAdminCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      email: string;
      password: string;
      full_name: string;
      role: AppRole;
      is_active?: boolean;
    }) => adminUsersRequest<{ profile: UserProfile }>({ action: "create", ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
    },
  });
}

export function useAdminUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: string;
      full_name?: string;
      role?: AppRole;
      is_active?: boolean;
      password?: string;
    }) => adminUsersRequest<{ profile: UserProfile | null }>({ action: "update", ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["app-settings"] });
    },
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

export function useCheckTiRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tiNo }: { tiNo: string }) => {
      if (isSupabaseConfigured) return checkSupabaseTiRecord(tiNo);
      const records = getTiRecords();
      const idx = records.findIndex((record) => record.ti_no === tiNo);
      if (idx === -1) throw new Error("TI record not found");
      records[idx] = { ...records[idx], approval_status: "checked", rejection_items: [] };
      setTiRecords(records);
      return records[idx];
    },
    onSuccess: (record) => {
      queryClient.removeQueries({ queryKey: getGetTiRecordQueryKey(record.ti_no) });
      queryClient.setQueryData(getGetTiRecordQueryKey(record.ti_no), record);
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: ["ti-adjacent"] });
      queryClient.invalidateQueries({ queryKey: ["ti-status-counts"] });
    },
  });
}

export function useRejectTiRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tiNo, rejectionItems = [] }: { tiNo: string; rejectionItems?: RejectionItem[] }) => {
      if (isSupabaseConfigured) return rejectSupabaseTiRecord(tiNo, rejectionItems);
      const records = getTiRecords();
      const idx = records.findIndex((record) => record.ti_no === tiNo);
      if (idx === -1) throw new Error("TI record not found");
      records[idx] = {
        ...records[idx],
        approval_status: "rejected",
        checked_by: "",
        approved_by: "",
        checked_at: null,
        approved_at: null,
        rejection_items: rejectionItems,
      };
      setTiRecords(records);
      return records[idx];
    },
    onSuccess: (record) => {
      queryClient.removeQueries({ queryKey: getGetTiRecordQueryKey(record.ti_no) });
      queryClient.setQueryData(getGetTiRecordQueryKey(record.ti_no), record);
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: ["ti-adjacent"] });
      queryClient.invalidateQueries({ queryKey: ["ti-status-counts"] });
    },
  });
}

export function useReopenTiRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tiNo }: { tiNo: string }) => {
      if (isSupabaseConfigured) return reopenSupabaseTiRecord(tiNo);
      const records = getTiRecords();
      const idx = records.findIndex((record) => record.ti_no === tiNo);
      if (idx === -1) throw new Error("TI record not found");
      records[idx] = {
        ...records[idx],
        approval_status: "pending_check",
        checked_by: "",
        approved_by: "",
        checked_at: null,
        approved_at: null,
        rejection_items: [],
      };
      setTiRecords(records);
      return records[idx];
    },
    onSuccess: (record) => {
      queryClient.removeQueries({ queryKey: getGetTiRecordQueryKey(record.ti_no) });
      queryClient.setQueryData(getGetTiRecordQueryKey(record.ti_no), record);
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: ["ti-adjacent"] });
      queryClient.invalidateQueries({ queryKey: ["ti-status-counts"] });
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
        approval_status: "pending_check",
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
      queryClient.removeQueries({ queryKey: ["ti-number-exists"] });
      queryClient.setQueryData<TiNumberListQueryData>(TI_RECORD_NUMBERS_QUERY_KEY, (current) => ({
        records: upsertTiNumber(current?.records || [], record.ti_no),
      }));
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: TI_RECORD_NUMBERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["ti-status-counts"] });
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
      const nextTiNo = data.ti_no?.trim() || tiNo!;
      if (nextTiNo !== tiNo && records.some((record) => record.ti_no === nextTiNo)) {
        throw new Error("TI number already exists");
      }
      records[idx] = { ...records[idx], ...normalizeTiInput(data), ti_no: nextTiNo };
      setTiRecords(records);
      return records[idx];
    },
    onSuccess: (record, variables) => {
      queryClient.removeQueries({ queryKey: ["ti-number-exists"] });
      queryClient.removeQueries({
        queryKey: getGetTiRecordQueryKey(variables.tiNo || ""),
      });
      queryClient.setQueryData<TiNumberListQueryData>(TI_RECORD_NUMBERS_QUERY_KEY, (current) => ({
        records: upsertTiNumber(
          (current?.records || []).filter((tiRecord) => tiRecord.ti_no !== variables.tiNo),
          record.ti_no
        ),
      }));
      queryClient.setQueryData(getGetTiRecordQueryKey(record.ti_no), record);
      queryClient.invalidateQueries({ queryKey: ["ti-records"] });
      queryClient.invalidateQueries({ queryKey: TI_RECORD_NUMBERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["ti-status-counts"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-ti"] });
      queryClient.invalidateQueries({ queryKey: ["ti-adjacent"] });
      queryClient.invalidateQueries({
        queryKey: getGetTiRecordQueryKey(record.ti_no),
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
      const cleanedItemNo = cleanItemNo(variables.data.item_no);
      if (item) {
        queryClient.setQueryData(getGetItemQueryKey(cleanedItemNo), item);
        queryClient.setQueryData(getGetItemQueryKey(item.item_no), item);
        queryClient.setQueryData<{ items: Item[] }>(["items"], (current) =>
          current
            ? {
                items: [...current.items.filter((entry) => entry.item_no !== item.item_no), item].sort((a, b) =>
                  a.item_no.localeCompare(b.item_no, undefined, { numeric: true })
                ),
              }
            : current
        );
      }
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(cleanedItemNo),
      });
      if (item?.item_no) {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(item.item_no),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["items"] });
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
      const normalized = normalizeItemInput({
        ...data,
        item_no: data.item_no ? data.item_no : itemNo,
      });
      if (isSupabaseConfigured) {
        return updateSupabaseItem(itemNo, normalized);
      }

      const items = getItems();
      const cleanedItemNo = cleanItemNo(itemNo);
      const nextItemNo = cleanItemNo(normalized.item_no);
      const idx = items.findIndex((item) => item.item_no === cleanedItemNo);
      if (idx === -1) throw new Error("Item not found");
      if (nextItemNo !== cleanedItemNo && items.some((item, itemIndex) => itemIndex !== idx && item.item_no === nextItemNo)) {
        throw new Error("Item already exists");
      }
      items[idx] = { ...items[idx], ...normalized, item_no: nextItemNo };
      setItems(items);
      return items[idx];
    },
    onSuccess: (item, variables) => {
      const cleanedItemNo = cleanItemNo(variables.itemNo);
      queryClient.setQueryData(getGetItemQueryKey(cleanedItemNo), item);
      queryClient.setQueryData(getGetItemQueryKey(item.item_no), item);
      queryClient.setQueryData<{ items: Item[] }>(["items"], (current) =>
        current
          ? {
              items: [
                ...current.items.filter(
                  (entry) => entry.item_no !== cleanedItemNo && entry.item_no !== item.item_no
                ),
                item,
              ].sort((a, b) => a.item_no.localeCompare(b.item_no, undefined, { numeric: true })),
            }
          : current
      );
      queryClient.invalidateQueries({
        queryKey: getGetItemQueryKey(cleanedItemNo),
      });
      if (item?.item_no) {
        queryClient.invalidateQueries({
          queryKey: getGetItemQueryKey(item.item_no),
        });
      }
      queryClient.invalidateQueries({ queryKey: ["items"] });
      queryClient.invalidateQueries({ queryKey: ["distinct-ct-types"] });
    },
  });
}

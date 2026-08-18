const CORS_ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type";
const CORS_ALLOW_METHODS = "POST, OPTIONS";
const DEFAULT_ALLOWED_ORIGINS = ["https://ct-ti.vercel.app", "http://localhost:*", "http://127.0.0.1:*"];
const REQUEST_TIMEOUT_MS = 15_000;

type AppRole = "viewer" | "user" | "checker" | "admin";
const VALID_ROLES: AppRole[] = ["viewer", "user", "checker", "admin"];

type AdminRequest =
  | {
      action: "create";
      email: string;
      password: string;
      full_name: string;
      role: AppRole;
      is_active?: boolean;
    }
  | {
      action: "update";
      id: string;
      full_name?: string;
      role?: AppRole;
      is_active?: boolean;
      password?: string;
    };

function getAllowedOrigins(): string[] {
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function originMatchesPattern(origin: string, pattern: string): boolean {
  const escapedPattern = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escapedPattern}$`, "i").test(origin);
}

function getAllowedOrigin(origin: string | null): string {
  if (!origin) return "";
  return getAllowedOrigins().some((pattern) => originMatchesPattern(origin, pattern)) ? origin : "";
}

function corsHeaders(origin: string | null) {
  const allowedOrigin = getAllowedOrigin(origin);
  return {
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": allowedOrigin } : {}),
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Allow-Methods": CORS_ALLOW_METHODS,
    Vary: "Origin",
  };
}

function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function initialsFromName(fullName: string): string {
  const initials = fullName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase()}.`)
    .join("");
  return initials || "U.";
}

function normalizeRole(value: unknown): AppRole | null {
  const role = String(value || "").trim().toLowerCase();
  return VALID_ROLES.includes(role as AppRole) ? (role as AppRole) : null;
}

async function supabaseFetch<T>(
  path: string,
  init: RequestInit,
  serviceRoleKey: string,
  supabaseUrl: string
): Promise<T> {
  const response = await fetchWithTimeout(`${supabaseUrl}${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase request failed with ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = getAllowedOrigin(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: allowedOrigin || !origin ? 204 : 403,
      headers: corsHeaders(origin),
    });
  }

  if (origin && !allowedOrigin) {
    return json(403, { error: "Origin not allowed" }, origin);
  }

  if (request.method !== "POST") {
    return json(405, { error: "Method not allowed" }, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Missing Supabase function environment variables" }, origin);
  }

  const authHeader = request.headers.get("Authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) return json(401, { error: "Missing access token" }, origin);

  try {
    const caller = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${callerToken}`,
      },
    });

    if (!caller.ok) return json(401, { error: "Invalid access token" }, origin);
    const callerUser = await caller.json();

    let callerProfiles = await supabaseFetch<Array<{ role: string; is_active: boolean }>>(
      `/rest/v1/profiles?id=eq.${encodeURIComponent(callerUser.id)}&select=role,is_active&limit=1`,
      { method: "GET" },
      serviceRoleKey,
      supabaseUrl
    );

    if (!callerProfiles.length && callerUser.email) {
      callerProfiles = await supabaseFetch<Array<{ role: string; is_active: boolean }>>(
        `/rest/v1/profiles?email=eq.${encodeURIComponent(String(callerUser.email).toLowerCase())}&select=role,is_active&limit=1`,
        { method: "GET" },
        serviceRoleKey,
        supabaseUrl
      );
    }

    const callerProfile = callerProfiles[0];
    if (!callerProfile?.is_active || String(callerProfile.role || "").toLowerCase() !== "admin") {
      return json(403, { error: "Admin role required" }, origin);
    }

    const body = (await request.json()) as AdminRequest;

    if (body.action === "create") {
      const role = normalizeRole(body.role);
      if (!body.email || !body.password || !body.full_name || !role) {
        return json(400, { error: "Email, password, full name, and role are required" }, origin);
      }

      const created = await supabaseFetch<{ id: string; email: string }>(
        "/auth/v1/admin/users",
        {
          method: "POST",
          body: JSON.stringify({
            email: body.email,
            password: body.password,
            email_confirm: true,
            user_metadata: {
              full_name: body.full_name,
            },
          }),
        },
        serviceRoleKey,
        supabaseUrl
      );

      const profile = {
        id: created.id,
        email: created.email || body.email,
        full_name: body.full_name,
        initials: initialsFromName(body.full_name),
        role,
        is_active: body.is_active ?? true,
      };

      const profiles = await supabaseFetch<unknown[]>(
        "/rest/v1/profiles?on_conflict=id",
        {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=representation" },
          body: JSON.stringify(profile),
        },
        serviceRoleKey,
        supabaseUrl
      );

      return json(200, { profile: profiles[0] }, origin);
    }

    if (body.action === "update") {
      if (!body.id) return json(400, { error: "User id is required" }, origin);

      const patch: Record<string, unknown> = {};
      if (typeof body.full_name === "string") {
        patch.full_name = body.full_name;
        patch.initials = initialsFromName(body.full_name);
      }
      if (typeof body.role === "string") {
        const role = normalizeRole(body.role);
        if (!role) return json(400, { error: "Invalid role" }, origin);
        patch.role = role;
      }
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;

      let profiles: unknown[] = [];
      if (Object.keys(patch).length) {
        profiles = await supabaseFetch<unknown[]>(
          `/rest/v1/profiles?id=eq.${encodeURIComponent(body.id)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify(patch),
          },
          serviceRoleKey,
          supabaseUrl
        );
      }

      if (body.password) {
        await supabaseFetch(
          `/auth/v1/admin/users/${encodeURIComponent(body.id)}`,
          {
            method: "PUT",
            body: JSON.stringify({ password: body.password }),
          },
          serviceRoleKey,
          supabaseUrl
        );
      }

      return json(200, { profile: profiles[0] || null }, origin);
    }

    return json(400, { error: "Unsupported action" }, origin);
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : String(error) }, origin);
  }
});

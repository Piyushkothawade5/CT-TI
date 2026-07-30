# Cloudflare Drawing Storage

Use Cloudflare R2 for the drawing files and keep only the drawing URL in Supabase.

## Supabase

For an existing Supabase project, run:

```sql
-- supabase/item_drawing_links_patch.sql
alter table public.ct_items
  add column if not exists drawing_url text,
  add column if not exists drawing_file_name text,
  add column if not exists drawing_content_type text;
```

Fresh installs already include these columns in `supabase/bootstrap_complete.sql`.

## App Environment

Add these values to `.env`:

```bash
VITE_DRAWING_UPLOAD_URL=https://your-cloudflare-worker.example.com/upload
VITE_DRAWING_UPLOAD_TOKEN=
```

`VITE_DRAWING_UPLOAD_TOKEN` is optional. Any Vite value is visible in the browser, so do not put R2 secret keys in it. Keep real Cloudflare credentials inside the Worker.

## Worker Shape

The app sends a `POST` request with `multipart/form-data`:

- `file`
- `item_no`
- `file_name`
- `content_type`

The Worker should upload the file to R2 and return JSON with one of these URL fields:

```json
{ "url": "https://ct-ti-drawing-upload.example.workers.dev/drawings/38400191/file.pdf" }
```

The app also accepts `publicUrl`, `public_url`, `drawing_url`, or `href`.

## Minimal Worker Example

```ts
export interface Env {
  DRAWINGS: R2Bucket;
  UPLOAD_TOKEN?: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === "GET") {
      const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const object = await env.DRAWINGS.get(key);
      if (!object) return new Response("Drawing not found", { status: 404, headers: corsHeaders });

      return new Response(object.body, {
        headers: {
          ...corsHeaders,
          "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (request.method !== "POST" || url.pathname !== "/upload") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    if (env.UPLOAD_TOKEN) {
      const expected = `Bearer ${env.UPLOAD_TOKEN}`;
      if (request.headers.get("Authorization") !== expected) {
        return new Response("Unauthorized", { status: 401, headers: corsHeaders });
      }
    }

    const form = await request.formData();
    const file = form.get("file");
    const itemNo = String(form.get("item_no") || "").replace(/[^0-9]/g, "");
    const fileName = safeFileName(String(form.get("file_name") || "drawing"));

    if (!(file instanceof File) || !itemNo) {
      return new Response("Missing file or item_no", { status: 400, headers: corsHeaders });
    }

    const key = `drawings/${itemNo}/${Date.now()}-${fileName}`;
    await env.DRAWINGS.put(key, file.stream(), {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
    });

    return Response.json(
      { url: `${url.origin}/${key}` },
      { headers: corsHeaders }
    );
  },
};

function safeFileName(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "drawing";
}
```

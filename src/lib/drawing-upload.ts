export type DrawingUploadResult = {
  drawing_url: string;
  drawing_file_name: string;
  drawing_content_type: string;
};

type UploadResponse = {
  url?: unknown;
  publicUrl?: unknown;
  public_url?: unknown;
  drawing_url?: unknown;
  href?: unknown;
};

const uploadEndpoint = import.meta.env.VITE_DRAWING_UPLOAD_URL || "";
const uploadToken = import.meta.env.VITE_DRAWING_UPLOAD_TOKEN || "";

export function isDrawingUploadConfigured(): boolean {
  return Boolean(uploadEndpoint.trim());
}

export async function uploadDrawingFile(file: File, itemNo: string): Promise<DrawingUploadResult> {
  const endpoint = uploadEndpoint.trim();
  if (!endpoint) {
    throw new Error(
      "Cloudflare drawing upload is not configured. Add VITE_DRAWING_UPLOAD_URL for the Cloudflare Worker upload endpoint."
    );
  }

  const body = new FormData();
  body.append("file", file);
  body.append("item_no", itemNo);
  body.append("file_name", file.name);
  body.append("content_type", file.type || "application/octet-stream");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: uploadToken ? { Authorization: `Bearer ${uploadToken}` } : undefined,
    body,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Drawing upload failed with ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? ((await response.json()) as UploadResponse)
    : { url: await response.text() };

  const drawingUrl = pickUrl(payload);
  if (!drawingUrl) {
    throw new Error("Drawing upload completed, but no public URL was returned.");
  }

  return {
    drawing_url: drawingUrl,
    drawing_file_name: file.name,
    drawing_content_type: file.type || "application/octet-stream",
  };
}

function pickUrl(payload: UploadResponse): string {
  const value =
    payload.url ||
    payload.publicUrl ||
    payload.public_url ||
    payload.drawing_url ||
    payload.href;
  return typeof value === "string" ? value.trim() : "";
}

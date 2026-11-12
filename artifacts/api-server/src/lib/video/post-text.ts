import type { VideoRenderOptions } from "@workspace/api-zod";
import { CreativeError } from "../creative-policy";

// Project only the render input; never erase text from saved concepts/history.
export function videoPostText(
  saved: { cta: string; disclaimer?: string | null },
  mode: VideoRenderOptions["postTextMode"],
  sharedFolder: boolean,
) {
  if (mode === "MANUAL_AFTER_DOWNLOAD") {
    if (!sharedFolder) throw new CreativeError(403, "Teks tambahan manual hanya tersedia di studio bersama.");
    return { cta: "", disclaimer: "" };
  }
  const text = { cta: saved.cta, disclaimer: saved.disclaimer ?? "" };
  if (!text.disclaimer.trim() || text.disclaimer.length > 220 || text.cta.length > 90) {
    throw new CreativeError(400, "Isi disclaimer di konsep (maks220 karakter); CTA maksimal90 karakter, lalu review ulang.");
  }
  return text;
}

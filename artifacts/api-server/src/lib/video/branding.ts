import type { VideoRenderOptions } from "@workspace/api-zod";
import { CreativeError } from "../creative-policy";

type Material = { id: string; contentType: string; finalPath: string | null };
export function resolveLogo<T extends Material>(options: VideoRenderOptions, shared: boolean, materials: T[]): T | null {
  if (options.brandingMode === "NONE") {
    if (!shared) throw new CreativeError(403, "Video tanpa logo hanya tersedia di studio bersama.");
    return null;
  }
  const logo = materials.find(m => m.id === options.logoAttachmentId && m.contentType.startsWith("image/"));
  if (!logo?.finalPath) throw new CreativeError(400, "Pilih logo asli dari gambar bahan yang sudah direview. Tidak membuat ulang logo perusahaan.");
  return logo;
}
export function legacyLogoIds(previous: VideoRenderOptions[], materials: Material[]) {
  const images = new Set(materials.filter(m => m.contentType.startsWith("image/")).map(m => m.id));
  return [...new Set(previous.filter(o => o.brandingMode !== "NONE").map(o => o.logoAttachmentId)
    .filter((id): id is string => !!id && images.has(id)))];
}
export function sceneMaterials<T extends { id: string }>(materials: T[], options: VideoRenderOptions, logoId?: string) {
  const excluded = new Set(options.brandingMode === "NONE" ? options.legacyLogoAttachmentIds ?? [] : []);
  if (logoId) excluded.add(logoId);
  return materials.filter(m => !excluded.has(m.id));
}

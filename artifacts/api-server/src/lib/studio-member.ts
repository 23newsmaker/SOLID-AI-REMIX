import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, members, studioFolders } from "@workspace/db";
import type { Request, Response } from "express";
import { CreativeError } from "./creative-policy";
import { readStudioSession } from "./studio-access";
import { creatorForFolder } from "./studio-policy";

const urlKeys = new Set(["url", "photoUrl", "resultUrl", "rawResultUrl", "publicationUrl", "referenceUrl"]);
function scopedUrls(value: unknown, folderId: string, key = ""): unknown {
  if (typeof value === "string" && urlKeys.has(key) && value.startsWith("/api/")) {
    const url = new URL(value, "https://studio.invalid");
    url.searchParams.set("folder", folderId);
    return `${url.pathname}${url.search}`;
  }
  if (Array.isArray(value)) return value.map(v => scopedUrls(v, folderId));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scopedUrls(v, folderId, k)]));
  }
  return value;
}

export async function attachStudioMember(req: Request, res: Response): Promise<boolean> {
  if (req.studioFolderId && req.member) return true;
  const header = req.get("X-Solid-Folder");
  const query = req.query.folder;
  if (header === undefined && query === undefined) return false;
  if (query !== undefined && typeof query !== "string") throw new CreativeError(400, "Folder tidak valid.");
  if (header && query && header !== query) throw new CreativeError(400, "Folder permintaan tidak cocok.");
  const folderId = header ?? query;
  if (!folderId || !/^[a-zA-Z0-9-]{1,80}$/.test(folderId)) throw new CreativeError(400, "Pilih folder anggota yang valid.");
  const session = readStudioSession(req);
  if (!session) throw new CreativeError(401, "Sesi studio berakhir. Masukkan kembali password studio.");
  const [found] = await db.select({ folder: studioFolders, member: members }).from(studioFolders)
    .innerJoin(members, and(eq(studioFolders.memberId, members.id), eq(members.status, "ACTIVE")))
    .where(eq(studioFolders.id, folderId));
  if (!found) throw new CreativeError(404, "Folder anggota tidak tersedia.");

  // A folder is NOT an identity. Even the owner's folder only grants CREATOR.
  req.member = creatorForFolder(found.member, found.folder);
  req.studioFolderId = found.folder.id;
  req.studioSessionHash = createHash("sha256").update(session.id).digest("hex");
  const originalJson = res.json.bind(res);
  res.json = body => originalJson(scopedUrls(body, found.folder.id));
  return true;
}

import type { MemberRecord } from "@workspace/db";
import { CreativeError } from "./creative-policy";

export function creatorForFolder(member: MemberRecord, folder: { memberId: string; name: string }): MemberRecord {
  if (member.id !== folder.memberId || member.status !== "ACTIVE") throw new CreativeError(403, "Folder tidak tersedia.");
  return { ...member, name: folder.name, email: "folder@studio.invalid", role: "CREATOR", status: "ACTIVE" };
}
export function equalStudioBinding(a: unknown, b: unknown) {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>;
  return ["digest", "resultHash", "md5", "generation"].every(k => typeof first[k] === "string" && first[k].length > 0 && first[k] === second[k]);
}

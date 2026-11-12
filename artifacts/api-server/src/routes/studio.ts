import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { db, studioFolders, members, characters } from "@workspace/db";
import {
  EnterStudioBody, GetStudioSessionResponse, ListStudioFoldersResponse,
  CreateStudioFolderBody, CreateStudioFolderResponse, ShareStudioFolderBody,
  ShareStudioFolderResponse,
} from "@workspace/api-zod";
import {
  STUDIO_COOKIE, studioConfigured, readStudioSession, newStudioToken,
  validStudioPassword, studioCookieOptions, requireStudio, studioLoginLimit,
} from "../lib/studio-access";
import { requireMember, requireActive } from "../middlewares/member";
import { CreativeError } from "../lib/creative-policy";
import { getSettings } from "../lib/operations/controls";
import { quotaDay } from "../lib/video/policy";
import { audit } from "../lib/operations/audit";

export const studioRouter = Router();
studioRouter.get("/studio/session", (req, res) => {
  res.json(GetStudioSessionResponse.parse({ configured: studioConfigured(), authenticated: !!readStudioSession(req) }));
});
studioRouter.post("/studio/session", studioLoginLimit, (req, res) => {
  const { password } = EnterStudioBody.parse(req.body);
  if (!studioConfigured()) throw new CreativeError(503, "Password studio belum diatur oleh pemilik.");
  if (!validStudioPassword(password)) throw new CreativeError(401, "Password studio tidak cocok.");
  res.cookie(STUDIO_COOKIE, newStudioToken(), studioCookieOptions);
  res.json(GetStudioSessionResponse.parse({ configured: true, authenticated: true }));
});
studioRouter.delete("/studio/session", (_req, res) => {
  const { maxAge: _maxAge, ...options } = studioCookieOptions;
  res.clearCookie(STUDIO_COOKIE, options);
  res.json({ ok: true });
});

async function folderList(id?: string) {
  const settings = await getSettings();
  const rows = await db.select({
    folder: studioFolders, characterName: characters.name, revision: characters.updatedAt,
    used: sql<number>`(SELECT count(*)::int FROM solid_video_jobs j WHERE j.owner_id = ${studioFolders.memberId}
      AND j.quota_day = ${quotaDay()} AND j.simulation = false)`,
  }).from(studioFolders).innerJoin(members, and(eq(members.id, studioFolders.memberId), eq(members.status, "ACTIVE")))
    .leftJoin(characters, eq(characters.userId, studioFolders.memberId))
    .where(id ? eq(studioFolders.id, id) : undefined).orderBy(asc(studioFolders.createdAt));
  return rows.map(r => ({
    id: r.folder.id, memberId: r.folder.memberId, name: r.folder.name,
    characterName: r.characterName,
    photoUrl: r.revision ? `/api/character/photo?folder=${encodeURIComponent(r.folder.id)}&v=${encodeURIComponent(r.revision.toISOString())}` : null,
    dailyUsed: Number(r.used), dailyLimit: Math.min(3, settings.dailyLimit),
  }));
}
studioRouter.get("/studio/folders", requireStudio, async (_req, res) => {
  res.json(ListStudioFoldersResponse.parse(await folderList()));
});
studioRouter.post("/studio/folders", requireStudio, async (req, res) => {
  const { name } = CreateStudioFolderBody.parse(req.body);
  const trimmed = name.trim();
  if (!trimmed) throw new CreativeError(400, "Isi nama anggota.");
  const folderId = randomUUID(), memberId = `studio_${randomUUID()}`;
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71018001)`);
    const [duplicate] = await tx.select({ id: studioFolders.id }).from(studioFolders)
      .where(sql`lower(${studioFolders.name}) = lower(${trimmed})`);
    if (duplicate) throw new CreativeError(409, "Nama sudah dipakai. Buka folder anggota tersebut atau bedakan namanya.");
    await tx.insert(members).values({
      id: memberId, email: "folder@studio.invalid", name: trimmed, role: "CREATOR", status: "ACTIVE",
    });
    await tx.insert(studioFolders).values({ id: folderId, memberId, name: trimmed, sharedBy: `session:${req.studioSessionHash}` });
    await audit(memberId, "STUDIO_FOLDER_CREATED", folderId, null,
      { folderId, sessionHash: req.studioSessionHash, identityVerified: false }, tx);
  });
  res.json(CreateStudioFolderResponse.parse((await folderList(folderId))[0]));
});

// This is an explicit opt-in, not an automatic migration of old private assets.
studioRouter.post("/studio/share", requireMember, requireActive, async (req, res) => {
  if (!studioConfigured()) throw new CreativeError(503, "Password studio belum diatur; data lama belum dibagikan.");
  const input = ShareStudioFolderBody.parse(req.body);
  if (!input.consent || req.studioFolderId) throw new CreativeError(403, "Masuk sebagai pemilik/admin dan setujui pembagian folder lama.");
  const me = req.member!;
  if (input.memberId !== me.id && !["SUPER_ADMIN", "ADMIN"].includes(me.role)) {
    throw new CreativeError(403, "Hanya pemilik folder atau admin yang dapat membagikan data lama.");
  }
  const folder = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71018001)`);
    const [owner] = await tx.select().from(members).where(eq(members.id, input.memberId));
    if (!owner || owner.status !== "ACTIVE") throw new CreativeError(404, "Anggota aktif tidak ditemukan.");
    const [old] = await tx.select().from(studioFolders).where(eq(studioFolders.memberId, owner.id));
    if (old) return old;
    const [created] = await tx.insert(studioFolders).values({
      id: randomUUID(), memberId: owner.id, name: owner.name, sharedBy: me.id,
    }).returning();
    await audit(me.id, "STUDIO_LEGACY_FOLDER_SHARED", owner.id, null,
      { folderId: created!.id, explicitConsent: true }, tx);
    return created!;
  });
  res.json(ShareStudioFolderResponse.parse((await folderList(folder.id))[0]));
});

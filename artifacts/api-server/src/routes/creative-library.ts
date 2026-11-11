import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, creativeCategories, creativeTemplates, auditLog } from "@workspace/db";
import {
  GetCreativeLibraryResponse, CreateCreativeCategoryBody, CreateCreativeCategoryResponse,
  UpdateCreativeCategoryParams, UpdateCreativeCategoryBody, UpdateCreativeCategoryResponse,
  CreateCreativeTemplateBody, CreateCreativeTemplateResponse, UpdateCreativeTemplateParams,
  UpdateCreativeTemplateBody, UpdateCreativeTemplateResponse,
} from "@workspace/api-zod";
import { libraryAdmin, limits, CreativeError } from "../lib/creative-policy";
import { seedCreativeLibrary } from "../lib/creative-seed";

export const creativeLibraryRouter = Router();
creativeLibraryRouter.get("/library", async (req, res) => {
  await seedCreativeLibrary();
  const admin = libraryAdmin(req.member!);
  const categories = await db.select().from(creativeCategories).where(admin ? undefined : eq(creativeCategories.active, true));
  const templates = await db.select().from(creativeTemplates).where(admin ? undefined : eq(creativeTemplates.active, true));
  res.json(GetCreativeLibraryResponse.parse({ categories, templates, ...limits }));
});
creativeLibraryRouter.use(["/categories", "/templates"], (req, _res, next) => {
  if (!libraryAdmin(req.member!)) throw new CreativeError(403, "Hanya admin dapat mengelola pustaka kreatif.");
  next();
});
creativeLibraryRouter.post("/categories", async (req, res) => {
  const input = CreateCreativeCategoryBody.parse(req.body);
  if (!input.name.trim()) throw new CreativeError(400, "Nama kategori wajib diisi.");
  const [row] = await db.insert(creativeCategories).values({ ...input, id: randomUUID() }).returning();
  res.json(CreateCreativeCategoryResponse.parse(row));
});
creativeLibraryRouter.put("/categories/:id", async (req, res) => {
  const { id } = UpdateCreativeCategoryParams.parse(req.params);
  const { version, ...input } = UpdateCreativeCategoryBody.parse(req.body);
  if (!input.name.trim()) throw new CreativeError(400, "Nama kategori wajib diisi.");
  const [row] = await db.update(creativeCategories).set({ ...input, version: version + 1 })
    .where(and(eq(creativeCategories.id, id), eq(creativeCategories.version, version))).returning();
  if (!row) throw new CreativeError(409, "Kategori berubah. Muat versi terbaru sebelum menyimpan.");
  await db.insert(auditLog).values({ id: randomUUID(), userId: req.member!.id, action: "CREATIVE_CATEGORY_UPDATED", description: "Kategori kreatif diperbarui; snapshot konsep lama tetap dipertahankan." });
  res.json(UpdateCreativeCategoryResponse.parse(row));
});
async function categoryExists(id: string) {
  const [category] = await db.select().from(creativeCategories).where(eq(creativeCategories.id, id));
  if (!category) throw new CreativeError(400, "Kategori tidak ditemukan.");
}
creativeLibraryRouter.post("/templates", async (req, res) => {
  const input = CreateCreativeTemplateBody.parse(req.body);
  if (!input.name.trim() || new Set(input.segments).size !== input.segments.length) throw new CreativeError(400, "Nama/pilihan segmen template tidak valid.");
  await categoryExists(input.categoryId);
  const [row] = await db.insert(creativeTemplates).values({ ...input, id: randomUUID() }).returning();
  res.json(CreateCreativeTemplateResponse.parse(row));
});
creativeLibraryRouter.put("/templates/:id", async (req, res) => {
  const { id } = UpdateCreativeTemplateParams.parse(req.params);
  const { version, ...input } = UpdateCreativeTemplateBody.parse(req.body);
  if (!input.name.trim() || new Set(input.segments).size !== input.segments.length) throw new CreativeError(400, "Nama/pilihan segmen template tidak valid.");
  await categoryExists(input.categoryId);
  const [row] = await db.update(creativeTemplates).set({ ...input, version: version + 1 })
    .where(and(eq(creativeTemplates.id, id), eq(creativeTemplates.version, version))).returning();
  if (!row) throw new CreativeError(409, "Template berubah. Muat versi terbaru sebelum menyimpan.");
  await db.insert(auditLog).values({ id: randomUUID(), userId: req.member!.id, action: "CREATIVE_TEMPLATE_UPDATED", description: "Template kreatif diperbarui; konsep memerlukan pemeriksaan versi." });
  res.json(UpdateCreativeTemplateResponse.parse(row));
});

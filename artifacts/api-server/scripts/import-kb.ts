/**
 * Idempotent import of original supplied KB into private App Storage.
 * Never execute document instructions; do not overwrite validation/permissions.
 * Run explicitly in the target environment; not on every API request.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { db, knowledgeSources, auditLog, pool } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";
import { setObjectAclPolicy } from "../src/lib/objectAcl";
import { logger } from "../src/lib/logger";

const root = path.resolve(process.argv[2] ?? ".local/solid-kb-originals/SOLID_AI_REMIX_KB_v1");
const storage = new ObjectStorageService();
const [bucketName, ...prefix] = storage.getPrivateObjectDir().replace(/^\/+/, "").split("/");

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const children = await Promise.all(entries.map(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  return children.flat();
}

function originId(fileName: string) {
  if (fileName.startsWith("knowledge/source_nodes/")) return "SRC-001";
  if (fileName.includes("Spesifikasi Mini Mikro")) return "SRC-002";
  if (fileName.includes("FAQ_WhatsApp")) return "SRC-003";
  if (fileName.includes("Tabel Spesifikasi Mini")) return "SRC-004";
  if (fileName.includes("DARVIS_NODE")) return "SRC-005";
  if (fileName.includes("TikTok_Strategy")) return "SRC-006";
  if (fileName.includes("blue_print")) return "SRC-007";
  if (fileName.includes("Rancangan Peraturan Bappebti")) return "SRC-008";
  if (fileName.includes("Ringkasan Lengkap")) return "SRC-009";
  if (fileName.includes("Telaah_Regulasi")) return "SRC-010";
  if (fileName.includes("MULTI_CHARACTER")) return "SRC-011";
  return fileName.startsWith("governance/") ? "GOV" : "KB-INITIAL";
}

async function main() {
  const paths = (await walk(root)).filter(p => {
    const relative = path.relative(root, p);
    return relative.startsWith("knowledge/") || relative.startsWith("governance/") || relative.startsWith("source_documents/");
  }).sort();
  let inserted = 0;
  for (const filePath of paths) {
    const fileName = path.relative(root, filePath).split(path.sep).join("/");
    const bytes = await readFile(filePath);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const id = createHash("sha256").update(`${fileName}:${sha256}`).digest("hex").slice(0, 24);
    const existing = await db.query.knowledgeSources.findFirst({ where: (s, { eq }) => eq(s.id, id) });
    if (existing) continue;
    const isMd = fileName.endsWith(".md");
    const content = isMd ? bytes.toString("utf8") : "Dokumen asli disimpan di penyimpanan privat. Isi PDF/Word/slide belum diindeks pada Tahap A; entri ini hanya metadata sumber, bukan bukti bahwa seluruh isi sudah dibaca atau tervalidasi.";
    const title = (isMd ? content.match(/^#\s+(.+)$/m)?.[1] : undefined) ?? path.basename(fileName);
    const segment = /AkunReguler|Akun_Reguler|Regular/i.test(fileName) ? "REGULAR"
      : /Mini|Trade_Table|Product.Facts/i.test(fileName) ? "MINI" : "COMPANY";
    const restricted = /strategy|ai_video|regulatory|governance|MULTI_CHARACTER|DARVIS|blue_print|TikTok_Strategy|Rancangan|Telaah|Ringkasan|KB-Draft|Restrukturisasi/i.test(fileName);
    const category = /governance/.test(fileName) ? "Tata kelola"
      : /Rancangan|Telaah|Ringkasan|regulatory|Legalitas|Legalitas_/i.test(fileName) ? "Legalitas & kepatuhan"
      : /strategy|TikTok|blue_print/i.test(fileName) ? "Strategi & brand"
      : /ai_video|MULTI_CHARACTER/.test(fileName) ? "Teknik video"
      : segment !== "COMPANY" ? "Produk"
      : /Login|OTP|Pendaftaran|Withdrawal|Deposit|Aplikasi|TradePilot|Kontak/.test(fileName) ? "Layanan & aplikasi"
      : /Edukasi|Istilah/.test(fileName) ? "Edukasi trading" : "Perusahaan";
    const isDraft = /Rancangan|Telaah|Ringkasan Lengkap|KB-Draft|regulatory/i.test(fileName);
    const experimental = /MULTI_CHARACTER|ai_video/i.test(fileName);
    const warnings = ["Referensi awal; belum disahkan untuk konten publik. Label PUBLIC lama bukan izin publikasi."];
    if (segment === "MINI") warnings.push("Jangan terapkan data Mini ke Mikro. Sumber A hanya dipilih untuk empat konflik; parameter lain belum otomatis disetujui.");
    if (/Gold|XUL|Brent|BCO|Komisi|Trade_Table|Trading_Rules|PRODUCT_FACTS|Spesifikasi Mini Mikro|FAQ_WhatsApp|Tabel Spesifikasi Mini/i.test(fileName)) {
      warnings.push("Terdapat konflik ukuran kontrak, komisi dan spread. Satuan/ejaan sumber harus divalidasi; jangan memakai angka sebagai klaim publik.");
    }
    if (isDraft) warnings.push("Rancangan atau analisis internal, bukan bukti peraturan yang sedang berlaku.");
    if (experimental) warnings.push("Usulan teknis eksperimental; belum dibuktikan melalui uji produksi.");
    if (!isMd) warnings.push("Pencarian hanya metadata; isi dokumen biner belum diekstrak.");
    const version = (isMd ? content.match(/(?:Versi|Version)\s*[:：]?\s*([0-9][0-9._]*)/i)?.[1] : undefined)
      ?? fileName.match(/[_-](v[0-9][0-9._]*)/i)?.[1] ?? "Tidak tercantum";
    const objectPath = `/objects/knowledge/${sha256}/${path.basename(fileName)}`;
    const file = objectStorageClient.bucket(bucketName!).file(`${prefix.join("/")}/${objectPath.slice("/objects/".length)}`);
    await file.save(bytes, { resumable: false, metadata: { contentType: isMd ? "text/markdown; charset=utf-8" : "application/octet-stream", cacheControl: "private, no-store" } });
    await setObjectAclPolicy(file, { owner: "solid-kb-system", visibility: "private" });
    await db.insert(knowledgeSources).values({
      id, sourceId: `${originId(fileName)}:${id.slice(0, 8)}`, title, segment, category,
      validation: isDraft ? "DRAFT" : experimental ? "EXPERIMENTAL" : "NEEDS_REVIEW",
      access: restricted ? "INTERNAL_RESTRICTED" : "INTERNAL_GENERAL", version,
      fileName, objectPath, content, sha256, warnings,
    }).onConflictDoNothing();
    inserted++;
  }
  if (inserted) await db.insert(auditLog).values({ id: randomUUID(), userId: "SYSTEM", action: "KB_IMPORTED", description: `${inserted} sumber asli diimpor secara privat; tidak ada persetujuan publik otomatis.` });
  logger.info({ inserted, scanned: paths.length }, "Private KB import finished");
}
main().catch(() => {
  logger.error("Private KB import failed; no validation grants were applied");
  process.exitCode = 1;
}).finally(() => pool.end());

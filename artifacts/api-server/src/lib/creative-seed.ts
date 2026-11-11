import { db, creativeCategories, creativeTemplates } from "@workspace/db";

export async function seedCreativeLibrary() {
  const names = ["Promosi produk", "Edukasi trading", "Brand awareness", "Iklan", "Informasi perusahaan", "Konten engagement", "Konten pendukung bisnis"];
  await db.insert(creativeCategories).values(names.map((name, i) => ({
    id: `creative-category-${i + 1}`, name, active: true, version: 1,
  }))).onConflictDoNothing();
  const ideas = [
    ["Presenter memperkenalkan topik", 1], ["Presenter memberikan edukasi", 2],
    ["Presenter menyampaikan pesan brand awareness", 3], ["Presenter memperkenalkan fitur aplikasi", 4],
    ["Presenter mengajak audiens mengenal perusahaan", 5], ["Presenter mengundang pertanyaan", 6],
    ["Presenter menjelaskan informasi", 7],
  ] as const;
  await db.insert(creativeTemplates).values(ideas.map(([name, category], i) => ({
    id: `creative-template-${i + 1}`, name, categoryId: `creative-category-${category}`,
    segments: ["MIKRO", "MINI", "REGULAR", "NONE"], style: "UGC",
    description: "Presenter menyampaikan pengantar netral. Isi faktual hanya boleh berasal dari rujukan yang telah disetujui.",
    scenes: "Pembuka: presenter menyapa. Isi: memperkenalkan topik tanpa angka atau klaim produk. Penutup: mengajak mencari informasi resmi.",
    characterMotion: "Sikap natural, gestur tangan sederhana.",
    cameraMotion: "Kamera stabil, pan atau zoom perlahan sebagai arahan konsep.",
    visual: "Latar bersih, pencahayaan lembut, tidak menampilkan data internal.",
    narration: "Mari mengenal topik ini lebih dekat. Pelajari informasi resmi dan pahami risikonya sebelum mengambil keputusan.",
    cta: "Pelajari informasi resmi terlebih dahulu.", active: true, version: 1,
  }))).onConflictDoNothing();
}

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = path.join(root, "generated-artifacts/phase-b-validation");
const api = JSON.parse(await readFile(path.join(dir, "api-validation.json"), "utf8"));
const browser = JSON.parse(await readFile(path.join(dir, "report.json"), "utf8"));
const cleanup = JSON.parse(await readFile(path.join(dir, "browser-cleanup.json"), "utf8"));
const example = JSON.parse(await readFile(path.join(dir, "saved-prompt-example.json"), "utf8"));
const checks = [
  { name: "Kompilasi TypeScript seluruh workspace", status: "PASS", method: "pnpm run typecheck dijalankan sebelum penyusunan laporan" },
  ...api.checks.map(c => ({ ...c, method: "Handler nyata + PostgreSQL/App Storage" })),
  { name: "Browser: simpan, muat ulang, edit, bahan, konflik versi, review terpisah dan generate terkunci",
    status: Object.values(browser.checks).every(Boolean) ? "PASS" : "FAIL", method: "Satu uji browser desktop, sesi Clerk sintetis" },
  { name: "Pembersihan akun uji browser dan antrean objek privat",
    status: cleanup.remainingTestMembers === 0 && cleanup.accounts.every(a => a.clerkRemoved && !a.pendingPrivateObjects) ? "PASS" : "FAIL",
    method: "Pembersihan setelah izin PUT kedaluwarsa + verifikasi DB/Clerk" },
  { name: "Tampilan pada ponsel nyata dan pemasangan PWA", status: "NOT TESTED", method: "Di luar uji browser desktop ini" },
  { name: "Gangguan penyimpanan, proses mati mendadak dan beban sepuluh anggota nyata", status: "NOT TESTED", method: "Kuota konkurensi sudah diuji; simulasi gangguan operasional belum dilakukan" },
  { name: "Kompatibilitas semua codec MP4/peramban dan media berukuran maksimum", status: "NOT TESTED", method: "MP4 sintetis dengan stream video dan penolakan file palsu telah diuji lokal" },
  { name: "Produksi, provider video, kualitas hasil AI, audio, lip-sync dan publikasi", status: "NOT TESTED", method: "Sengaja tidak dijalankan; di luar Tahap B" },
];
const totals = checks.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});
const escape = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Laporan Creative Engine Tahap B</title>
<style>body{margin:0;background:#faf6ed;color:#28142e;font:16px/1.55 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:38px 24px}h1{font-size:36px;line-height:1.15}h2{margin-top:36px}small,.muted{color:#695d6c}.summary{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0}.summary b{padding:12px 18px;border-radius:14px;background:#eee3cf}.pass{color:#12654c}.fail{color:#a32232}.not-tested{color:#866222}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #dcd0c3}th{background:#eee3cf}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:20px;background:#2a1830;color:#fff3d9;border-radius:14px;font-size:12px}aside{border-left:4px solid #e34b24;padding:12px 18px;background:#f5e8ce}li{margin-bottom:7px}@media(max-width:650px){main{padding:24px 14px}h1{font-size:28px}table{font-size:12px}td,th{padding:8px}}</style>
<main><small>SOLID AI REMIX · 11 November 2026 · tanpa deploy</small><h1>Laporan Creative Engine Tahap B</h1>
<p>DR mengizinkan kelanjutan setelah menyatakan Tahap A ditutup. Penutupan A tidak diulang di sini.</p>
<aside>Creative Engine menyusun konsep dan prompt, bukan menghasilkan video. Tidak ada panggilan LLM atau provider video. Nol sumber publik disetujui tidak diatasi dengan persetujuan otomatis.</aside>
<div class="summary"><b class="pass">${totals.PASS ?? 0} PASS</b><b class="fail">${totals.FAIL ?? 0} FAIL</b><b class="not-tested">${totals["NOT TESTED"] ?? 0} NOT TESTED</b></div>
<p>Pengujian backend mencakup 7 kategori × 8 pilihan/kombinasi segmen × 2 gaya × 2 mode = <strong>224 kombinasi</strong>. Pemeriksaan handler memakai database dan penyimpanan privat nyata, tetapi tidak dianggap sebagai uji autentikasi HTTP. Satu pengujian browser desktop memakai sesi Clerk sintetis untuk alur berisiko.</p>
<h2>Tabel hasil</h2><table><thead><tr><th>Pemeriksaan</th><th>Hasil</th><th>Metode / batasan</th></tr></thead><tbody>${checks.map(c => `<tr><td>${escape(c.name)}</td><td class="${c.status.toLowerCase().replace(" ", "-")}"><b>${escape(c.status)}</b></td><td>${escape(c.method)}${c.detail ? `<br>${escape(c.detail)}` : ""}</td></tr>`).join("")}</tbody></table>
<h2>Hasil nyata di browser</h2><ul><li>Teks asli, termasuk spasi dan baris baru, bertahan saat Ringkasan → Edit, simpan, muat ulang dan membuka riwayat.</li><li>Unggahan gambar masuk prompt tersimpan, menaikkan versi dan menghapus pernyataan izin bahan lama.</li><li>Simpanan dari versi lama ditolak 409 tanpa menghapus isian lokal. Muat versi server harus dipilih secara eksplisit.</li><li>Ready for Review → Approved oleh reviewer lain → Draft setelah pembuat menyunting. Pembuat sendiri ditolak 403; reviewer tidak dapat mengambil Draft pribadi melalui API (404).</li><li>Foto karakter pembuat tidak ditampilkan kepada reviewer. Generate Video nonaktif, dengan blokir server 423/403.</li></ul>
<p class="muted">Catatan saat uji: pembaruan Vite sementara mereset pilihan kategori; pemilihan ulang memulihkan alur. Tab reviewer yang sudah terbuka masih menampilkan versi sebelumnya, bukan isi Draft baru; API telah menolak akses. UI akhir menyediakan muat ulang izin dan pemeriksaan saat fokus kembali, serta tidak menampilkan detail cache jika permintaan gagal. Perbaikan terakhir ini dikonfirmasi lewat pemeriksaan kode/tipe, bukan uji browser kedua.</p>
<h2>Batas dan kebijakan yang diterapkan</h2><ul><li>10 konsep tersimpan per anggota; 3 JPG/PNG/WebP masing-masing 5 MiB dan 1 MP4 20 MiB, total 35 MiB per konsep. Reservasi tertunda dan objek menunggu pembersihan tetap dihitung.</li><li>Template lokal, versi konsep dan snapshot sumber/karakter. Teks pengguna ditandai belum divalidasi. Tidak ada OCR, transkripsi atau pemahaman otomatis isi media.</li><li>ADMIN/SUPER_ADMIN mengelola pustaka. Compliance/SUPER_ADMIN non-pembuat memutus review. VIEWER hanya baca sesuai izin.</li><li>Format 9:16 dan target 12 detik dapat diubah sebagai metadata; bukan jaminan dukungan provider.</li><li>Bahan yang dihapus langsung tidak dapat diakses. Pembersihan byte menunggu berakhirnya signed PUT dan jeda aman; worker berjalan tiap lima menit. Sweep objek final tak tercatat menangani kemungkinan proses berhenti sebelum transaksi selesai.</li><li>Jumlah sumber publik awal tetap nol. Draft netral boleh disimpan; segmen produk tanpa fakta yang sesuai tidak dapat diajukan sebagai konsep lengkap.</li></ul>
<h2>Contoh Prompt Builder yang benar-benar tersimpan</h2><p>Konsep contoh <code>${escape(example.id)}</code>, versi ${example.version}, dibuat ${escape(example.createdAt)}. Prompt dibaca ulang dari PostgreSQL dan cocok dengan hasil simpan; fixture kemudian dihapus. Ini bukan contoh video atau bukti kemampuan provider.</p><pre>${escape(JSON.stringify(example.prompt, null, 2))}</pre>
<h2>Pembersihan dan langkah berikutnya</h2><p>Fixture backend dibersihkan dan sidik data akun/karakter/KB pemilik tidak berubah. Konsep, karakter/foto, lampiran privat, akun aplikasi dan akun Clerk sintetis dari browser telah dibersihkan setelah izin unggah berakhir. Tidak ada sumber asli yang disetujui atau diubah untuk mengatasi data publik kosong.</p>
<p><strong>Berhenti di Tahap B. Tahap C, pengujian provider, pengeluaran baru dan deploy memerlukan persetujuan terpisah.</strong> Penyimpanan/hosting tetap dapat menimbulkan biaya; laporan ini tidak menjanjikan biaya nol.</p></main></html>`;
await writeFile(path.join(dir, "final-report.html"), html);
await writeFile(path.join(dir, "final-report.json"), JSON.stringify({ at: new Date().toISOString(), totals, checks, cleanup }, null, 2));
process.stdout.write(JSON.stringify(totals) + "\n");

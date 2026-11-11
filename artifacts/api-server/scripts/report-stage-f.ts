import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const folder = resolve("../../generated-artifacts/phase-f");
const load = async (path: string) => JSON.parse(await readFile(resolve(folder, path), "utf8"));
const [before, after, video, ops, members, studio, scheduler, browser] = await Promise.all([
  load("idle-before.json"), load("idle-after.json"), load("video/backend-validation.json"),
  load("operations/backend-validation.json"), load("member-tests.json"), load("studio-tests.json"),
  load("scheduler-tests.json"), load("browser-uat.json"),
]);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const results = [
  ...video.results.map((r: any) => ({ module: "Video/queue", test: r.feature, status: r.status === "SIMULATED" ? "NOT TESTED" : r.status, evidence: r.actual })),
  ...ops.results.map((r: any) => ({ module: "Review/operations", ...r })),
  ...members.checks.map((r: any) => ({ module: "Members/roles", ...r, evidence: r.method })),
  ...studio.checks.map((r: any) => ({ module: "KB/creative", ...r, evidence: r.method })),
];
const passed = results.filter(r => r.status === "PASS").length;
const rows = (items: { test: string; status: string; evidence?: unknown }[]) => items.map(r =>
  `<tr><td>${esc(r.test)}</td><td><b>${esc(r.status)}</b></td><td>${typeof r.evidence === "object" ? `<details><summary>Bukti terstruktur</summary><pre>${esc(JSON.stringify(r.evidence, null, 2))}</pre></details>` : esc(r.evidence)}</td></tr>`).join("");
const list = (items: string[]) => `<ul>${items.map(v => `<li>${v}</li>`).join("")}</ul>`;
const html = `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SOLID AI REMIX — Laporan Tahap F</title><style>
body{margin:0;background:#f2f3ef;color:#25322e;font:16px/1.6 system-ui,sans-serif}main{max-width:1080px;background:white;margin:24px auto;padding:32px;border-radius:16px}h1{line-height:1.2}h2{margin-top:36px;color:#315648}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px;border:1px solid #d9dfda;text-align:left;vertical-align:top}th{background:#edf2ee}pre,code{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}aside{background:#fff1d5;border-left:4px solid #bd7b16;padding:18px}.ok{background:#e8f4e9;padding:16px}small{color:#5b6961}@media(max-width:650px){main{padding:16px;margin:8px}table{font-size:11px}td,th{padding:5px}}</style><main>
<small>11 November 2026 · Tahap F · Workspace/development, kecuali pemeriksaan HTTP produksi yang disebut eksplisit</small>
<h1>SOLID AI REMIX — Laporan Tahap F</h1>
<aside><strong>Kesimpulan akhir: NOT READY untuk persetujuan akhir publish/republish Autoscale.</strong><br>
Optimasi dan banyak pemeriksaan sudah berhasil. Namun keselamatan penyelesaian render saat instance Autoscale berhenti belum terbukti; beberapa UAT browser tetap NOT TESTED. Tahap F tidak dinyatakan lulus lengkap dan tidak ada rekomendasi publish saat ini.</aside>
<p class="ok"><strong>${passed} pemeriksaan backend/domain PASS</strong>, 5 pemeriksaan scheduler PASS, 8 assertion unit polling PASS. Browser membuktikan satu MP4 nyata selesai saat halaman ditutup, dapat diputar dan diunduh. Ini bukan ${passed} perjalanan end-to-end atau sertifikasi produksi.</p>
<h2>1. Daftar perubahan kode</h2>
<table><tr><th>File aplikasi</th><th>Perubahan dan alasan</th></tr>
<tr><td><code>artifacts/api-server/src/lib/demand-runner.ts</code> (baru)</td><td>Pemicu kerja, penggabungan sinyal beruntun, drain antrean, fallback idle dan backoff kegagalan; menghindari timer 4 detik permanen.</td></tr>
<tr><td><code>artifacts/api-server/src/lib/video/signals.ts</code> (baru)</td><td>Memisahkan sinyal dari service/worker agar tidak membuat circular import; DB tetap sumber kebenaran.</td></tr>
<tr><td><code>artifacts/api-server/src/lib/video/service.ts</code></td><td>Sinyal hanya setelah transaksi create job commit; unpause sah juga membangunkan antrean. Transaksi, kuota dan idempotensi dipertahankan.</td></tr>
<tr><td><code>artifacts/api-server/src/lib/video/worker.ts</code></td><td>Pemrosesan setelah sinyal/startup, lanjut ke job berikutnya, fallback adaptif; maintenance maksimal sekali per jam pada proses ini. Advisory lock dan rekonsiliasi tetap ada.</td></tr>
<tr><td><code>artifacts/api-server/src/lib/creative-storage.ts</code></td><td>Cleanup startup lalu fallback adaptif 1/2/4/6 jam, bukan setiap 5 menit. Cleanup on-demand pada permintaan upload yang sudah ada tetap dipertahankan.</td></tr>
<tr><td><code>artifacts/solid-ai-remix/src/lib/activity-polling.ts</code> (baru)</td><td>Polling hanya saat halaman terlihat dan ada aktivitas manusia; job aktif tetap dipantau. Query stale diperbarui saat kembali.</td></tr>
<tr><td><code>artifacts/solid-ai-remix/src/App.tsx</code></td><td>Memasang wake-on-activity; refetch tidak membatalkan lalu mengulang request yang sudah berjalan. Cache tetap dibersihkan saat identitas berubah.</td></tr>
<tr><td><code>artifacts/solid-ai-remix/src/components/ops-kit.tsx</code><br><code>artifacts/solid-ai-remix/src/pages/videos.tsx</code><br><code>artifacts/solid-ai-remix/src/pages/creative.tsx</code></td><td>Mengganti interval idle tetap dengan kebijakan aktivitas. Keputusan review/status konsep dapat disegarkan saat tidak ada edit lokal; jika versi berubah ketika ada input belum disimpan, tampilkan konflik dan pertahankan input/versi dasar.</td></tr></table>
<p>Tidak mengubah <code>index.ts</code> atau <code>routes/video.ts</code> karena startup dan kontrak route yang ada dapat dipertahankan; pemicu setelah commit ditempatkan di service. Tidak ada perubahan schema/OpenAPI, kuota, role, batas anggota, review, layanan cloud atau paket hosting.</p>
<p>Script uji ditambah untuk pengukuran idle, scheduler, anggota/role, studio/KB dan worker anak. Script video/operasional diberi folder output F dan tes SIGKILL nyata. Fixture UI disesuaikan dengan kebijakan non-faktual yang sudah berlaku. Perbaikan launcher dan asumsi template/segmen pada harness uji bukan perubahan aturan aplikasi.</p>
<h2>2. Alasan setiap perubahan</h2>
<p>Mengurangi aktivitas tanpa kebutuhan sambil mempertahankan antrean persisten dan kontrol bisnis. Menghentikan semua worker tanpa pengganti akan menghilangkan drain/recovery/cleanup, sehingga tidak dilakukan. Pemicu dikirim setelah commit agar worker tidak mencari job yang belum tersimpan. Form tidak boleh ditimpa oleh pembaruan keputusan dari sesi lain.</p>
<h2>3. Hasil optimasi worker</h2>
${list(["Sinyal create job setelah commit membangunkan worker; browser tidak menjadi satu-satunya pemicu.",
"Worker yang berhasil memproses job langsung memeriksa pekerjaan berikutnya, tanpa menunggu timer 4 detik.",
"Fallback antrean kosong: 15, 30, lalu maksimum 60 menit. Masih ada query fallback; tidak diklaim nol selamanya.",
"Kegagalan/lock contention memakai backoff, bukan retry permanen setiap menit. Sinyal baru mengembalikan respons cepat.",
"Cleanup lampiran tetap startup/on-demand saat upload dan fallback hingga 6 jam. Cleanup bisa lebih lambat saat tidak ada aktivitas, tetapi ticket kedaluwarsa tetap tidak dapat digunakan.",
"Retention/deleted-result recovery tetap dijalankan secara berkala; interval tidak mengaktifkan kebijakan penghapusan baru.",
"Advisory lock, idempotensi, batas 3 pekerjaan/hari dan UNKNOWN tanpa retry otomatis tetap dipertahankan."])}
<h2>4. Hasil optimasi polling frontend</h2>
<table><tr><th>Situasi</th><th>Sebelum</th><th>Sesudah</th></tr>
<tr><td>Job aktif, halaman terlihat</td><td>Jobs/config 4 detik</td><td>Jobs 4 detik; config mengikuti aktivitas, tidak lagi disalin setiap 4 detik.</td></tr>
<tr><td>Tidak ada job aktif, pengguna masih berinteraksi</td><td>Beberapa query 20 detik</td><td>30 detik; berhenti setelah 60 detik tanpa interaksi manusia.</td></tr>
<tr><td>Halaman tidak terlihat</td><td>Mengikuti default library</td><td>Interval secara eksplisit false, termasuk saat job aktif. Worker tetap bekerja di server.</td></tr>
<tr><td>Kembali/fokus</td><td>Refetch sesuai query</td><td>Refresh query aktif yang stale, tanpa cancel/restart request yang sedang berjalan.</td></tr></table>
<p>Delapan assertion unit memeriksa aktivitas, idle, hidden, active job, kembali, dedup wake dan pelepasan listener. <strong>Jumlah request browser idle sebelum/sesudah belum diukur: NOT TESTED.</strong> Perlindungan form/keputusan baru telah diubah dan lolos typecheck; UAT browser edit belum disimpan tetap NOT TESTED.</p>
<h2>5. Perbandingan aktivitas database</h2>
<table><tr><th>Pengukuran proses probe</th><th>Sebelum</th><th>Sesudah</th></tr>
<tr><td>Warm-up 2 detik, query aktual</td><td>${before.startupQueries}</td><td>${after.startupQueries}</td></tr>
<tr><td>Idle 14 detik setelah warm-up, query aktual</td><td>${before.idleQueries}</td><td>${after.idleQueries}</td></tr></table>
<p>Penghitung dipasang pada koneksi proses probe, bukan seluruh database. Dua probe menjalankan startup worker dan cleanup tanpa pekerjaan baru. Query fallback 15 menit–6 jam tidak tercakup jendela ini. Tidak ada claim pengurangan tagihan, pengukuran 24 jam, atau proyeksi penghematan persen biaya.</p>
<h2>6. UAT setiap modul — hasil baru</h2>
${["Video/queue", "Review/operations", "Members/roles", "KB/creative"].map(module => `<h3>${esc(module)}</h3><table><tr><th>Pemeriksaan</th><th>Status</th><th>Bukti/metode</th></tr>${rows(results.filter(r => r.module === module))}</table>`).join("")}
<h3>Unit scheduler</h3>${list(scheduler.checks.map((c: string) => `${esc(c)} — <strong>PASS</strong>`))}
<h3>Browser, satu perjalanan terarah</h3><p>Dua baris setup di bawah merupakan fixture/simulasi persetujuan awal, bukan keberhasilan UI review independen.</p>
<table><tr><th>Pemeriksaan</th><th>Status</th><th>Bukti</th></tr>${rows(browser.checks.map((r: any) => ({ test: r.check, status: r.status, evidence: r.evidence })))}</table>
<h2>7. Bukti Mode Hemat</h2>
<p>Browser menghasilkan satu job lokal baru, lalu halaman ditutup 15 detik. Saat dibuka kembali job yang sama selesai dan kuota tetap 1/3. Native player mempunyai metadata, durasi 10 detik dan currentTime bergerak. Download diperiksa sebagai MP4/H.264 720×1280 (9:16), AAC 44,1 kHz stereo, 10,000 detik. File contoh disediakan terpisah.</p>
<p>Ini karakter/logo geometris sintetis, bukan AI Motion, bukan foto anggota asli dan bukan video perusahaan yang sudah disetujui. Track AAC bukan bukti narasi benar atau suara manusia; audio tidak didengarkan dalam uji browser. Hasil backend juga memeriksa MP4/tone/overlay dan render failure. Uji 15 detik baru pada F tidak dilakukan; bukti 15 detik dari E hanya historis.</p>
<h2>8. Restart dan recovery</h2>
<p><strong>PASS:</strong> worker anak nyata mulai PROCESSING, dihentikan dengan SIGKILL beserta process group-nya, lalu worker baru membuka DB yang sama. Job tetap tersimpan dan menjadi UNKNOWN dengan satu percobaan, tanpa render ulang. Rekonsiliasi state sintetis juga diuji terpisah.</p>
<p>Ini bukan penghentian instance Replit Autoscale, bukan uji rolling deployment API produksi, dan bukan jaminan video selesai saat mesin dimatikan. Restart API produksi/full-server dan scale-down aktual: <strong>BLOCKED</strong> oleh batasan tidak publish/mengubah hosting dan kebutuhan desain lifecycle yang belum disepakati.</p>
<h2>9. Privasi dan keamanan</h2>
<p>Backend menolak creator lain mengakses draft/job, menerapkan role lima jenis, membatasi karakter per user, memisahkan file dari status approval dan menolak self-approval. Uji KB membuktikan sumber restricted tidak muncul untuk creator dan dapat dilihat reviewer berwenang. Ini memakai handler/domain nyata dengan fixture, bukan semua sesi browser role.</p>
<p>Pemeriksaan read-only versi live menghasilkan healthz 200, serta /api/me, /api/character, /api/video/jobs tanpa login 401. Uji akses silang file lewat dua sesi browser baru, logout seluruh role dan produksi berizin belum lengkap: <strong>NOT TESTED</strong>. Fixture aplikasi/objek privat dibersihkan menurut ID tepat. Tidak menghapus akun asli atau profil Clerk yang tidak terbukti milik fixture.</p>
<h2>10. Kesiapan Autoscale dan deployment yang terdeteksi</h2>
<aside>Metadata read-only sekarang menunjukkan deployment Autoscale publik aktif dengan build sukses di <a href="https://solid-ai-remix.replit.app">solid-ai-remix.replit.app</a>. Ini berubah dari audit terdahulu. Agent tidak melakukan publish/republish pada F; perbaikan workspace tidak dianggap otomatis sudah berada di versi live.</aside>
<p>Desain tetap worker in-process. Menutup halaman browser tidak sama dengan menghentikan instance server. Queue/recovery membantu mencegah job hilang atau biaya retry ganda, tetapi tidak menjamin penyelesaian video bila proses dihentikan. Karena itu <strong>Autoscale belum dinyatakan layak untuk render yang harus selesai</strong>.</p>
<p>Pilihan yang perlu disepakati: lifecycle request/job yang didukung platform, atau worker pada hosting yang selalu hidup. Opsi kedua memerlukan persetujuan biaya; tidak diaktifkan. Tidak ada perubahan arsitektur utama, GPU atau layanan baru dalam F.</p>
<h2>11. Estimasi biaya berdasarkan pengukuran</h2>
<p>Pengukuran query 27→0 dalam 14 detik tidak bisa dikonversi langsung menjadi USD. Biaya database berdasarkan jam aktif, aplikasi berdasarkan komputasi/request, serta ada storage/transfer/operasi. <strong>Biaya aktual produksi per video dan total setelah F: belum tersedia.</strong></p>
<p>Tarif resmi yang sebelumnya diverifikasi: Autoscale US$1/bulan + US$0,60/juta compute units + US$0,40/juta request; database US$0,16/jam aktif; VM 0,5 CPU/2 GiB US$0,0208/jam (sekitar US$14,98/30 hari untuk server saja). Storage/transfer/pajak dan kredit paket dihitung terpisah. Tidak ada jaminan angka bulanan, kapasitas VM, atau biaya nol.</p>
<p>Rumus rencana: app base + compute units terukur × tarif + request terukur × tarif + jam database aktif × tarif + storage/transfer/operasi. Fallback tetap dapat membangunkan DB pada proses yang selalu hidup; jangan hanya menghitung waktu render. <a href="https://docs.replit.com/billing/aug-cloud-billing-updates">Sumber tarif</a> · <a href="https://docs.replit.com/billing/about-usage-based-billing#compute-time">Definisi database aktif</a>.</p>
<h2>12. Risiko dan pekerjaan F yang belum selesai</h2>
${list(["BLOCKED: bukti scale-down/stop instance Autoscale dan keputusan lifecycle produksi. Tidak terselesaikan hanya dengan backoff.",
"NOT TESTED: hitungan request browser idle/fokus nyata, perubahan versi saat form memiliki input belum disimpan, logout dan matriks sesi browser seluruh role.",
"NOT TESTED: dua hasil render nyata dari dua job berjalan bersamaan lintas instance; tes request konkurensi/kuota dan advisory recovery sudah dilakukan, bukan uji beban.",
"NOT TESTED: uji 15 detik baru F, penilaian isi audio/narasi, perangkat fisik/PWA, serta operasi file berizin di produksi.",
"Backoff/fallback jangka panjang belum diobservasi selama beberapa jam; perubahan interval diverifikasi lewat unit test dengan interval pendek dan probe singkat.",
"Peringatan dependency Google auth/stream listener muncul selama beberapa tes; tidak menggagalkan hasil, tetapi bukan bukti kapasitas atau uji ketahanan berjam-jam."])}
<p><strong>Batas yang dipertahankan:</strong> maksimal 10 anggota aktif, satu karakter per anggota, maksimal 3 pekerjaan/hari termasuk gagal/dibatalkan, review independen, approval akhir dan file privat. Tidak mengaktifkan provider AI/TTS, GPU, pembelian kredit, VM, publikasi otomatis atau schema/migrasi.</p>
<p><strong>Belum menutup Tahap F sebagai complete UAT.</strong> Laporan ini membedakan perbaikan yang sudah bekerja dari validasi yang masih tertunda. Tidak merekomendasikan publish ulang sebelum hambatan penting diselesaikan.</p>
</main></html>`;
await mkdir(folder, { recursive: true });
await writeFile(resolve(folder, "laporan-tahap-f.html"), html);
await writeFile(resolve(folder, "ringkasan-f.json"), JSON.stringify({
  conclusion: "NOT READY", backendDomainPass: passed, schedulerChecksPass: 5, frontendUnitAssertionsPass: 8,
  idleMeasurement: { observationMs: 14000, before: before.idleQueries, after: after.idleQueries },
  realBrowserVideo: "PASS: 10s H264 720x1280 AAC; page closed during render; playback and download",
  autoscaleInstanceStop: "BLOCKED", browserIdleRequests: "NOT TESTED", productionRepublishedByAgent: false,
  productionMetadataObserved: { deployed: true, type: "autoscale", url: "https://solid-ai-remix.replit.app" },
  fixturesCleaned: true,
}, null, 2));
console.info(JSON.stringify({ report: "generated-artifacts/phase-f/laporan-tahap-f.html", backendDomainPass: passed }));

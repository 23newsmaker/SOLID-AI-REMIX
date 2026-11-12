# Hasil verifikasi PWA — 12 November 2026

**Status tugas pemasangan Android/iPhone: BELUM SELESAI.** Temuan browser di
bawah adalah bukti parsial, bukan pengganti pengujian pemasangan pada kedua OS.

**Kesimpulan:** pemeriksaan browser produksi lulus pada lingkungan yang diuji.
**Pemasangan nyata di Android/iPhone belum diverifikasi**; ini bukan persetujuan
publish atau klaim aplikasi telah terpasang di perangkat fisik.

Lingkungan: build produksi, base `/`, server uji loopback
`http://127.0.0.1:4179`, Chromium 157 desktop dengan viewport 390×844 dan 375×812.
Tidak memakai password, akun, foto, video atau anggota DR. Tidak ada penulisan
database, aktivasi provider berbayar, maupun perubahan kode aplikasi.

| Pemeriksaan | Hasil | Bukti/batasan |
| --- | --- | --- |
| Build produksi dan pembukaan studio | PASS | Form password tampil, JS produksi termuat |
| Manifest, start_url, standalone, PNG/maskable/Apple | PASS | Endpoint 200; ukuran PNG juga diperiksa skrip |
| Aktivasi dan kontrol service worker | PASS | `/sw.js` aktif pada scope root setelah reload |
| Tutup dan buka kembali halaman online | PASS | Halaman masuk anonim tampil kembali |
| Cache Storage hanya berisi aset publik | PASS | Tepat delapan aset allowlist; tidak ada API/HTML privat/media/query URL |
| Fixture privat dan URL bertanda tangan | SIMULATED, PASS untuk cache | Marker sintetis; bukan media valid atau otorisasi file nyata |
| Cache aplikasi lain tidak dihapus | PASS | Cache sintetis lain bertahan saat aktivasi |
| Emulasi offline hanya pada target halaman | FAIL sebagai uji offline end-to-end | Worker masih mendapat shell SPA; JS/CSS halaman gagal sehingga kosong |
| Origin uji benar-benar tidak dapat dihubungi | PASS | Server sementara dihentikan; controller/cache sama mengembalikan pemberitahuan offline |
| Koneksi pulih, tekan Coba lagi | PASS | Server dihidupkan dan semua override dipulihkan; form password kembali |
| Android/iPhone fisik, pemasangan, peluncuran standalone | NOT TESTED | Tidak dibuktikan oleh viewport atau manifest |
| Safari/WebKit | NOT TESTED | Hanya Chromium yang dijalankan |
| Sesi studio terautentikasi setelah buka ulang | NOT TESTED | Tidak menggunakan password pemilik |
| Kamera dan izin picker perangkat fisik | NOT TESTED | `capture=user` diperiksa dari sumber, bukan bukti kamera nyata |
| Mikrofon | NOT APPLICABLE pada build yang diuji | Belum ada perekam pada sumber karakter yang diperiksa |

## Interpretasi offline

Layar kosong awal tidak diatasi dengan menyimpan HTML privat atau media. Uji
lanjutan mempertahankan controller dan cache yang sama, lalu menghentikan hanya
server loopback. Worker mengembalikan HTTP 200 dengan pemberitahuan **Koneksi
sedang terputus** dari cache publik. Pemulihan lewat **Coba lagi** berhasil setelah
server dan kondisi jaringan dipulihkan. Ini membedakan keterbatasan emulasi
target halaman dari kegagalan koneksi yang benar-benar dialami fetch worker.

## Cache Storage akhir

Satu cache `sar-static-v2`: `/icon.svg`, `/logo.svg`,
`/manifest.webmanifest`, `/offline.html`, `/icons/icon-192.png`,
`/icons/icon-512.png`, `/icons/icon-maskable-512.png`,
`/icons/apple-touch-icon.png`. Ini bukan audit HTTP cache atau seluruh
penyimpanan browser/server.

Konteks browser uji ditutup. Server uji sementara dihentikan. Workflow aplikasi
tetap berjalan; tidak ada data DR yang diubah.

## Mengulang dan melanjutkan

Lihat [panduan pengujian](README.md) dan jalankan
`node experiments/pwa/check-pwa.mjs`. Bukti mentah pemeriksaan browser disimpan
di `generated-artifacts/pwa-acceptance/results.md` (direktori hasil diabaikan Git).
Checklist HP fisik pada panduan masih harus diperlakukan **NOT TESTED** sampai
ada bukti perangkat dan browser yang sebenarnya.

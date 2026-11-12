# Verifikasi PWA SOLID AI REMIX

## Mengulang pemeriksaan

1. Jalankan `node experiments/pwa/check-pwa.mjs`.
2. Buat build produksi menggunakan konfigurasi build artifact yang berlaku.
   Untuk pemeriksaan lokal dengan base root:
   `PORT=3000 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/solid-ai-remix run build`.
3. Jalankan `node experiments/pwa/serve-production.mjs 4179`.
4. Buka `http://127.0.0.1:4179/studio` menggunakan browser pengujian.
   Loopback dianggap secure context oleh browser yang mendukungnya. Ini **bukan**
   URL yang dapat dipasang dari HP lain dan bukan bukti publikasi atau TLS produksi.
5. Sesudah selesai, tutup konteks browser pengujian dan hentikan server sementara.

Server pengujian hanya mendengarkan loopback. Proxy API hanya menerima GET/HEAD
anonim tanpa meneruskan cookie. POST/PUT/DELETE ditolak. Jangan memasukkan password
DR atau mengganti server ini menjadi layanan produksi.

## Arti hasil

- **PASS:** benar-benar diamati atau diperiksa; sebutkan lingkungan uji.
- **FAIL:** hasil tidak sesuai harapan.
- **NOT TESTED:** tidak tersedia perangkat, browser, izin atau sesi yang diperlukan.
- **SIMULATED:** permintaan atau kemampuan perangkat diganti fixture/emulasi.
- **NOT APPLICABLE:** fitur memang belum ada pada versi yang diperiksa.

Emulasi viewport iPhone bukan Safari iPhone. WebKit desktop bukan iOS terpasang.
Manifest valid, service worker aktif, atau CDP installability tanpa error
**tidak** membuktikan pemasangan aplikasi lewat sistem operasi.

## Data uji dan privasi

Gunakan konteks browser baru. Tidak perlu membuat anggota atau memakai file DR.
Fixture server sementara:

- `/api/pwa-test-private`
- `/__pwa_test/private/photo.png`
- `/__pwa_test/private/video.mp4`
- `/__pwa_test/private/page.html`
- `/__pwa_test/private/photo.png?signature=synthetic`

Ini **marker sintetis**, bukan foto orang, MP4 nyata atau tanda tangan akses asli.
Pemeriksaan fixture membuktikan perilaku cache, bukan keberhasilan decode video,
unggah kamera, otorisasi file maupun render produksi.

Service worker boleh menyimpan tepat delapan aset publik: `icon.svg`, `logo.svg`,
`manifest.webmanifest`, `offline.html` dan empat ikon PNG di `icons/`.
Jangan menyimpan HTML studio, respons API, foto/video, URL berparameter,
cookie maupun hasil render di Cache Storage. Pemeriksaan Cache Storage tidak
otomatis membuktikan kebijakan HTTP cache, penyimpanan lokal lain atau
penghapusan data di server.

Periksa urutan online → tutup/buka halaman → offline/reload → online/reload.
Offline harus hanya menampilkan pemberitahuan koneksi, bukan data privat lama.
File dan pekerjaan video tetap memerlukan internet. Hapus hanya cache, service
worker dan konteks milik origin uji; jangan membersihkan sesi/browser DR.

**Penting untuk emulator:** pada pemeriksaan Chromium 157, emulasi offline pada
target halaman tetap membiarkan navigasi service worker mendapat shell SPA,
sedangkan permintaan JS/CSS halaman gagal. Hasilnya layar kosong, bukan bukti
fallback cache hilang. Dengan konteks, controller dan cache yang sama, menghentikan
server loopback benar-benar membuat fetch worker gagal dan pemberitahuan offline
muncul dengan benar. Untuk membedakannya, hentikan **hanya server uji sementara**,
muat ulang, hidupkan server itu lagi, pulihkan kondisi online pada semua sesi CDP,
lalu tekan Coba lagi. Jangan mematikan layanan aplikasi atau produksi untuk tes ini.

## Checklist pemasangan fisik — belum boleh dianggap lulus dari emulasi

Gunakan **URL HTTPS build produksi yang telah disetujui DR**, dibuka langsung di
browser, bukan iframe editor atau server Vite development. Catat model perangkat,
versi OS, browser, tanggal, URL yang dipakai dan bukti layar tanpa data rahasia.

### Android / Chrome

1. Buka studio. Cari opsi pemasangan melalui menu browser; kemunculan banner
   otomatis bergantung pada browser dan tidak dijamin.
2. Pasang, lalu buka dari ikon layar utama. Periksa ikon, nama dan jendela standalone.
3. Dengan sesi uji sendiri, tutup aplikasi dan buka ulang; periksa perilaku sesi.
4. Coba Ambil foto, izinkan kamera bila diminta, ambil foto fixture, lalu batalkan.
   Periksa juga penolakan izin dan Pilih galeri. Jangan mengunggah wajah DR.
5. Putuskan jaringan dan buka ulang; periksa pemberitahuan offline. Sambungkan
   lagi dan muat ulang; studio harus dapat dibuka kembali.

### iPhone / Safari

1. Buka langsung di Safari. Gunakan **Bagikan → Tambah ke Layar Utama** bila
   tersedia pada versi iOS tersebut; tidak ada janji prompt otomatis Safari.
2. Buka dari ikon layar utama; ulangi pemeriksaan ikon, standalone, sesi,
   kamera/galeri, pembatalan, izin ditolak dan offline → online.
3. Periksa status bar, notch, keyboard dan gulir pada orientasi yang digunakan.

### Mikrofon

Jangan mengklaim izin mikrofon sudah diuji bila perekam karakter belum tersedia.
Setelah fitur suara tersedia, periksa izin izinkan/tolak, penghentian rekaman,
pembukaan ulang PWA, dan penutupan track mikrofon pada konteks uji sendiri.

Jangan mengganti HTML `capture="user"` dengan klaim bahwa kamera depan selalu
dipilih: perilaku picker dan kamera mengikuti dukungan browser/OS.

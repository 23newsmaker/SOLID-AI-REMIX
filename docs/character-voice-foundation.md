# Fondasi suara karakter

## Batas fase

Satu karakter memiliki satu profil suara, dengan satu sampel aktif opsional. Penyimpanan sampel **bukan** voice cloning dan belum bisa membacakan naskah baru. Tidak ada pendaftaran suara, pengiriman sampel ke provider, TTS, pembelian kredit, atau aktivasi berbayar.

UI tersedia di studio bersama dan halaman karakter pribadi. Karakter lama tanpa suara, foto, bahan narasi manual, hasil video dan kuota tetap mengikuti alur sebelumnya.

## Kontrak sampel

- Rekam hanya setelah tombol ditekan, atau unggah WebM/Opus, OGG, M4A/MP4 audio-only, MP3, WAV atau AAC.
- Batas sementara 5–60 detik dan 10 MiB. Perekam berhenti sekitar detik 59 untuk memberi ruang penyelesaian encoder. Batas ini **bukan** syarat kecukupan untuk provider mana pun.
- Server memeriksa ukuran aktual/reservasi, MIME dengan container, satu stream audio tanpa video, decode penuh dengan batas durasi/output/waktu, dan menolak audio hening/sangat pelan. Pemeriksaan ini tidak mengenali ucapan, banyak pembicara dalam satu stream, identitas, kualitas cloning, atau keabsahan izin secara otomatis.
- Audio dinormalisasi lokal menjadi PCM WAV mono 16 kHz tanpa metadata sumber. Ini baseline penyimpanan ekonomis, bukan master rekaman studio. Setelah provider dipilih, kualitas/rate/durasi harus dievaluasi ulang; bisa perlu rekaman baru yang lebih panjang/berkualitas tinggi.
- Izin suara dikonfirmasi tersendiri dan diaudit sebagai deklarasi pengunggah; sesi studio bersama tidak memverifikasi identitas pembicara. Izin foto/bahan internal tidak digunakan sebagai izin suara. **Tidak ada izin transfer/cloning eksternal yang disimpulkan dari checkbox penyimpanan.**

## Akses, versi, dan penghapusan

- Seluruh API mengikuti middleware anggota aktif atau sesi studio + folder yang sudah dibagikan. Folder bukan identitas pribadi. Anggota VIEWER tidak dapat mengubah suara.
- Upload langsung memakai tiket privat 15 menit, terikat owner, karakter dan expectedVersion. Maksimal tiga tiket aktif tertunda dan 12 permintaan/jam/folder.
- File final memakai key lain dari key PUT, dialokasikan dalam tiket yang sudah committed sebelum byte final ditulis. URL PUT lama tidak bisa mengubah sampel final.
- Player memakai endpoint terautentikasi, bukan URL objek publik permanen. URL studio memiliki scope folder, `private, no-store`, `nosniff`, dan kebijakan same-origin.
- Penggantian/hapus membutuhkan versi yang masih berlaku. Konflik sesi memberi 409 dan status terbaru dimuat; tidak menimpa diam-diam. Mengulang finalisasi tiket aktif yang sama idempotent.
- Ganti foto mempertahankan ID karakter dan profil suaranya. Hapus sampel tidak menghapus foto, bahan konsep, video, riwayat atau kuota. Menghapus seluruh karakter menutup profil aktif dan mengantrekan file suaranya untuk dibersihkan.
- Akses sampel dihapus di transaksi terlebih dahulu. Row sampel retired menjadi antrean pembersihan persisten; kegagalan storage tidak menghidupkan kembali akses. Runner memulai retry saat server hidup/mutasi dan memakai backoff; pemeriksaan idle 15–60 menit. Ini bukan jaminan penghapusan ketika instance tidak berjalan.
- File retired dibersihkan tanpa menunggu expiry tiket; staging tombstone ditahan sampai signed PUT kedaluwarsa + 60 detik agar PUT terlambat tidak meninggalkan file baru. Metadata staging aktif dikeluarkan dari antrean setelah bersih. Audit dan snapshot job tidak menyimpan byte/URL storage.

## Batas integrasi

Profil menyediakan identitas provider, ID profil provider, versi suara provider dan status terpisah, namun seluruh mutasi sampel selalu mempertahankan `DISABLED` dan membersihkan metadata provider lama. Tidak ada endpoint yang dapat mengaktifkannya.

Job baru menyimpan snapshot metadata `voiceBinding` yang terikat karakter, sampel/versi dan provider (sekarang null), dengan `synthesisEnabled: false`. Job lama boleh null. Kunci permintaan unik dan hash job yang sudah ada tetap menjadi perlindungan permintaan ganda. Tidak ada klaim pencegahan tagihan ganda provider sebelum adapter provider benar-benar dibuat dan diuji.

Worker/renderer tidak membaca sampel identitas. Hanya audio bahan konsep per-video yang menjadi narasi manual. Tanpa audio manual, perilaku video lama tetap berlaku; tidak ada suara pengganti atau replay sampel sebagai kalimat baru.

Implementasi provider lanjutan perlu: persetujuan pemilik dan pemilik suara terikat provider/tujuan/retensi, pembatasan biaya, adapter pendaftaran dan sintesis, penyimpanan hasil narasi terpisah, versi provider immutable per job, idempotency ledger/outbox untuk tiap operasi eksternal, status UNKNOWN saat timeout (rekonsiliasi, bukan retry buta), dan penghapusan provider dengan retry serta bukti hasil. Kolom persiapan saat ini tidak berarti kemampuan tersebut sudah aktif.

## Verifikasi yang dapat dijalankan ulang

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server exec tsx scripts/validate-character-voice.ts
```

Tes memakai audio sintetis dan ID fixture tercatat, bukan rekaman pemilik. Laporan lokal di `generated-artifacts/voice/validation.json`. Setup/cleanup fixture browser terpisah:

```sh
pnpm --filter @workspace/api-server exec tsx scripts/voice-browser-fixture.ts
# Jalankan satu pass browser pada dua folder di manifest, lalu tutup konteks browser.
pnpm --filter @workspace/api-server exec tsx scripts/voice-browser-fixture.ts --cleanup
```

Manifest tidak menyimpan password atau token sesi. Tes mikrofon sintetis tidak membuktikan mikrofon fisik Android/iPhone, Safari fisik, kualitas cloning, atau penghapusan data oleh provider eksternal.

### Hasil verifikasi fondasi, 12 November 2026

- Typecheck workspace lulus; pemeriksaan frontend setelah perubahan terakhir juga lulus.
- Sepuluh kelompok tes server lulus, termasuk keenam format audio, batas 5/60 detik, isi palsu, file rusak/hening/video, ACL privat, akses lintas folder, VIEWER/SUSPENDED, versi/idempotency, ganti foto, penggantian/hapus dan retry setelah storage gagal. Semua fixture tes server dibersihkan.
- Satu pass browser mobile 390×844 pada akun sintetis melalui `/character` lulus: oscillator + MediaRecorder asli, pratinjau, stop/re-record, consent, simpan, reload, ganti WAV, peran VIEWER, hapus batal/setuju, izin ditolak, browser tanpa MediaRecorder dan penghentian track saat navigasi. File player terautentikasi mengembalikan 200/private-no-store. Player memakai `preload="none"`, sehingga durasi native dapat tetap 0:00 sebelum diputar; durasi sampel terverifikasi ditampilkan terpisah.
- Akses studio browser awal berhenti pada gerbang password, sehingga perpindahan folder studio tidak diuji di browser. Isolasi folder diuji lewat HTTP nyata; penghentian mikrofon diuji melalui unmount saat pindah halaman, memakai komponen yang sama.
- Konteks browser ditutup, file/row fixture dibersihkan, dan akun Clerk hanya dihapus setelah profil provider benar-benar cocok dengan identitas sintetis.
- Mikrofon fisik HP, Safari fisik, suara cloning nyata, dan biaya/retensi provider nyata **belum diuji**. Tidak ada sampel eksternal, TTS atau layanan berbayar diaktifkan.

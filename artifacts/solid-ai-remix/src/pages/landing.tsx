import { Link } from 'wouter';
import { ArrowRight, UserRound, BookOpenText, Lock } from 'lucide-react';
import { useGetAppInfo } from '@workspace/api-client-react';
import { Wordmark, Pill } from '@/components/brand';

export default function Landing() {
  const info = useGetAppInfo();
  const steps = [
    { icon: UserRound, t: 'Simpan karakter Anda', d: 'Satu foto milik Anda sendiri, dengan izin tertulis. Bisa diganti atau dihapus kapan saja.' },
    { icon: BookOpenText, t: 'Pelajari sumber resmi', d: 'Indeks pengetahuan internal Solid Gold, lengkap dengan status validasi tiap dokumen.' },
    { icon: Lock, t: 'Tim kecil, akses tertutup', d: 'Maksimal sepuluh anggota. Setiap akun baru diaktifkan manual oleh Super Admin.' },
  ];
  return (
    <div className="min-h-[100dvh] overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Wordmark />
        <Link href="/sign-in" data-testid="link-header-signin" className="rounded-full px-4 py-2 text-sm font-semibold ring-1 ring-border hover:bg-muted">Masuk</Link>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pb-16 pt-10 md:pt-20">
        <div aria-hidden="true" className="spin-slow pointer-events-none absolute -right-40 -top-20 h-[520px] w-[520px] rounded-full border-[40px] border-accent/50 md:-right-20" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 top-40 h-48 w-48 rounded-full bg-primary/90 md:right-40" />
        <div className="relative max-w-3xl">
          <Pill tone="ink" className="rise">{info.data?.stage ?? 'Fase A'} — internal</Pill>
          <h1 className="rise rise-1 font-display mt-6 text-[clamp(3rem,10vw,7.5rem)] font-extrabold leading-[0.88]">
            Pilih karakter.<br /><span className="text-primary">Bukan</span> editor.
          </h1>
          <p className="rise rise-2 mt-6 max-w-xl text-lg text-muted-foreground">
            Studio kreator khusus karyawan Solid Gold. Sesederhana memilih karakter tersimpan — siapkan wajah Anda dan pahami sumber resminya lebih dulu.
          </p>
          <div className="rise rise-3 mt-8 flex flex-wrap gap-3">
            <Link href="/sign-in" data-testid="link-hero-signin" className="inline-flex items-center gap-2 rounded-2xl bg-foreground px-6 py-4 font-semibold text-background hover:opacity-90">
              Masuk ke studio <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/sign-up" data-testid="link-hero-signup" className="inline-flex items-center rounded-2xl px-6 py-4 font-semibold ring-1 ring-border hover:bg-muted">
              Daftar akun karyawan
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <ol className="grid gap-px overflow-hidden rounded-3xl bg-border md:grid-cols-[1.3fr_1fr_1fr]">
          {steps.map((s, i) => (
            <li key={s.t} className="bg-card p-7">
              <div className="flex items-center justify-between">
                <s.icon className="h-6 w-6 text-primary" aria-hidden="true" />
                <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
              </div>
              <h2 className="font-display mt-6 text-2xl font-bold">{s.t}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="grid gap-6 rounded-3xl bg-sidebar p-8 text-sidebar-foreground md:grid-cols-[1fr_auto] md:items-center md:p-12">
          <div>
            <Pill tone="sun">Belum tersedia</Pill>
            <h2 className="font-display mt-4 text-3xl font-extrabold md:text-4xl">Pembuatan video belum dinyalakan.</h2>
            <p className="mt-3 max-w-xl text-sidebar-foreground/70">
              Fase ini hanya fondasi: akun, karakter, dan pengetahuan. Tidak ada video, model bahasa, atau layanan berbayar yang berjalan.
              {info.data ? ` Saat nanti aktif, batasnya ${info.data.dailyLimit} per hari untuk tim maksimal ${info.data.maxMembers} orang.` : ''}
            </p>
          </div>
          <div className="font-display text-7xl font-extrabold text-sidebar-primary md:text-8xl" aria-hidden="true">A</div>
        </div>
        <p className="mt-6 text-center font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">Khusus internal Solid Gold</p>
      </section>
    </div>
  );
}

import type { ReactNode } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { Link } from 'wouter';
import { Wordmark } from '@/components/brand';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground md:flex md:flex-col">
        <Link href="/" className="w-fit"><Wordmark light /></Link>
        <div aria-hidden="true" className="spin-slow absolute -bottom-32 -left-32 h-[460px] w-[460px] rounded-full border-[36px] border-sidebar-primary/70" />
        <div aria-hidden="true" className="absolute bottom-24 right-16 h-28 w-28 rounded-full bg-primary" />
        <h2 className="font-display relative mt-auto mb-40 max-w-sm text-5xl font-extrabold leading-[0.95]">{title}</h2>
      </div>
      <div className="flex min-w-0 flex-col items-center justify-center px-4 py-10">
        <div className="mb-6 md:hidden"><Link href="/"><Wordmark /></Link></div>
        <div className="rise w-full min-w-0 max-w-[440px]">{children}</div>
      </div>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthFrame title="Studio Anda menunggu.">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

export function SignUpPage() {
  return (
    <AuthFrame title="Daftar, lalu tunggu aktivasi.">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

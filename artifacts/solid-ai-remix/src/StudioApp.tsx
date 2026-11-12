import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Switch, Redirect, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary, type ErrorFallbackProps } from '@/components/error-boundary';
import SharedStudioPage from '@/pages/shared-studio';
import NotFound from '@/pages/not-found';
import { registerServiceWorker } from '@/lib/pwa';

// Keep Clerk (including its runtime script), admin shell and private pages out
// of shared-studio visits. Their provider and cache still live together.
const AdminApp = lazy(() => import('./App'));
registerServiceWorker();

function PageFailure({ error }: ErrorFallbackProps) {
  return <div role="alert" className="grid min-h-[100dvh] place-items-center p-6">
    <div className="max-w-md space-y-4 text-center">
      <h1 className="text-xl font-semibold">Halaman belum berhasil dimuat</h1>
      <p className="text-sm text-muted-foreground">Periksa koneksi, lalu muat ulang halaman. Jika aplikasi baru diperbarui, cara ini mengambil versi terbaru.</p>
      {import.meta.env.DEV && <pre className="overflow-auto text-xs">{error.message}</pre>}
      {/* React.lazy caches rejected imports; resetting a boundary alone cannot
          retry a missing chunk. A user-initiated reload also fetches new HTML. */}
      <button className="rounded-xl bg-primary px-4 py-2 text-primary-foreground" onClick={() => window.location.reload()}>Muat ulang halaman</button>
      <a className="block text-sm underline" href={`${import.meta.env.BASE_URL}studio`}>Kembali ke studio</a>
    </div>
  </div>;
}

function PageBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location} FallbackComponent={PageFailure}>
    <Suspense fallback={<div role="status" aria-live="polite" className="grid min-h-[100dvh] place-items-center p-6 text-sm text-muted-foreground">Memuat halaman...</div>}>
      {children}
    </Suspense>
  </ErrorBoundary>;
}

export default function StudioApp() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
    <PageBoundary>
      <Switch>
        <Route path="/"><Redirect to="/studio" /></Route>
        <Route path="/studio/member/:folderId" component={SharedStudioPage} />
        <Route path="/studio" component={SharedStudioPage} />
        <Route path="/sign-in/*?" component={AdminApp} />
        <Route path="/sign-up/*?" component={AdminApp} />
        <Route path="/admin/studio" component={AdminApp} />
        <Route path="/character" component={AdminApp} />
        <Route path="/knowledge" component={AdminApp} />
        <Route path="/knowledge/:id" component={AdminApp} />
        <Route path="/creative" component={AdminApp} />
        <Route path="/creative/library" component={AdminApp} />
        <Route path="/videos" component={AdminApp} />
        <Route path="/operations" component={AdminApp} />
        <Route path="/providers" component={AdminApp} />
        <Route path="/facts" component={AdminApp} />
        <Route path="/video-review" component={AdminApp} />
        <Route path="/team" component={AdminApp} />
        <Route component={NotFound} />
      </Switch>
    </PageBoundary>
  </WouterRouter>;
}

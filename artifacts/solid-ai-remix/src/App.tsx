import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, Show, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import type { Member } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/app-shell';
import { MemberGate } from '@/components/member-gate';
import NotFound from '@/pages/not-found';
import { SignInPage, SignUpPage } from '@/pages/auth';
import Studio from '@/pages/studio';
import CharacterPage from '@/pages/character';
import Knowledge from '@/pages/knowledge';
import KnowledgeDetail from '@/pages/knowledge-detail';
import Team from '@/pages/team';
import CreativePage from '@/pages/creative';
import CreativeLibraryPage from '@/pages/creative-library';
import VideosPage from '@/pages/videos';
import OperationsPage from '@/pages/operations';
import ProvidersPage from '@/pages/providers';
import FactsPage from '@/pages/facts';
import VideoReviewPage from '@/pages/video-review';
import { installActivityRefresh } from '@/lib/activity-polling';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(11 80% 50%)',
    colorForeground: 'hsl(290 38% 13%)',
    colorMutedForeground: 'hsl(290 12% 38%)',
    colorDanger: 'hsl(352 72% 44%)',
    colorBackground: 'hsl(40 50% 97%)',
    colorInput: 'hsl(38 40% 93%)',
    colorInputForeground: 'hsl(290 38% 13%)',
    colorNeutral: 'hsl(290 38% 13%)',
    fontFamily: "'Instrument Sans', sans-serif",
    borderRadius: '0.9rem',
  },
  elements: {
    rootBox: 'w-full min-w-0 max-w-full flex justify-center',
    cardBox: 'bg-[hsl(40_50%_97%)] rounded-[28px] w-[440px] min-w-0 max-w-full overflow-hidden ring-1 ring-[hsl(32_24%_84%)] shadow-none',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: "text-[hsl(290_38%_13%)] font-extrabold text-2xl [font-family:'Bricolage_Grotesque',sans-serif]",
    headerSubtitle: 'text-[hsl(290_12%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(290_38%_13%)] font-medium',
    formFieldLabel: 'text-[hsl(290_38%_13%)] font-medium',
    footerActionLink: 'text-[hsl(11_80%_46%)] font-semibold',
    footerActionText: 'text-[hsl(290_12%_38%)]',
    dividerText: 'text-[hsl(290_12%_38%)]',
    identityPreviewEditButton: 'text-[hsl(11_80%_46%)]',
    formFieldSuccessText: 'text-[hsl(170_45%_26%)]',
    alertText: 'text-[hsl(290_38%_13%)]',
    logoBox: 'h-12',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'bg-[hsl(38_40%_93%)] border-[hsl(32_22%_80%)]',
    formButtonPrimary: 'bg-[hsl(11_80%_50%)] text-[hsl(38_60%_97%)] rounded-xl py-2.5 font-semibold shadow-none',
    formFieldInput: 'bg-[hsl(38_40%_93%)] border-[hsl(32_20%_76%)] rounded-xl',
    footerAction: 'justify-center',
    dividerLine: 'bg-[hsl(32_22%_82%)]',
    alert: 'bg-[hsl(42_92%_58%/0.2)] border-0',
    otpCodeFieldInput: 'border-[hsl(32_20%_76%)]',
    formFieldRow: 'gap-3',
    main: 'gap-5',
  },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => installActivityRefresh(() => {
    void qc.refetchQueries({ type: 'active', stale: true }, { cancelRefetch: false });
  }), [qc]);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  return <Redirect to="/studio" />;
}

function Private({ render }: { render: (me: Member) => ReactNode }) {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <SessionLoading />;
  return (
    <>
      <Show when="signed-in">
        <MemberGate>{(me) => <AppShell me={me}>{render(me)}</AppShell>}</MemberGate>
      </Show>
      <Show when="signed-out"><Redirect to="/sign-in" /></Show>
    </>
  );
}

function SessionLoading() {
  return (
    <div role="status" aria-live="polite" className="grid min-h-[100dvh] place-items-center p-6 text-sm text-muted-foreground">
      Memuat sesi Anda...
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />
        <Route path="/admin/studio">{() => <Private render={(me) => <Studio me={me} />} />}</Route>
        <Route path="/character">{() => <Private render={(me) => <CharacterPage me={me} />} />}</Route>
        <Route path="/knowledge">{() => <Private render={() => <Knowledge />} />}</Route>
        <Route path="/knowledge/:id">{() => <Private render={() => <KnowledgeDetail />} />}</Route>
        <Route path="/creative">{() => <Private render={(me) => <CreativePage me={me} />} />}</Route>
        <Route path="/creative/library">{() => <Private render={(me) => <CreativeLibraryPage me={me} />} />}</Route>
        <Route path="/videos">{() => <Private render={(me) => <VideosPage me={me} />} />}</Route>
        <Route path="/operations">{() => <Private render={(me) => <OperationsPage me={me} />} />}</Route>
        <Route path="/providers">{() => <Private render={(me) => <ProvidersPage me={me} />} />}</Route>
        <Route path="/facts">{() => <Private render={(me) => <FactsPage me={me} />} />}</Route>
        <Route path="/video-review">{() => <Private render={(me) => <VideoReviewPage me={me} />} />}</Route>
        <Route path="/team">{() => <Private render={(me) => <Team me={me} />} />}</Route>
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Masuk sebagai pengelola', subtitle: 'Anggota studio cukup memakai password bersama' } },
        signUp: { start: { title: 'Daftar akun pengelola', subtitle: 'Hak admin hanya dapat diberikan pemilik aplikasi' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  // Leaving admin unmounts Clerk's user-change listener. Do not retain private
  // query data while that listener is absent (e.g. sign-out in another tab).
  // The shared studio owns a separate client and must not be cleared here.
  useEffect(() => () => queryClient.clear(), []);
  return <ClerkProviderWithRoutes />;
}

export default App;

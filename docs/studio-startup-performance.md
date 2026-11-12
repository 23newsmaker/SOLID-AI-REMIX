# Studio startup: production-build comparison

Measured 2026-11-12. Scope: first visit to `/studio`, until the shared-password
input is enabled and has painted. These are actual Chromium measurements under
mobile-like throttling, **not physical Android/iPhone or published-app timings**.

## Results

Decimal kB (1,000 bytes), gzip level 6:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial first-party JavaScript | 735.11 kB | 307.01 kB | −58.2% |
| Initial first-party JavaScript, gzip | 212.09 kB | 92.37 kB | −56.4% |
| Password gateway ready, median of 5 cold runs | 2,020.9 ms | 1,360.9 ms | −32.7% |
| First contentful paint, median | 672 ms | 680 ms | No demonstrated improvement |
| CSS | 152.63 kB | 152.63 kB | Unchanged |
| CSS, gzip | 25.59 kB | 25.59 kB | Unchanged |
| All first-party JS chunks, including deferred routes | 735.11 kB | 741.22 kB | +0.8% |
| All JS chunks, gzip (sum of separately compressed files) | 212.09 kB | 216.97 kB | +2.3% |

Gateway-ready times in milliseconds:

- Before: 2048.4, 2020.9, 2180.9, 1989.8, 2001.2.
- After: 1501.0, 1401.1, 1344.5, 1360.9, 1334.4.

Splitting defers work; it does not eliminate the code/features. Total download
for someone who eventually opens every feature is slightly larger. Initial JS
numbers exclude Clerk's separately hosted runtime; the old page **requested**
that runtime, whereas the new gateway made **no Clerk or admin-chunk requests**
in all five samples. No completion time or byte savings are claimed for that
external request.

## What changed and why

- `src/StudioApp.tsx` owns the existing browser routes and mounts the shared
  gateway without Clerk. `src/App.tsx` retains the private route tree, Clerk
  configuration, membership/role gates, shell, toasts and private query client;
  it is imported only on the existing auth/admin URLs.
- The private query cache is cleared when its auth listener unmounts, preventing
  reuse of privileged data if the account changes while visiting the shared
  studio. The independent shared-studio cache is not cleared by admin auth.
- The folder editor is imported only after an authenticated shared session has
  selected an available folder. The password gateway and folder list do not
  need to download editor/media/dialog code.
- Both lazy boundaries have visible loading states. A failed chunk import has
  a visible error screen, user-initiated reload (React.lazy caches rejected
  imports), and a link back to the studio.
- Vite's existing production settings already split dynamic imports correctly.
  No vendor/manual chunk rules, library replacement, raised warning limit or
  removed features were needed. The largest resulting chunk is 336.83 kB.
- Shared password/API protection, all URLs including auth wildcards and member
  folder links, manifest, service worker and its private-data exclusions remain
  intact. PWA registration runs at the public entry, not inside deferred admin.

## Method and reproduction

The benchmark serves a **production build**, gzip-compressed, on an isolated
loopback origin and launches installed Chromium through CDP. Each sample uses a
fresh browser context, disabled HTTP cache, 390×844 mobile viewport, 1.6 Mbps
download / 750 Kbps upload, 150 ms latency and 4× CPU throttling. Readiness is
the enabled password input plus two animation frames, not just an HTML response
or first paint.

The anonymous session endpoint is a fixed
`{ authenticated: false, configured: true }` fixture. It makes the frontend
comparison repeatable without reading passwords, changing users, or measuring
variable database/auth latency. All other API endpoints return unauthorized.
Google Fonts are blocked identically in both builds to isolate app code.
Consequently, these measurements do **not** include real font download time,
real API latency, password submission, authenticated folder/editor readiness,
physical-phone CPU behaviour, PWA installation, or offline rendering. The real
development session endpoint was separately checked and returned the same
anonymous/configured state.

```sh
# Build with the existing root preview base; no config or secret changes.
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/solid-ai-remix build
node scripts/measure-studio-startup.mjs \
  artifacts/solid-ai-remix/dist/public \
  generated-artifacts/studio-startup/after.json 5

# Shared declarations must be current before the leaf type check.
pnpm run typecheck:libs
pnpm --filter @workspace/solid-ai-remix typecheck
```

For a before/after comparison, preserve the baseline build under the ignored
`generated-artifacts/` directory **before** editing and run the same command
against that directory. Raw timings and request traces from this comparison
are in `generated-artifacts/studio-startup/{before,after}.json`; generated
builds and raw evidence are deliberately excluded from Git and deployment.

Build and frontend typecheck passed. The build still emits the existing
nonfatal tooltip sourcemap warning. Neither build nor typecheck required
changing dependencies or API contracts.

## Focused browser regression checks

One mobile browser pass confirmed root redirect, the anonymous password gate
on both shared URLs, anonymous admin redirect to a working Clerk sign-in form,
the signed-in pending-membership gate, and read-only access to `/operations`
using a temporary synthetic Super Admin membership. Returning to the shared
studio remained independent of the Clerk session. Sign-up wildcard routing,
unknown-URL 404, the lazy loading state, and a deliberately failed admin import
followed by successful user-initiated reload were also checked.

All test contexts were closed before deleting and verifying removal of the
exact synthetic application membership. No real user, studio folder or asset
was changed. No actual shared password was obtained/entered, and an
authenticated folder/editor journey and other privileged pages were not
browser-tested.

The pass also observed two separate issues outside this startup change:
the pending-membership card overflowed the narrow viewport, and
`GET /api/operations/report` returned HTTP 500 while settings, retention and
audit endpoints returned 200. The admin shell/access guard loaded correctly;
the report's error state was visible. This frontend-only optimization does not
claim to fix that backend report or establish when its failure began.

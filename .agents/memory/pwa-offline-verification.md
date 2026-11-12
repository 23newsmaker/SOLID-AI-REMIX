---
name: PWA offline verification
description: Distinguish browser-target offline emulation from actual service-worker network failure.
---

Page-level offline emulation is not sufficient evidence that a service worker's
navigation fetch lost connectivity. Verify response provenance and an actual
worker fetch failure before diagnosing a broken offline fallback.

**Why:** In a Chromium 157 acceptance check, the page reported offline and its
uncached JS/CSS failed, but the worker still supplied the SPA shell. The same
controller and cache returned the correct public offline notice when the isolated
loopback test server was stopped. Treating the first result as an application
bug would have led to unnecessary caching or authentication changes.

**How to apply:** Use an isolated production-build test origin, inspect the active
controller and cached fallback, and distinguish page-target CDP simulation from
actual test-server unreachability. Restore every emulated network session before
checking recovery. Never stop managed application/production services for this
test, cache private studio data as a workaround, or equate viewport emulation
with installation or permissions on a physical Android/iPhone.

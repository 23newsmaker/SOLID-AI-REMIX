---
name: Auth cache lifecycle
description: Keep privileged caches safe when shared-password visits do not initialize admin authentication.
---

Privileged query data must not outlive the authentication identity listener
that makes it safe to reuse. Keep shared-password studio state independent of
admin authentication and its cache invalidation.

**Why:** Lazy-mounting admin authentication removes its listener during shared
studio visits. An admin can then sign out or change accounts in another tab
while no listener is present to clear previously privileged data. A later mount
must not reuse that data under the new identity.

**How to apply:** Whenever moving an auth provider/listener across route or
lazy-loading boundaries, account for identity changes while it is unmounted.
Clear or identity-scope the privileged cache; never clear shared-studio drafts
as a side effect of admin sign-in/sign-out.

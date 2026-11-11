# SOLID AI REMIX

Internal content-production studio for the Solid Gold creator/marketing team.
Current delivery is Phase A foundation only. No LLM API or video provider is invoked.
See `.agents/memory/product-boundaries.md` for owner-agreed scope and rationale.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — shared Express API, managed workflow.
- `pnpm --filter @workspace/solid-ai-remix run dev` — frontend, managed workflow injects PORT/BASE_PATH.
- `pnpm run typecheck` — all packages.
- `pnpm --filter @workspace/api-spec run codegen` — API hooks/Zod from the contract.
- `pnpm --filter @workspace/db run push` — development schema only; Publish owns production schema.
- `pnpm --filter @workspace/api-server run import-kb /absolute/path/to/SOLID_AI_REMIX_KB_v1` — explicit, idempotent original KB import into private App Storage plus database metadata.

## Stack and ownership

- React/Vite, TypeScript, Express 5, PostgreSQL/Drizzle.
- Clerk managed auth: cookie-based web sessions, canonical production proxy at `/api/__clerk`.
- Roles and membership enforced in the API, not merely UI. New verified signups default to PENDING/VIEWER.
- Shared `SOLID_BOOTSTRAP_ADMIN_EMAIL` is an owner-configured first-admin identifier, never hardcode its value in source. Grant consumed once after verified primary Clerk email matches; environment-specific identity.
- Maximum ten ACTIVE members, serialized in DB transactions. Admin cannot edit their own role/status.
- Private App Storage for photo bytes and original KB documents; DB stores metadata and Markdown text. No public object-serving route.

## Where things live

- `artifacts/solid-ai-remix/src/` — app, login, studio, character, knowledge and team pages.
- `artifacts/solid-ai-remix/public/` — non-sensitive logo/icon/manifest/service worker only.
- `artifacts/api-server/src/routes/` — guarded endpoints.
- `artifacts/api-server/src/middlewares/member.ts` — verified identity bridge and authorization.
- `artifacts/api-server/scripts/import-kb.ts` — original-source import, no auto-approval.
- `lib/api-spec/openapi.yaml` — contract; title must remain Api.
- `lib/db/src/schema/` — members, consumed bootstrap grants, characters/upload tickets, sources, audit.

## Current limitations

- No draft/video jobs, templates, TTS, video rendering, provider integration or public-content approvals yet.
- Initial import: 77 source entries (including 58 legacy nodes). Markdown full text searchable. PDF/DOCX/PPTX are metadata-only until extraction is implemented. Original binary bytes are preserved privately.
- Every initial source is unapproved for publication. Public results correctly remain empty.
- First-admin grant and KB import were prepared in development. Production has a separate Clerk user store/database: on publishing, bootstrap env prepares that environment's grant, but production KB DATA must be imported explicitly before use; never assume dev rows migrate with schema.
- Saved character photo is not a trained digital avatar and does not establish identity consistency.
- Character photos retained until replaced/deleted; upload tickets expire after 15 minutes. Abandoned uploads are cleaned when their owner next requests an upload; periodic global cleanup is not implemented.
- No signed-in UI/browser interaction verification was performed in this first build. Type checks, unauthenticated API probes and public screenshots are the available verification.

## Security invariants

- No user files/internal content in public assets, static imports, source maps, client bundles, logs or service-worker cache.
- Signed upload goes directly to staging storage. Server verifies owner, ticket, byte size, MIME and actual image bytes; strips metadata/re-encodes onto a DIFFERENT private final key before save.
- One character per member, serialized replacement/deletion. VIEWER cannot change a character.
- Auth, API and private responses are no-store. Service worker only caches app icons/manifest.
- Preserve source originals; imported legacy PUBLIC labels are not approval grants. Source-selected conflict resolution does not approve whole documents or cross-segment values.
- No startup schema migrations or production SQL mutation from agent tools.

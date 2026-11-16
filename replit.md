# SOLID AI REMIX

Internal content-production studio for the Solid Gold creator/marketing team.
Current delivery includes the Phase B Creative Engine. No LLM API is invoked. One opt-in video provider exists: ComfyUI on the team's own GPU PC (see `docs/comfyui-integration.md`); it is off until a Super Admin enables it, and no paid provider is configured.
See `.agents/memory/product-boundaries.md` for owner-agreed scope and rationale.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — shared Express API, managed workflow.
- `pnpm --filter @workspace/solid-ai-remix run dev` — frontend, managed workflow injects PORT/BASE_PATH.
- `pnpm run typecheck` — all packages.
- `pnpm --filter @workspace/api-server run test` — unit tests (ComfyUI client/runner use an in-process mock; no GPU or database needed except where a test says so).
- `pnpm --filter @workspace/api-server run mock-comfyui` — fake ComfyUI for local development.
- `pnpm --filter @workspace/api-spec run codegen` — API hooks/Zod from the contract.
- `pnpm --filter @workspace/db run push` — development schema only; Publish owns production schema.
- `pnpm --filter @workspace/api-server run validate-creative` — isolated real-handler/DB/storage checks; writes ignored evidence and cleans only its unique fixtures.
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

## Current capabilities and limitations

- Creative Engine at `/creative`: versioned concepts, deterministic JSON prompts, private optional attachments, and separate compliance review. Library management at `/creative/library` is ADMIN/SUPER_ADMIN only.
- Mode Hemat produces private 720×1280 MP4s with photo motion, compositing, subtitles and optional uploaded narration. No paid AI video/TTS provider is activated; mock/simulation is never real AI.
- Phase D: `/operations` for Admin/Super reports, CSV, budgets, quota 1–3/day Jakarta, audit and retention proposals; `/providers` is Super-only; `/facts` manages individually sourced claims. Source approval is not approval of every claim in a document.
- Limited Phase E: measured per-job preparation/render/decode/storage timings and byte counts, technical QC (not content approval), additive optimization metrics/filter/CSV inside `/operations`, mobile-safe text blocks, and opt-in before/after motion suggestions in the existing concept editor. Paid AI and face-consistency comparisons remain NOT TESTED; unknown CPU/storage costs remain unknown. Legacy jobs are not backfilled with guessed metrics. No speed improvement is promised from a small synthetic benchmark.
- ComfyUI provider (`mode AI`, `provider comfyui`): MiniMax H3 workflows rendered on a remote GPU PC through Cloudflare Tunnel + Access. Secrets `COMFYUI_URL`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` (server only, never logged or returned). Never run ComfyUI on Replit. Async only: submit → stored `prompt_id` → poll `/history` → stream `/view` to private storage; a stored `prompt_id` is resumed after restart and `POST /prompt` is never retried. Activation: Super only, in `/providers`, audited. Tables `solid_comfy_jobs`, `solid_provider_settings`. Code: `artifacts/api-server/src/lib/comfyui/` (pure `workflow.ts`/`plan.ts`, `client.ts`, `runner.ts`, `worker.ts`, mock server for tests). MP4/audio attachments are ignored; no RVC, lip-sync or identity gate exists in these workflows, so identity/voice/claims need human review. GPU cost is recorded as unmeasured. Hemat worker only claims `mode='HEMAT'` jobs.
- Final video review at `/video-review` is independent from render COMPLETED. Publication approval binds the result hash and concept/material/fact versions; creators cannot approve their own work, including privileged creators. Review downloads remain private and do not imply permission to publish.
- Retention defaults to manual. Automatic result deletion requires explicit Super approval of the exact policy version and at least24hours notice; do not treat phase approval as deletion consent. Original KB, character/material assets and evidence are preserved.
- Local CPU/storage cost remains unknown. Provider-only zero is not total cost; unknown charges are not zero. Paid jobs without a reliable upper cost bound must be refused.
- Initial import: 77 source entries (including 58 legacy nodes). Markdown full text searchable. PDF/DOCX/PPTX are metadata-only until extraction is implemented. Original binary bytes are preserved privately.
- Initial sources are unapproved for publication. Populate public claims only by explicit individual compliance decisions; never approve the original KB in bulk.
- First-admin grant and KB import were prepared in development. Production has a separate Clerk user store/database: on publishing, bootstrap env prepares that environment's grant, but production KB DATA must be imported explicitly before use; never assume dev rows migrate with schema.
- Saved character photo is not a trained digital avatar and does not establish identity consistency.
- Character photos retained until replaced/deleted; upload tickets expire after 15 minutes. Abandoned uploads are cleaned when their owner next requests an upload; periodic global cleanup is not implemented.
- Phase B validation evidence is generated under `generated-artifacts/phase-b-validation/`; do not confuse handler-level checks with browser/auth verification. The final report names each method and limitation.

## Security invariants

- No user files/internal content in public assets, static imports, source maps, client bundles, logs or service-worker cache.
- Signed upload goes directly to staging storage. Server verifies owner, ticket, byte size, MIME and actual image bytes; strips metadata/re-encodes onto a DIFFERENT private final key before save.
- One character per member, serialized replacement/deletion. VIEWER cannot change a character.
- Auth, API and private responses are no-store. Service worker only caches app icons/manifest.
- Preserve source originals; imported legacy PUBLIC labels are not approval grants. Source-selected conflict resolution does not approve whole documents or cross-segment values.
- No startup schema migrations or production SQL mutation from agent tools.
- Concept edits and attachment changes increment versions, revoke readiness and reset to DRAFT/REVISED. Immutable snapshots retain the old evidence. ADMIN oversight is not compliance approval; REVIEWER_COMPLIANCE/SUPER_ADMIN decisions must be independent.
- Quotas: 10 saved concepts/member; 3 JPG/PNG/WebP up to 5 MiB each + 1 MP4 up to 20 MiB, total 35 MiB/concept. Pending/tombstoned reservations count. No OCR, transcription, media interpretation, or provider-format promises.
- `ffmpeg`/`ffprobe` validate media and produce real local Hemat videos. The local renderer is not image-to-video AI or lip-sync. Missing binaries fail explicitly.
- Removed attachments stop being served immediately; bytes are cleaned after signed PUT expiry plus a safety delay. Cleanup runs every five minutes and at startup, with a paginated sweep for untracked final objects older than one hour.
- Concept snapshots contain character identity/revision but never a copy of its photo/path. Stale references invalidate production readiness and block approval until re-saved. Revoked source permissions hide stored prompts.

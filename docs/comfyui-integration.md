# ComfyUI provider ("ComfyUI (AI)")

SOLID AI REMIX can render a concept with MiniMax H3 on a ComfyUI instance running on the team's own GPU PC.
ComfyUI is **never** installed or run on Replit (no GPU). The API server only talks to it over HTTPS.
Mode Hemat is unchanged; this provider is opt-in and can only be switched on by `SUPER_ADMIN`.

## Architecture

```
Browser ──> Express API (Replit) ──HTTPS + CF-Access headers──> Cloudflare Tunnel ──> ComfyUI 127.0.0.1:8188
                │                                                                   (GPU PC, MiniMax H3)
                ├─ PostgreSQL: solid_video_jobs (shared) + solid_comfy_jobs (AI details)
                └─ private App Storage: final MP4  ──> /video-review (unchanged)
```

Request flow (every ComfyUI call is short; nothing waits inside one HTTP request, because Cloudflare's free plan cuts requests at about 100 s):

1. `POST /api/video/jobs` with `mode: "AI"`. The API checks provider enabled + configured + online, the shared eligibility checks (owner, approved concept, version, staleness), concept mode `AI`, duration 5–15 s, daily quota and budgets, then inserts a `QUEUED` job (idempotent on `requestKey`).
2. The ComfyUI worker (own advisory lock, one GPU job at a time) picks it up:
   `PREFLIGHT` (`/object_info/<class>` for every node class and model in the workflow) → `UPLOADING` (`/upload/image`) → `POST /prompt` → **`prompt_id` saved immediately** → poll `GET /history/{prompt_id}` (2 s growing to 10 s) → `DOWNLOADING` (`GET /view`, streamed, max 20 MiB) → `ffprobe` + full decode → private storage.
3. The result is a normal completed video job (`provider = comfyui`, `mode = AI`) and appears in `/video-review`. Publication approval and compliance review are unchanged and still required.

Restart safety: a job with a stored `prompt_id` resumes polling; one without it is failed (it is unknown whether it was submitted) and is **never resubmitted automatically**. `POST /prompt` is never retried.

Failure messages shown to the user: Cloudflare Access denied (401/403/redirect), ComfyUI/tunnel offline, request or job timeout (default 45 min from submission), missing node/model (with the list), ComfyUI execution error (node + first line), no MP4 produced, result over 20 MiB, failed technical check, concept changed during render.

## Secrets (server environment only)

| Name | Meaning |
|---|---|
| `COMFYUI_URL` | Public HTTPS URL of the tunnel, e.g. `https://comfy.example.com` (plain `http` is accepted only for loopback in development) |
| `CF_ACCESS_CLIENT_ID` | Cloudflare Access service token id |
| `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token secret |

They are sent as `CF-Access-Client-Id` / `CF-Access-Client-Secret` on every request. They are not logged, not stored in the database, not returned by any endpoint, and not included in error messages. The UI only shows "configured: yes/no".
Never commit them. `.env` is git-ignored.

## Cloudflare Tunnel + Access (setup on the GPU PC)

1. Install `cloudflared`; run ComfyUI on `127.0.0.1:8188` only (do not expose the port directly).
2. Zero Trust → Networks → Tunnels → create a tunnel, add a public hostname pointing to `http://localhost:8188`.
3. Zero Trust → Access → Service Auth → create a **Service Token**; copy the id and secret once.
4. Zero Trust → Access → Applications → self-hosted app for that hostname; add a policy with action **Service Auth** that includes the token (and nothing else).
5. Put the three secrets in the Replit Secrets panel. Verify from any machine:
   `curl -H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …" https://<host>/system_stats`
   Without the headers Cloudflare must answer 403 or redirect to a login page.
6. Free-plan limits: ~100 s per request, ~100 MB per upload. Renders are asynchronous, inputs are ≤ 5 MiB images, results ≤ 20 MiB.

## Workflows and mapping

Templates live in `artifacts/api-server/src/lib/comfyui/workflows/` (ComfyUI "Save (API Format)" files) and are filled by the pure function `buildWorkflow` in `workflow.ts` (tested in `workflow.test.ts`).

| Option (`options.aiWorkflow`) | File | Images |
|---|---|---|
| `I2V` (default) | `minimax_h3_i2v.api.json` | character photo → node 16 (first frame) |
| `FIRST_LAST` | `minimax_h3_first_last_i2v.api.json` | character photo → 16, first image attachment → 17 |
| `REF2VA` | `minimax_h3_ref2va.api.json` | character photo + up to 3 image attachments → nodes 21.. and `ref_images` of node 6 |

| Field | Node | Input | Source |
|---|---|---|---|
| Prompt | 6 | `prompt` | composed from the concept (see below) |
| Width / height | 6 | `width`, `height` | 9:16 character shots 768×1344 (short edge 768, area ≤ 768×1344); other workflows ≈ 480×864; multiples of 32 |
| Frames | 6 | `length` | `17k+5`, k = 7..21 (124–362 frames at 24 fps), from the concept duration |
| Seed | 9 | `noise_seed` | derived from the request hash (same request ⇒ same seed) |
| Steps | 7 | `steps` | 12 (`FAST`) or 20 (`QUALITY`) |
| Reference size | 6 | `ref_image_size` | `match` |
| File prefix | 15 | `filename_prefix` | `video/solid_<jobId>` |

Prompt composition (`composePrompt`, deterministic): an audio-language lock that wraps the narration as `<d>[Indonesian] …</d>` (angle brackets in user text are stripped so they cannot open or close the tag), a character/asset reference lock, then style, scene, presenter motion, camera, visual, format/duration, and an instruction not to add text, numbers, logos or claims absent from the supplied images. The SOLID concept's own JSON prompt (facts, constraints) is **not** sent to the model.

What is deliberately not supported: MP4 attachments (no `LoadVideo` node in any workflow) and audio attachments are ignored and listed as such in the job; RVC voice colouring, lip-sync and identity quality gates from Creator Engine are **not** part of these workflows, so identity, voice and claims must be judged by a human in `/video-review`. The only automatic checks are technical (H.264 video track, audio track, duration within ±2.5 s, ≤ 20 MiB, full decode).

To add or change a workflow: export "Save (API Format)", add it under `workflows/`, extend `workflow.ts` (node ids, kind) and its tests, run **Tes koneksi dan workflow** in `/providers`.

## Pre-flight

Before uploading anything the worker asks ComfyUI for each node class (`GET /object_info/<class>`) and for the option list of every `UNETLoader`/`CLIPLoader`/`VAELoader`; a missing node or model file rejects the job with the exact list. `/providers` → *Tes koneksi dan workflow* runs the same check for all three workflows without creating a job.

**Not yet verified against a real ComfyUI.** The README that accompanies the workflows says it is unknown whether `MiniMaxH3ImageToVideo` / `MiniMaxH3ReferenceToVideo` are built in or custom nodes; the ComfyUI log of the GPU PC shows `MiniMaxH3` model classes loading, but the node class names are only confirmed by `/object_info`. Run the test button (or `curl …/object_info/MiniMaxH3ImageToVideo`) before enabling.

## Database

New tables (Drizzle schema `lib/db/src/schema/comfy.ts`; this repo has no migration files, schema is applied with `pnpm --filter @workspace/db run push` in development and by Publish in production):

- `solid_comfy_jobs` — one row per AI job: phase, `prompt_id`, workflow file/hash/snapshot, seed, size, frames, steps, concept version, inputs used/ignored, error code/detail, technical checks.
- `solid_provider_settings` — provider switch (`comfyui`), reason, who changed it.

## Quota, cost, retention

AI jobs count against the same daily quota and budgets as other jobs and use the same private storage, retention and deletion code. Provider cost is `0` (own GPU), but GPU/electricity cost is **unmeasured**, so it is recorded as unknown (`costSource = OWN_GPU_UNMEASURED`), not as zero total cost.

## Development without a GPU

```
pnpm --filter @workspace/api-server run mock-comfyui     # fake ComfyUI on 127.0.0.1:8188, requires Access headers
# local .env (git-ignored):
#   COMFYUI_URL=http://127.0.0.1:8188  CF_ACCESS_CLIENT_ID=mock-id  CF_ACCESS_CLIENT_SECRET=mock-secret
pnpm --filter @workspace/api-server run test
```

The mock serves placeholder bytes, so the server's ffprobe check rejects its "video" (correctly); it exercises upload, submit, polling, download and error display. Real rendering needs the GPU PC.

// Local stand-in for ComfyUI + Cloudflare Access, for development without a GPU.
//   pnpm --filter @workspace/api-server run mock-comfyui
// then set in your LOCAL .env (never commit it):
//   COMFYUI_URL=http://127.0.0.1:8188  CF_ACCESS_CLIENT_ID=mock-id  CF_ACCESS_CLIENT_SECRET=mock-secret
// The served "video" is placeholder bytes, so the server's ffprobe check will (correctly) refuse it:
// this exercises submit/poll/download and error display, not real rendering.
import { startMockComfy } from "../src/lib/comfyui/mock-server";

const id = process.env.MOCK_ACCESS_ID ?? "mock-id", secret = process.env.MOCK_ACCESS_SECRET ?? "mock-secret";
const mock = await startMockComfy({ access: { id, secret }, pollsBeforeDone: Number(process.env.MOCK_POLLS ?? 5), failExecution: process.env.MOCK_FAIL === "1" });
console.log(`Mock ComfyUI listening on ${mock.url} (Access headers required: id=${id})`);
process.on("SIGINT", () => { void mock.close().then(() => process.exit(0)); });

import app from "./app";
import { logger } from "./lib/logger";
import { prepareAdminGrant } from "./lib/bootstrapAdmin";
import { startCreativeCleanup } from "./lib/creative-storage";
import { startVideoWorker } from "./lib/video/worker";
import { startComfyWorker } from "./lib/comfyui/worker";
import { startVoiceCleanup } from "./lib/voice-storage";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

prepareAdminGrant().then(() => app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startCreativeCleanup();
  startVoiceCleanup();
  startVideoWorker();
  startComfyWorker();
})).catch(() => {
  logger.error("Cannot prepare internal access configuration");
  process.exit(1);
});

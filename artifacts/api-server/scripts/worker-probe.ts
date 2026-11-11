// Separate process for the development-only SIGKILL/recovery validation.
import { pool } from "@workspace/db";
import { runVideoWorker } from "../src/lib/video/worker";
if (process.env.NODE_ENV === "production") throw new Error("Development-only worker probe");
await runVideoWorker();
await pool.end();

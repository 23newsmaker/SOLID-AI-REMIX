import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import * as worker from "../src/lib/video/worker";
import * as cleanup from "../src/lib/creative-storage";

if (process.env.NODE_ENV === "production") throw new Error("Development-only idle probe");
// Counts only this probe process's actual database commands, not other users'
// traffic. Warm-up is excluded; this is not a monetary billing measurement.
let count = 0;
pool.on("connect", client => {
  const query = client.query.bind(client);
  client.query = ((...args: unknown[]) => {
    count++;
    return (query as (...args: unknown[]) => unknown)(...args);
  }) as typeof client.query;
});
worker.startVideoWorker();
cleanup.startCreativeCleanup();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
await wait(2000);
const startupQueries = count;
await wait(14000);
const result = { label: process.argv[2] ?? "after", warmupMs: 2000, observationMs: 14000,
  startupQueries, idleQueries: count - startupQueries, scope: "Actual queries in an isolated probe process; no production billing or scale-down test" };
(worker as unknown as { stopVideoWorker?: () => void }).stopVideoWorker?.();
(cleanup as unknown as { stopCreativeCleanup?: () => void }).stopCreativeCleanup?.();
await mkdir(resolve("../../generated-artifacts/phase-f"), { recursive: true });
await writeFile(resolve(`../../generated-artifacts/phase-f/idle-${result.label}.json`), JSON.stringify(result, null, 2));
console.info(JSON.stringify(result));
await pool.end();
process.exit(0);

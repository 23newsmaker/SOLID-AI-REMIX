import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";
import { rateLimit } from "express-rate-limit";

const app: Express = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// All browser API calls are same-origin. Do not allow arbitrary cross-origin credentials.
app.use(cors({ origin: false }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));
app.use(clerkMiddleware((req) => ({
  publishableKey: publishableKeyFromHost(getClerkProxyHost(req) ?? "", process.env.CLERK_PUBLISHABLE_KEY),
})));
app.use("/api", (req, res, next) => {
  res.set({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const site = req.get("sec-fetch-site");
    const origin = req.get("origin");
    const host = getClerkProxyHost(req) ?? req.get("host");
    if (site === "cross-site" || (origin && new URL(origin).host !== host)) {
      res.status(403).json({ error: "Permintaan lintas situs ditolak." }); return;
    }
  }
  next();
});
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Terlalu banyak permintaan. Coba lagi sebentar." } }));

app.use("/api", router);
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) { res.end(); return; }
  if (error instanceof Error && error.name === "ZodError") {
    res.status(400).json({ error: "Data tidak sesuai. Periksa isian dan coba lagi." }); return;
  }
  if (typeof error === "object" && error && "code" in error && error.code === 404) {
    res.status(404).json({ error: "File tidak ditemukan. Unggah ulang bila diperlukan." }); return;
  }
  // Never log request bodies, signed URLs, document content or user photos.
  req.log.error({ errorName: error instanceof Error ? error.name : "Unknown" }, "Internal request failed");
  res.status(500).json({ error: "Proses belum berhasil. Coba lagi; jika tetap gagal, hubungi admin." });
});

export default app;

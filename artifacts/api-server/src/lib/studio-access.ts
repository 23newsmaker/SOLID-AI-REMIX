import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

export const STUDIO_COOKIE = "__Secure-solid_studio";
const TTL_MS = 12 * 60 * 60 * 1000;
type Session = { id: string; expiresAt: number };

// Pure helpers also allow isolated tests with synthetic credentials.
export function studioKey(password: string, secret: string) {
  return createHmac("sha256", secret).update("solid-studio/v1\0").update(password).digest();
}
export function encodeStudioSession(key: Buffer, now = Date.now()) {
  const session: Session = { id: randomBytes(24).toString("hex"), expiresAt: now + TTL_MS };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}
export function decodeStudioSession(token: string, key: Buffer, now = Date.now()): Session | null {
  if (token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", key).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!value || typeof value !== "object" || !("id" in value) || !("expiresAt" in value)) return null;
    if (typeof value.id !== "string" || !/^[a-f0-9]{48}$/.test(value.id) ||
      typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt) ||
      value.expiresAt <= now || value.expiresAt > now + TTL_MS) return null;
    return { id: value.id, expiresAt: value.expiresAt };
  } catch { return null; }
}
export function studioConfigured() {
  const length = process.env.STUDIO_PASSWORD?.length ?? 0;
  return length >= 12 && length <= 256 && !!process.env.SESSION_SECRET;
}
function configuredKey() {
  if (!studioConfigured()) return null;
  return studioKey(process.env.STUDIO_PASSWORD!, process.env.SESSION_SECRET!);
}
export function validStudioPassword(input: string) {
  if (!studioConfigured() || input.length > 256) return false;
  return studioPasswordMatches(input, process.env.STUDIO_PASSWORD!);
}
export function studioPasswordMatches(input: string, expected: string) {
  return input.length > 0 && input.length <= 256 && timingSafeEqual(
    createHash("sha256").update(input).digest(), createHash("sha256").update(expected).digest());
}
export function newStudioToken() {
  const key = configuredKey();
  if (!key) throw new Error("Studio password is not configured");
  return encodeStudioSession(key);
}
export function readStudioSession(req: Request) {
  const key = configuredKey();
  if (!key) return null;
  const raw = req.get("cookie")?.split(";").map(c => c.trim()).find(c => c.startsWith(`${STUDIO_COOKIE}=`));
  if (!raw) return null;
  return decodeStudioSession(raw.slice(STUDIO_COOKIE.length + 1), key);
}
export const studioCookieOptions = {
  httpOnly: true, secure: true, sameSite: "strict" as const, path: "/api", maxAge: TTL_MS,
};
export const requireStudio: RequestHandler = (req, res, next) => {
  const session = readStudioSession(req);
  if (!session) { res.status(401).json({ error: "Masukkan password studio untuk melanjutkan." }); return; }
  req.studioSessionHash = createHash("sha256").update(session.id).digest("hex");
  next();
};
export const studioLoginLimit = rateLimit({
  windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: req => ipKeyGenerator(req.ip ?? "127.0.0.1"),
  message: { error: "Terlalu banyak percobaan masuk. Tunggu 15 menit lalu coba lagi." },
});

import { db, adminGrants } from "@workspace/db";

/**
 * Runs in each environment, resolving its own Clerk identity on first verified login.
 * Consumption is permanent: restarting never restores a revoked admin role.
 * No DDL, no shared passwords, no hard-coded identity and no "first user wins".
 */
export async function prepareAdminGrant() {
  const email = process.env.SOLID_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid configured admin email");
  await db.insert(adminGrants).values({ email }).onConflictDoNothing();
}

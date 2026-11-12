import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { characters } from "./characters";
import { members } from "./members";

// One durable profile per character; replacing a photo preserves the character ID.
// No provider may be activated by the sample-storage endpoints.
export const characterVoiceProfiles = pgTable("solid_character_voice_profiles", {
  characterId: text("character_id").primaryKey().references(() => characters.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull().references(() => members.id),
  version: integer("version").notNull().default(0),
  activeSampleId: text("active_sample_id"),
  provider: text("provider"),
  providerProfileId: text("provider_profile_id"),
  providerVoiceVersion: text("provider_voice_version"),
  providerStatus: text("provider_status").notNull().default("DISABLED"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Staging/retired rows double as a durable cleanup queue. No FK to character:
// deleting a character must not delete the evidence needed to retry file cleanup.
export const characterVoiceSamples = pgTable("solid_character_voice_samples", {
  id: text("id").primaryKey(),
  characterId: text("character_id").notNull(),
  ownerId: text("owner_id").notNull().references(() => members.id),
  expectedVersion: integer("expected_version").notNull(),
  version: integer("version"),
  stagingPath: text("staging_path").notNull(),
  finalPath: text("final_path"),
  expectedSize: integer("expected_size").notNull(),
  contentType: text("content_type").notNull(),
  durationMs: integer("duration_ms"),
  state: text("state").notNull().default("STAGING"),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  consentBasis: text("consent_basis"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

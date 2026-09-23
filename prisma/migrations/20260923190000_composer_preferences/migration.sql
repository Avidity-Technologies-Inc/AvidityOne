-- Additive preferences; existing messages, signatures and user settings are retained.
ALTER TABLE "system_settings" ADD COLUMN "composerDefaults" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "users" ADD COLUMN "composerPreferences" JSONB NOT NULL DEFAULT '{}';

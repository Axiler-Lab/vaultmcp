ALTER TABLE "workspaces" ADD COLUMN "wrapped_dek" text;--> statement-breakpoint
ALTER TABLE "secrets" ADD COLUMN "crypto_version" integer DEFAULT 1 NOT NULL;

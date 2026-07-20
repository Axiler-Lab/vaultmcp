ALTER TABLE "users" ADD COLUMN "totp_secret_ciphertext" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "web_sessions" ADD COLUMN "mfa_satisfied" boolean DEFAULT true NOT NULL;

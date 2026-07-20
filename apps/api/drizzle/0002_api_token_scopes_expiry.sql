ALTER TABLE "api_tokens" ADD COLUMN "scopes" text[] DEFAULT ARRAY['read','write']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "expires_at" timestamp with time zone;

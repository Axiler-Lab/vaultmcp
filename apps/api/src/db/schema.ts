import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const workspaceRoleEnum = pgEnum("workspace_role", [
  "owner",
  "admin",
  "member",
  "viewer",
]);

export const secretVisibilityEnum = pgEnum("secret_visibility", ["private", "workspace"]);

export const upstreamTransportEnum = pgEnum("upstream_transport", ["stdio", "http"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    githubId: text("github_id").notNull(),
    githubLogin: text("github_login").notNull(),
    name: text("name"),
    email: text("email"),
    avatarUrl: text("avatar_url"),
    defaultWorkspaceId: uuid("default_workspace_id"),
    /** AES-GCM ciphertext of TOTP secret; null until MFA setup. */
    totpSecretCiphertext: text("totp_secret_ciphertext"),
    totpEnabled: boolean("totp_enabled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("users_github_id_idx").on(t.githubId),
    uniqueIndex("users_github_login_idx").on(t.githubLogin),
  ],
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    /** DEK wrapped with VAULT_MASTER_KEY (KEK); null until mint/backfill. */
    wrappedDek: text("wrapped_dek"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)],
);

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("workspace_members_ws_user_idx").on(t.workspaceId, t.userId),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const secrets = pgTable(
  "secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    /**
     * 1 = legacy (KEK direct, no AAD)
     * 2 = envelope (workspace DEK + AAD = workspaceId)
     */
    cryptoVersion: integer("crypto_version").notNull().default(1),
    visibility: secretVisibilityEnum("visibility").notNull().default("private"),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("secrets_ws_name_idx").on(t.workspaceId, t.name),
    index("secrets_workspace_idx").on(t.workspaceId),
  ],
);

export const upstreamServers = pgTable(
  "upstream_servers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    transport: upstreamTransportEnum("transport").notNull(),
    command: text("command"),
    args: jsonb("args").$type<string[]>().notNull().default([]),
    url: text("url"),
    envTemplate: jsonb("env_template").$type<Record<string, string>>().notNull().default({}),
    headersTemplate: jsonb("headers_template")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("upstreams_ws_slug_idx").on(t.workspaceId, t.slug),
    index("upstreams_workspace_idx").on(t.workspaceId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    upstreamSlug: text("upstream_slug"),
    toolName: text("tool_name"),
    allowed: boolean("allowed").notNull().default(true),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("audit_logs_workspace_idx").on(t.workspaceId),
    index("audit_logs_created_idx").on(t.createdAt),
  ],
);

export const oauthClients = pgTable("oauth_clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: text("client_id").notNull().unique(),
  clientSecretHash: text("client_secret_hash"),
  clientName: text("client_name"),
  redirectUris: jsonb("redirect_uris").$type<string[]>().notNull().default([]),
  grantTypes: jsonb("grant_types").$type<string[]>().notNull().default(["authorization_code", "refresh_token"]),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const oauthAuthCodes = pgTable(
  "oauth_auth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    codeHash: text("code_hash").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    codeChallengeMethod: text("code_challenge_method").notNull().default("S256"),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("oauth_auth_codes_hash_idx").on(t.codeHash)],
);

export const oauthAccessTokens = pgTable(
  "oauth_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("oauth_access_tokens_hash_idx").on(t.tokenHash)],
);

export const oauthRefreshTokens = pgTable(
  "oauth_refresh_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tokenHash: text("token_hash").notNull(),
    clientId: text("client_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revoked: boolean("revoked").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("oauth_refresh_tokens_hash_idx").on(t.tokenHash)],
);

export const webSessions = pgTable(
  "web_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionTokenHash: text("session_token_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** False until TOTP succeeds when the user has MFA enabled. */
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("web_sessions_hash_idx").on(t.sessionTokenHash)],
);

/** Personal access tokens for MCP (`Authorization: Bearer vmcp_…`). Only the hash is stored. */
export const apiTokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    /** e.g. read, write — PAT-only; OAuth uses workspace roles. */
    scopes: text("scopes").array().notNull().default(["read", "write"]),
    /** Null = never expires (legacy tokens). New tokens default to ~90 days in the service layer. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_idx").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

import { z } from "zod";
import { containsCtlChars } from "./security.js";

export const WorkspaceRole = z.enum(["owner", "admin", "member", "viewer"]);
export type WorkspaceRole = z.infer<typeof WorkspaceRole>;

export const SecretVisibility = z.enum(["private", "workspace"]);
export type SecretVisibility = z.infer<typeof SecretVisibility>;

export const UpstreamTransport = z.enum(["stdio", "http"]);
export type UpstreamTransport = z.infer<typeof UpstreamTransport>;

export const ROLE_RANK: Record<WorkspaceRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function roleAtLeast(role: WorkspaceRole, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Roles that can invoke upstream tools that require secret injection. */
export function canUseSecrets(role: WorkspaceRole): boolean {
  return roleAtLeast(role, "member");
}

export function canManageWorkspace(role: WorkspaceRole): boolean {
  return roleAtLeast(role, "admin");
}

export const SECRET_PLACEHOLDER = /\{\{secret:([A-Za-z0-9_/-]+)\}\}/g;

export function findSecretPlaceholders(template: string): string[] {
  const names = new Set<string>();
  const re = new RegExp(SECRET_PLACEHOLDER.source, SECRET_PLACEHOLDER.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    names.add(match[1]!);
  }
  return Array.from(names);
}

export function resolveSecretPlaceholders(
  template: string,
  secrets: Record<string, string>,
): string {
  return template.replace(SECRET_PLACEHOLDER, (_full, name: string) => {
    const value = secrets[name];
    if (value === undefined) {
      throw new Error(`Missing secret: ${name}`);
    }
    if (containsCtlChars(value) || containsCtlChars(name)) {
      throw new Error(`Secret ${name} contains control characters`);
    }
    return value;
  });
}

export function namespaceTool(serverSlug: string, toolName: string): string {
  return `${serverSlug}__${toolName}`;
}

export function parseNamespacedTool(
  namespaced: string,
): { serverSlug: string; toolName: string } | null {
  const idx = namespaced.indexOf("__");
  if (idx <= 0) return null;
  return {
    serverSlug: namespaced.slice(0, idx),
    toolName: namespaced.slice(idx + 2),
  };
}

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens"),
});

export const CreateSecretSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_/-]+$/, "invalid secret name"),
  value: z.string().min(1).max(64_000),
  visibility: SecretVisibility.default("private"),
  tags: z.array(z.string().max(64)).max(20).default([]),
});

export const UpdateSecretSchema = z.object({
  value: z.string().min(1).max(64_000).optional(),
  visibility: SecretVisibility.optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
});

export const CreateUpstreamSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  transport: UpstreamTransport,
  command: z.string().max(512).optional(),
  args: z.array(z.string().max(512)).max(50).optional(),
  url: z.string().url().optional(),
  envTemplate: z.record(z.string().max(8000)).default({}),
  headersTemplate: z.record(z.string().max(8000)).default({}),
  enabled: z.boolean().default(true),
});

export const InviteMemberSchema = z.object({
  githubLogin: z.string().min(1).max(64),
  role: z.enum(["admin", "member", "viewer"]).default("member"),
});

export const UpdateMemberRoleSchema = z.object({
  role: z.enum(["admin", "member", "viewer"]),
});

/**
 * Personal access token scopes (`vmcp_…`). OAuth sessions ignore these and use workspace roles.
 * - `read` / `write`: MCP gateway
 * - `env`: runtime env export via CLI (`GET /api/runtime/v1/env`) — opt-in, high risk
 */
export const ApiTokenScope = z.enum(["read", "write", "env"]);
export type ApiTokenScope = z.infer<typeof ApiTokenScope>;

export const DEFAULT_API_TOKEN_SCOPES: ApiTokenScope[] = ["read", "write"];
export const DEFAULT_API_TOKEN_EXPIRY_DAYS = 90;
/** Recommended expiry for laptop runtime-env tokens. */
export const DEFAULT_ENV_TOKEN_EXPIRY_DAYS = 30;

export function hasApiTokenScope(
  scopes: readonly string[] | null | undefined,
  needed: ApiTokenScope,
): boolean {
  if (!scopes || scopes.length === 0) return false;
  return scopes.includes(needed);
}

export const CreateApiTokenSchema = z
  .object({
    name: z.string().min(1).max(120).default("MCP token"),
    /**
     * Defaults to read+write (MCP) when omitted.
     * Env-only tokens (`["env"]`) are allowed for CLI laptop use.
     */
    scopes: z.array(ApiTokenScope).min(1).max(3).optional(),
    /** Days until expiry (1–365). Ignored when expiresAt is set. Default 90. */
    expiresInDays: z.number().int().min(1).max(365).optional(),
    /** Absolute expiry. Omit both expiresInDays and expiresAt to use the 90-day default. */
    expiresAt: z.string().datetime().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.scopes) {
      const unique = new Set(val.scopes);
      if (unique.size !== val.scopes.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scopes must be unique",
          path: ["scopes"],
        });
      }
      if (unique.has("write") && !unique.has("read")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "write scope requires read",
          path: ["scopes"],
        });
      }
      if (!unique.has("read") && !unique.has("env")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "scopes must include read and/or env",
          path: ["scopes"],
        });
      }
    }
  });

export const API_TOKEN_PREFIX = "vmcp_" as const;

/**
 * Key used in client MCP configs under `mcpServers`.
 * Cursor labels user-level entries as `user-<key>` in agent/tool logs (e.g. `user-vaultmcp`).
 * That is Cursor’s naming, not a different product — tools still hit this gateway.
 */
export const MCP_CLIENT_SERVER_KEY = "vaultmcp" as const;

export * from "./integrationTemplates.js";
export * from "./security.js";

export type IntegrationSecretSlot = {
  name: string;
  visibility: "private" | "workspace";
  hint: string;
};

export type IntegrationUpstreamTemplate = {
  name: string;
  slug: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  envTemplate: Record<string, string>;
};

export type IntegrationTemplate = {
  id: string;
  name: string;
  description: string;
  secrets: IntegrationSecretSlot[];
  upstream: IntegrationUpstreamTemplate | null;
  /** When true, card opens Advanced instead of a guided install. */
  custom?: boolean;
};

/** Catalog shared by web Integrations UI and MCP `list_templates` / `apply_integration`. */
export const INTEGRATION_TEMPLATES: IntegrationTemplate[] = [
  {
    id: "github",
    name: "GitHub",
    description: "Repo, issues, and PR tools via the official GitHub MCP server.",
    secrets: [
      {
        name: "GITHUB_TOKEN",
        visibility: "private",
        hint: "Personal access token with repo scope",
      },
    ],
    upstream: {
      name: "GitHub",
      slug: "github",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      envTemplate: {
        GITHUB_PERSONAL_ACCESS_TOKEN: "{{secret:GITHUB_TOKEN}}",
      },
    },
  },
  {
    id: "aws",
    name: "AWS",
    description: "Call AWS APIs through the awslabs MCP server. Keys stay in the vault.",
    secrets: [
      {
        name: "AWS_ACCESS_KEY_ID",
        visibility: "private",
        hint: "IAM access key ID",
      },
      {
        name: "AWS_SECRET_ACCESS_KEY",
        visibility: "private",
        hint: "IAM secret access key",
      },
      {
        name: "AWS_REGION",
        visibility: "workspace",
        hint: "e.g. us-east-1",
      },
    ],
    upstream: {
      name: "AWS",
      slug: "aws",
      transport: "stdio",
      command: "uvx",
      args: ["awslabs.aws-api-mcp-server@latest"],
      envTemplate: {
        AWS_ACCESS_KEY_ID: "{{secret:AWS_ACCESS_KEY_ID}}",
        AWS_SECRET_ACCESS_KEY: "{{secret:AWS_SECRET_ACCESS_KEY}}",
        AWS_REGION: "{{secret:AWS_REGION}}",
        FASTMCP_LOG_LEVEL: "ERROR",
      },
    },
  },
  {
    id: "custom",
    name: "Custom",
    description: "Register any stdio or HTTP MCP with free-form secret names and env maps.",
    secrets: [],
    upstream: null,
    custom: true,
  },
];

export type IntegrationStatus = "not_installed" | "needs_secrets" | "ready";

export function getIntegrationTemplate(id: string): IntegrationTemplate | undefined {
  return INTEGRATION_TEMPLATES.find((t) => t.id === id);
}

export function integrationStatus(
  template: IntegrationTemplate,
  secrets: Array<{ name: string }>,
  upstreams: Array<{ slug: string }>,
): IntegrationStatus {
  if (template.custom || !template.upstream) {
    return "not_installed";
  }

  const secretNames = template.secrets.map((s) => s.name);
  const missing = secretNames.filter((n) => !secrets.some((s) => s.name === n));
  const hasUpstream = upstreams.some((u) => u.slug === template.upstream!.slug);

  if (hasUpstream && missing.length === 0) return "ready";
  if (hasUpstream || missing.length < secretNames.length) return "needs_secrets";
  return "not_installed";
}

export function statusLabel(status: IntegrationStatus): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_secrets":
      return "Needs secrets";
    default:
      return "Not installed";
  }
}

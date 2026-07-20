/**
 * Re-export shared integration catalog so workspace UI and MCP gateway stay aligned.
 */
export {
  INTEGRATION_TEMPLATES,
  getIntegrationTemplate,
  integrationStatus,
  statusLabel,
  type IntegrationSecretSlot,
  type IntegrationStatus,
  type IntegrationTemplate,
  type IntegrationUpstreamTemplate,
} from "@vaultmcp/shared";

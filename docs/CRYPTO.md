# Envelope encryption

VaultMCP encrypts secret **values** with a two-layer key scheme.

```
VAULT_MASTER_KEY (KEK)
        │
        ▼ wrap (AES-GCM, AAD = dek:<workspaceId>)
workspaces.wrapped_dek  ──unwrap──►  workspace DEK
                                        │
                                        ▼ encrypt (AES-GCM, AAD = workspaceId)
                                 secrets.ciphertext  (crypto_version = 2)
```

| Layer | Role |
|-------|------|
| **KEK** | `VAULT_MASTER_KEY` env var — never stored in the DB |
| **DEK** | Random 32-byte key per workspace; only the wrapped form is stored |
| **AAD** | GCM associated data binds ciphertext to the workspace (and wraps to `dek:<id>`) so blobs cannot be swapped across rows |

## Versions

| `crypto_version` | Meaning |
|------------------|---------|
| `1` | Legacy: value encrypted directly with the KEK (pre-envelope) |
| `2` | Envelope: value encrypted with the workspace DEK |

`pnpm db:migrate` runs a backfill that mints missing DEKs and upgrades version `1` secrets to `2`.

## What is not encrypted

Secret **names**, tags, visibility, and audit metadata remain plaintext so the control plane can list and authorize without decrypting. Auth tokens are hashed (SHA-256), not encrypted.

## Dashboard MFA (TOTP)

Optional authenticator MFA protects the **web control plane** after GitHub OAuth. The TOTP secret is stored encrypted (same AES-GCM helpers as secrets, AAD-bound to the user id). MCP client OAuth and personal access tokens are separate from this gate.

## Source

- [`packages/shared/src/crypto.ts`](../packages/shared/src/crypto.ts)
- [`apps/api/src/services/workspace-keys.ts`](../apps/api/src/services/workspace-keys.ts)

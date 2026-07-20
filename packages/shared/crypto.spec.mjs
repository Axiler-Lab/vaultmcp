/**
 * Unit checks for envelope crypto (no DB).
 * Run: node --experimental-vm-modules packages/shared/crypto.spec.mjs
 * (requires packages/shared build first)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const {
  deriveMasterKey,
  encryptSecret,
  decryptSecret,
  generateDek,
  wrapDek,
  unwrapDek,
  encryptWithDek,
  decryptWithDek,
  CRYPTO_VERSION_ENVELOPE,
} = await import(path.join(here, "dist/crypto.js"));

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const kek = deriveMasterKey("test-master-key-please-change");
const workspaceId = "11111111-1111-1111-1111-111111111111";
const otherWs = "22222222-2222-2222-2222-222222222222";

const dek = generateDek();
const wrapped = wrapDek(dek, kek, workspaceId);
assert(unwrapDek(wrapped, kek, workspaceId).equals(dek), "unwrap roundtrip");

let failed = false;
try {
  unwrapDek(wrapped, kek, otherWs);
  failed = true;
} catch {
  /* expected */
}
assert(!failed, "unwrap must fail with wrong workspace AAD");

const plain = "super-secret-value";
const ct = encryptWithDek(plain, dek, workspaceId);
assert(decryptWithDek(ct, dek, workspaceId) === plain, "dek encrypt roundtrip");
assert(CRYPTO_VERSION_ENVELOPE === 2, "version constant");

failed = false;
try {
  decryptWithDek(ct, dek, otherWs);
  failed = true;
} catch {
  /* expected */
}
assert(!failed, "decrypt must fail when AAD workspace mismatches");

const legacy = encryptSecret("legacy-plain", kek);
assert(decryptSecret(legacy, kek) === "legacy-plain", "legacy roundtrip without AAD");

console.log("crypto.spec: ok");

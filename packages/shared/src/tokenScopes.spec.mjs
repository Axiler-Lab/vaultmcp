/**
 * Lightweight verification for ApiTokenScope / CreateApiTokenSchema (run after build):
 *   node packages/shared/src/tokenScopes.spec.mjs
 */
import assert from "node:assert/strict";
import {
  CreateApiTokenSchema,
  hasApiTokenScope,
} from "../dist/index.js";

function ok(scopes) {
  return CreateApiTokenSchema.safeParse({ name: "t", scopes });
}

assert.equal(ok(["read"]).success, true);
assert.equal(ok(["read", "write"]).success, true);
assert.equal(ok(["env"]).success, true);
assert.equal(ok(["read", "env"]).success, true);
assert.equal(ok(["write"]).success, false, "write without read");
assert.equal(ok(["write", "env"]).success, false, "write without read");
assert.equal(ok([]).success, false);

assert.equal(hasApiTokenScope(["env"], "env"), true);
assert.equal(hasApiTokenScope(["read"], "env"), false);
assert.equal(hasApiTokenScope(["read", "write"], "write"), true);

console.log("tokenScopes.spec.mjs: ok");

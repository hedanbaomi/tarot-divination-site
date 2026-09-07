import assert from "node:assert/strict";
import test from "node:test";

import { resolveAdminTarget } from "../tools/check-admin-page.mjs";

test("admin check defaults to the isolated loopback fixture", () => {
  assert.deepEqual(resolveAdminTarget([]), {
    adminUrl: "http://127.0.0.1:8787/admin",
    remote: false
  });
});

test("loopback targets need an explicit --url but no remote permission", () => {
  assert.deepEqual(resolveAdminTarget(["--url", "http://localhost:9000"]), {
    adminUrl: "http://localhost:9000/admin",
    remote: false
  });
});

test("a positional URL cannot silently select production", () => {
  assert.throws(
    () => resolveAdminTarget(["https://telemetry.luotianyi.fun"]),
    /unknown_argument/
  );
});

test("a remote URL requires the explicit remote-check flag", () => {
  assert.throws(
    () => resolveAdminTarget(["--url", "https://telemetry.luotianyi.fun"]),
    /remote_check_requires_allow_flag/
  );
  assert.deepEqual(resolveAdminTarget([
    "--url", "https://telemetry.luotianyi.fun",
    "--allow-remote-check"
  ]), {
    adminUrl: "https://telemetry.luotianyi.fun/admin",
    remote: true
  });
});

test("remote checks reject HTTP and URL credentials", () => {
  assert.throws(
    () => resolveAdminTarget([
      "--url", "http://example.com",
      "--allow-remote-check"
    ]),
    /remote_check_requires_https/
  );
  assert.throws(
    () => resolveAdminTarget([
      "--url", "https://user:pass@example.com",
      "--allow-remote-check"
    ]),
    /url_credentials_forbidden/
  );
});

test("the remote flag alone cannot change the default target", () => {
  assert.throws(
    () => resolveAdminTarget(["--allow-remote-check"]),
    /remote_check_requires_explicit_url/
  );
});

// Checks an admin page response, security headers, and inline script syntax.
// The default target is the isolated iOS fixture on loopback. A remote target
// requires both an explicit --url and --allow-remote-check.

import vm from "node:vm";
import { pathToFileURL } from "node:url";

const DEFAULT_LOCAL_BASE_URL = "http://127.0.0.1:8787";

export function resolveAdminTarget(args = []) {
  let baseUrl = null;
  let allowRemote = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") {
      if (baseUrl !== null) throw new Error("duplicate_url");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("missing_url");
      baseUrl = value;
      index += 1;
      continue;
    }
    if (arg === "--allow-remote-check") {
      allowRemote = true;
      continue;
    }
    throw new Error("unknown_argument:" + arg);
  }

  if (allowRemote && baseUrl === null) {
    throw new Error("remote_check_requires_explicit_url");
  }

  let parsed;
  try {
    parsed = new URL(baseUrl || DEFAULT_LOCAL_BASE_URL);
  } catch (_error) {
    throw new Error("invalid_url");
  }
  if (parsed.username || parsed.password) throw new Error("url_credentials_forbidden");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_url_protocol");
  }

  const loopback = parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "localhost" || parsed.hostname === "[::1]";
  if (!loopback && !allowRemote) throw new Error("remote_check_requires_allow_flag");
  if (!loopback && parsed.protocol !== "https:") throw new Error("remote_check_requires_https");

  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/$/, "") + "/admin";
  return { adminUrl: parsed.toString(), remote: !loopback };
}

export async function checkAdminPage(args = []) {
  const { adminUrl } = resolveAdminTarget(args);
  const response = await fetch(adminUrl);
  if (response.status !== 200) {
    throw new Error(`GET ${adminUrl} returned ${response.status}`);
  }

  const headers = {
    "cache-control": response.headers.get("cache-control"),
    "content-security-policy": response.headers.get("content-security-policy"),
    "x-content-type-options": response.headers.get("x-content-type-options"),
    "referrer-policy": response.headers.get("referrer-policy")
  };
  for (const [name, value] of Object.entries(headers)) {
    if (!value) throw new Error(`missing security header ${name}`);
  }

  const html = await response.text();
  const match = /<script>([\s\S]*?)<\/script>/.exec(html);
  if (!match) throw new Error("no inline <script> found in admin page");
  try {
    new vm.Script(match[1]);
  } catch (error) {
    throw new Error(`inline admin script does not parse: ${error.message}`);
  }

  return `OK: ${adminUrl} 200, security headers present, inline script parses`;
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  try {
    console.log(await checkAdminPage(process.argv.slice(2)));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}

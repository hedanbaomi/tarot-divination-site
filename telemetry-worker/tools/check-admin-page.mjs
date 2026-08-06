// Live check for the deployed admin page: fetches the public /admin HTML,
// extracts the inline <script>, and parses it with node:vm. Exits non-zero
// if the page is unreachable, the script is missing, or it fails to compile.
//
// Usage: node tools/check-admin-page.mjs [base-url]
//   base-url defaults to https://telemetry.luotianyi.fun

import vm from "node:vm";

const baseUrl = process.argv[2] || "https://telemetry.luotianyi.fun";
const adminUrl = baseUrl.replace(/\/$/, "") + "/admin";

const response = await fetch(adminUrl);
if (response.status !== 200) {
  console.error(`FAIL: GET ${adminUrl} returned ${response.status}`);
  process.exit(1);
}

const headers = {
  "cache-control": response.headers.get("cache-control"),
  "content-security-policy": response.headers.get("content-security-policy"),
  "x-content-type-options": response.headers.get("x-content-type-options"),
  "referrer-policy": response.headers.get("referrer-policy")
};
for (const [name, value] of Object.entries(headers)) {
  if (!value) {
    console.error(`FAIL: missing security header ${name}`);
    process.exit(1);
  }
}

const html = await response.text();
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!match) {
  console.error("FAIL: no inline <script> found in admin page");
  process.exit(1);
}

try {
  new vm.Script(match[1]);
} catch (error) {
  console.error(`FAIL: inline admin script does not parse: ${error.message}`);
  process.exit(1);
}

console.log(`OK: ${adminUrl} 200, security headers present, inline script parses`);

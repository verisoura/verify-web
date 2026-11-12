// Checks the CDN build artifact and its SRI hash (npm test builds first).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const iifeUrl = new URL("../dist/verify.iife.js", import.meta.url);
const sriUrl = new URL("../dist/verify.iife.js.sri", import.meta.url);

test("dist/verify.iife.js exists, is non-trivial and exposes the global", () => {
  const js = readFileSync(iifeUrl, "utf8");
  assert.ok(js.length > 1000, "bundle looks too small");
  assert.ok(js.includes("VerisouraVerify"), "global name missing");
  assert.ok(js.includes("verisoura-verify"), "bridge source constant missing");
});

test("the printed SRI hash matches the artifact", () => {
  const sri = readFileSync(sriUrl, "utf8").trim();
  assert.match(sri, /^sha384-[A-Za-z0-9+/]+={0,2}$/);
  const bytes = readFileSync(iifeUrl);
  const expected = "sha384-" + createHash("sha384").update(bytes).digest("base64");
  assert.equal(sri, expected);
});

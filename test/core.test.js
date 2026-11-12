// Pure-logic tests for the bridge protocol, outcome mapping and URL
// building. These run against the built ESM output in dist/.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  BRIDGE_SOURCE,
  BRIDGE_VERSION,
  DEFAULT_PAGE_ORIGIN,
  SDK_NAME,
  SDK_VERSION,
  buildInitMessage,
  buildPopupUrl,
  deriveOrigin,
  errorFromMessage,
  eventFromMessage,
  isCameraFailure,
  outcomeFromMessage,
  parseBridgeMessage,
  resolvePageUrl,
  tokenVerificationId,
} from "../dist/core.js";

const ORIGIN = "https://verify.verisoura.com";
const TOKEN = "vct_AbCdEfGhIjKlMnOpQrSt12_s3cr3ts3cr3ts3cr3ts3cr3t";

function msg(extra) {
  return { source: BRIDGE_SOURCE, bridge: BRIDGE_VERSION, ...extra };
}

test("constants match the contract exactly", () => {
  assert.equal(BRIDGE_SOURCE, "verisoura-verify");
  assert.equal(BRIDGE_VERSION, 1);
  assert.equal(DEFAULT_PAGE_ORIGIN, "https://verify.verisoura.com");
  assert.equal(SDK_NAME, "@verisoura/verify");
});

test("SDK_VERSION matches package.json", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8")
  );
  assert.equal(SDK_VERSION, pkg.version);
});

// --- message validation -------------------------------------------------

test("accepts a valid message from the exact origin", () => {
  const m = parseBridgeMessage(msg({ type: "ready", page_version: "1.0" }), ORIGIN, ORIGIN);
  assert.ok(m);
  assert.equal(m.type, "ready");
});

test("rejects any other origin, including sub/superstrings", () => {
  const data = msg({ type: "ready" });
  assert.equal(parseBridgeMessage(data, "https://evil.example", ORIGIN), null);
  assert.equal(parseBridgeMessage(data, "https://verify.verisoura.com.evil.example", ORIGIN), null);
  assert.equal(parseBridgeMessage(data, "http://verify.verisoura.com", ORIGIN), null);
  assert.equal(parseBridgeMessage(data, "null", ORIGIN), null);
});

test("rejects a missing or wrong source", () => {
  assert.equal(parseBridgeMessage({ bridge: 1, type: "ready" }, ORIGIN, ORIGIN), null);
  assert.equal(
    parseBridgeMessage({ source: "someone-else", bridge: 1, type: "ready" }, ORIGIN, ORIGIN),
    null
  );
});

test("rejects a wrong bridge version (strict number 1)", () => {
  assert.equal(parseBridgeMessage(msg({ bridge: 2, type: "ready" }), ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage(msg({ bridge: "1", type: "ready" }), ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage({ source: BRIDGE_SOURCE, type: "ready" }, ORIGIN, ORIGIN), null);
});

test("rejects non-object data and a non-string type", () => {
  assert.equal(parseBridgeMessage(null, ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage("completed", ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage([1, 2], ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage(msg({ type: 7 }), ORIGIN, ORIGIN), null);
  assert.equal(parseBridgeMessage(msg({}), ORIGIN, ORIGIN), null);
});

test("unknown types and extra fields pass validation (additive protocol)", () => {
  const m = parseBridgeMessage(
    msg({ type: "future_thing", some_new_field: { nested: true } }),
    ORIGIN,
    ORIGIN
  );
  assert.ok(m);
  assert.equal(m.type, "future_thing");
  // ...but map to no outcome and no event:
  assert.equal(outcomeFromMessage(m), null);
  assert.equal(eventFromMessage(m), null);
});

// --- outcome mapping ----------------------------------------------------

test("completed maps to the completed outcome", () => {
  const o = outcomeFromMessage(msg({ type: "completed", verification_id: "ver_x" }));
  assert.deepEqual(o, { status: "completed", verificationId: "ver_x" });
});

test("cancelled maps to the cancelled outcome", () => {
  assert.deepEqual(outcomeFromMessage(msg({ type: "cancelled" })), { status: "cancelled" });
});

test("error maps to failed, preserving an open-set code", () => {
  const o = outcomeFromMessage(
    msg({ type: "error", code: "some_future_code", message: "Nope", retryable: true })
  );
  assert.deepEqual(o, {
    status: "failed",
    error: { code: "some_future_code", message: "Nope", retryable: true },
  });
});

test("error tolerates missing fields: default message, retryable false", () => {
  const e = errorFromMessage(msg({ type: "error", code: "token_invalid" }));
  assert.equal(e.code, "token_invalid");
  assert.equal(e.retryable, false);
  assert.ok(e.message.length > 0);
  const e2 = errorFromMessage(msg({ type: "error", retryable: "yes" }));
  assert.equal(e2.code, "unknown_error");
  assert.equal(e2.retryable, false);
});

test("event messages map to events, copying only documented fields", () => {
  const ev = eventFromMessage(
    msg({ type: "event", name: "step_result", step: 2, passed: true, reason: null, surprise: "x" })
  );
  assert.deepEqual(ev, { name: "step_result", step: 2, passed: true });
  assert.equal(eventFromMessage(msg({ type: "event" })), null);
});

// --- popup fallback detection -------------------------------------------

test("camera failures are detected for fallback", () => {
  assert.equal(isCameraFailure(msg({ type: "event", name: "camera_error" })), true);
  assert.equal(isCameraFailure(msg({ type: "event", name: "camera_ready" })), false);
  assert.equal(isCameraFailure(msg({ type: "error", code: "camera_permission_denied" })), true);
  assert.equal(isCameraFailure(msg({ type: "error", code: "token_invalid" })), false);
  assert.equal(isCameraFailure(msg({ type: "completed" })), false);
});

// --- init message -------------------------------------------------------

test("init message carries source, bridge, token and sdk exactly", () => {
  const m = buildInitMessage({ clientToken: TOKEN });
  assert.deepEqual(m, {
    source: "verisoura-verify",
    bridge: 1,
    type: "init",
    client_token: TOKEN,
    sdk: { name: "@verisoura/verify", version: SDK_VERSION },
  });
});

test("init message includes locale and appearance only when given", () => {
  const m = buildInitMessage({ clientToken: TOKEN, locale: "ar", appearance: {} });
  assert.equal(m.locale, "ar");
  assert.deepEqual(m.appearance, { colorScheme: "auto" });
  const m2 = buildInitMessage({ clientToken: TOKEN, appearance: { colorScheme: "dark" } });
  assert.equal("locale" in m2, false);
  assert.deepEqual(m2.appearance, { colorScheme: "dark" });
});

// --- URLs and the fragment rule -----------------------------------------

test("tokenVerificationId derives ver_ id from a well-formed token", () => {
  assert.equal(tokenVerificationId(TOKEN), "ver_AbCdEfGhIjKlMnOpQrSt12");
  assert.equal(tokenVerificationId("vct_short"), null);
  assert.equal(tokenVerificationId("api_AbCdEfGhIjKlMnOpQrSt12_s"), null);
  assert.equal(tokenVerificationId("vct_AbCdEfGhIjKlMnOpQrSt12noUnderscore"), null);
});

test("resolvePageUrl strips any fragment from a provided url", () => {
  const u = resolvePageUrl(TOKEN, `https://verify.verisoura.com/v/ver_x#${TOKEN}`);
  assert.equal(u, "https://verify.verisoura.com/v/ver_x");
  assert.equal(u.includes("vct_"), false);
});

test("resolvePageUrl derives the production url from the token", () => {
  assert.equal(
    resolvePageUrl(TOKEN),
    "https://verify.verisoura.com/v/ver_AbCdEfGhIjKlMnOpQrSt12"
  );
});

test("resolvePageUrl throws on a malformed token with no url", () => {
  assert.throws(() => resolvePageUrl("not-a-token"));
});

test("popup url carries the token ONLY in the fragment", () => {
  const u = buildPopupUrl("https://verify.verisoura.com/v/ver_x", TOKEN);
  assert.equal(u, `https://verify.verisoura.com/v/ver_x#${TOKEN}`);
  const [beforeHash] = u.split("#");
  assert.equal(beforeHash.includes("vct_"), false);
});

test("popup url replaces an existing fragment", () => {
  const u = buildPopupUrl("https://verify.verisoura.com/v/ver_x#old", TOKEN);
  assert.equal(u, `https://verify.verisoura.com/v/ver_x#${TOKEN}`);
});

test("deriveOrigin gives the exact targetOrigin", () => {
  assert.equal(deriveOrigin("https://verify.verisoura.com/v/ver_x?a=1#f"), ORIGIN);
  assert.equal(deriveOrigin("http://localhost:5173/v/ver_x"), "http://localhost:5173");
});

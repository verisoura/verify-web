// happy-dom smoke test of the <verisoura-verify> custom element.
// The pure protocol logic is covered in core.test.js without a DOM;
// this only checks that the element mounts an iframe correctly.
import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const TOKEN = "vct_AbCdEfGhIjKlMnOpQrSt12_s3cr3ts3cr3ts3cr3ts3cr3t";

test("custom element mounts an iframe with allow=camera and no token in the URL", async () => {
  const w = new Window({ url: "https://host.example/" });
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.customElements = w.customElements;
  globalThis.HTMLElement = w.HTMLElement;
  globalThis.CustomEvent = w.CustomEvent;

  const mod = await import("../dist/index.js");
  mod.defineElement();
  assert.ok(w.customElements.get("verisoura-verify"), "element not registered");

  const el = w.document.createElement("verisoura-verify");
  el.setAttribute("client-token", TOKEN);
  el.setAttribute("locale", "ar");
  w.document.body.appendChild(el);

  const iframe = el.querySelector("iframe");
  assert.ok(iframe, "no iframe mounted");
  assert.equal(iframe.getAttribute("allow"), "camera");
  const src = iframe.getAttribute("src");
  assert.equal(src, "https://verify.verisoura.com/v/ver_AbCdEfGhIjKlMnOpQrSt12");
  assert.equal(src.includes("vct_"), false, "token must never be in the iframe URL");

  // Styles were injected once.
  assert.ok(w.document.getElementById("verisoura-verify-styles"));

  // Disconnecting disposes silently (no throw, no stray cancel event).
  let cancelFired = false;
  el.addEventListener("verisoura-cancel", () => {
    cancelFired = true;
  });
  el.remove();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelFired, false);

  await w.happyDOM.close();
});

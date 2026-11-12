# @verisoura/verify

Web plugin for [VeriSoura Verify](https://docs.verisoura.com), an eKYC
service. It opens the hosted verification page (camera capture, liveness
challenges, document upload) in a modal, an inline frame, or a popup, and
returns exactly one of three outcomes. The plugin itself never touches the
camera, holds no secrets, makes no network calls of its own, and sends no
telemetry.

- ESM with TypeScript types, **zero runtime dependencies**
- An IIFE build for CDN use, with an SRI hash printed by the build
- Node >= 18 to build and test; the output targets current evergreen
  browsers and Safari 15.4+

Status: **0.1.0-dev, unreleased**. The client API and bridge protocol are
at v1 while Active eKYC is in Beta.

## The one rule that matters

**The browser is untrusted.** The outcome this plugin returns - including
`verificationId` - is for display and diagnostics only. Your backend must
act only on its own trusted channel: the signed webhook, or
`GET /v1/verifications/{id}`, looked up by the id **it stored when it
created the verification**. Never act on an id reported by the client.

## Quickstart (about 15 minutes)

### 1. Backend: create a verification (2 min)

Your server (never the browser) holds the API key and creates a
verification:

```bash
curl -X POST https://app.verisoura.com/v1/verifications \
  -H "X-API-Key: $VERISOURA_API_KEY" \
  -H "Idempotency-Key: 6a1f-your-unique-key" \
  -H "Content-Type: application/json" \
  -d '{"flow":"active","reference_id":"user_8812","locale":"en",
       "web_origins":["https://shop.example"]}'
```

The `201` response contains `id` (store it - you will look the result up
by it), a single-use `client_token`, and `url`. Hand the browser only the
`client_token` and `url`.

### 2. Frontend: open the flow (5 min)

```bash
npm install @verisoura/verify
```

```ts
import { open } from "@verisoura/verify";

const flow = open({
  clientToken,            // from your backend's create call
  url,                    // the url from the create response (recommended)
  locale: "en",           // or "ar"
  appearance: { colorScheme: "auto" },
  onEvent: (e) => console.log(e.name),  // progress only: no images, no scores
});

const outcome = await flow.result;  // never rejects
switch (outcome.status) {
  case "completed":  // outcome.verificationId - display only!
  case "cancelled":
  case "failed":     // outcome.error = {code, message, retryable}
}
```

`flow.close()` cancels and resolves the promise with
`{status: "cancelled"}`.

Or declaratively, with the custom element (see `examples/react.md` for
React 19):

```html
<verisoura-verify client-token="vct_..." locale="en"></verisoura-verify>
<script type="module">
  import "@verisoura/verify";
  document.querySelector("verisoura-verify")
    .addEventListener("verisoura-complete", (e) => {
      // e.detail.verificationId - display only; the backend decides
    });
  // also: "verisoura-cancel", "verisoura-error", "verisoura-event"
</script>
```

Or inline into your own container: `mount("#kyc-slot", { clientToken })`.

Or from a CDN without a bundler (the build prints the `integrity` value):

```html
<script src="https://sdk.verisoura.com/web/<version>/verify.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<script>
  VerisouraVerify.open({ clientToken }).result.then(handleOutcome);
</script>
```

### 3. Backend: act on the result (5 min)

Handle the signed `verification.completed` webhook, or poll
`GET /v1/verifications/{id}` with the id you stored in step 1. That
response carries the decision and scores; the browser never sees them.

### 4. Try it locally (3 min)

```bash
npm ci && npm test        # builds dist/ and runs the suite
open examples/vanilla.html
```

`examples/iframe-camera-test.html` is a standalone page for checking
camera behaviour inside iframes on real phones.

## The three outcomes

```ts
type Outcome =
  | { status: "completed"; verificationId: string }  // display only
  | { status: "cancelled" }
  | { status: "failed"; error: { code: string; message: string; retryable: boolean } };
```

`error.code` is an **open set** (for example `token_invalid`,
`verification_expired`, `rate_limited`, `camera_permission_denied`).
Branch on the codes you know and fall back on `retryable`; unknown codes
are non-retryable unless `retryable` is `true`.

## How it works

- The plugin renders an `<iframe allow="camera">` pointing at the hosted
  page origin (default `https://verify.verisoura.com`; override with
  `url` for testing). The URL never carries the token in iframe mode.
- It waits for the page's `{type: "ready"}` message, then posts
  `{type: "init", client_token, sdk}` with an **exact** `targetOrigin`.
- Every incoming message is ignored unless its `event.origin` matches
  that origin, `data.source === "verisoura-verify"`, and
  `data.bridge === 1`. Unknown message types and fields are ignored
  (the protocol is additive).
- If the embedded page cannot use the camera (a `camera_error` event or a
  `camera_*` error), the plugin automatically retries in a popup. There
  the token travels only in the URL fragment, which the page removes on
  load. If the popup is blocked, the user gets an explicit button (a
  user gesture, so blockers allow it) and a cancel path.
- Styling is minimal, self-contained and `prefers-color-scheme` aware;
  no external CSS, fonts, scripts, analytics or telemetry. The only
  client identification is the `X-VeriSoura-Client` header the hosted
  page derives from the `sdk` field of `init`.

## If your site sets security headers

- CSP: allow `frame-src https://verify.verisoura.com` (and
  `https://verify.verisoura.com` in `child-src` if you use it).
- `Permissions-Policy`: if you restrict `camera`, include
  `camera=(self "https://verify.verisoura.com")`.

## API

| Export | Purpose |
|---|---|
| `open(options): {result, close}` | Modal over the current page |
| `mount(target, options): {result, close}` | Inline, follows the page's resize messages |
| `<verisoura-verify client-token url locale color-scheme>` | Custom element; fires `verisoura-complete` / `verisoura-cancel` / `verisoura-error` / `verisoura-event` |
| `defineElement(tag?)` | Manual element registration (auto-registered in browsers on import) |

Options: `clientToken` (required), `url?`, `locale?`,
`appearance?: {colorScheme: "light"|"dark"|"auto"}`, `onEvent?`.

The pure protocol helpers (`parseBridgeMessage`, `outcomeFromMessage`,
`buildPopupUrl`, ...) are exported too, mainly for tests and advanced
integrations.

## Development

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run build       # ESM + d.ts to dist/, then the IIFE with its SRI hash
npm test            # build + node --test (includes a happy-dom element smoke test)
```

`dist/` is not committed; CI builds it. English only in code and docs:
the hosted page owns end-user localisation (English and Arabic,
right-to-left included).

## License

Apache-2.0. Copyright 2026 VeriSoura.

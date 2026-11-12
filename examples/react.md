# Using `<verisoura-verify>` from React 19

React 19 supports custom elements fully (unknown props become attributes),
so no wrapper component ships with this package. Custom DOM events still
need an explicit `addEventListener`, which a `ref` callback handles cleanly.

```bash
npm install @verisoura/verify
```

```jsx
import { useCallback } from "react";
import "@verisoura/verify"; // registers <verisoura-verify>

export function VerifyStep({ clientToken, onDone }) {
  // Ref callbacks may return a cleanup function in React 19.
  const ref = useCallback((el) => {
    if (!el) return;

    const onComplete = (e) => {
      // e.detail.verificationId is DISPLAY ONLY. Tell your backend the
      // user finished; it must confirm via its webhook or
      // GET /v1/verifications/{id}, looked up by the id IT stored at
      // create time - never by an id reported from the browser.
      onDone({ kind: "completed" });
    };
    const onCancel = () => onDone({ kind: "cancelled" });
    const onError = (e) => {
      // e.detail = { code, message, retryable }. `code` is an open set:
      // branch on the codes you know and fall back on `retryable`.
      onDone({ kind: "failed", error: e.detail });
    };

    el.addEventListener("verisoura-complete", onComplete);
    el.addEventListener("verisoura-cancel", onCancel);
    el.addEventListener("verisoura-error", onError);
    return () => {
      el.removeEventListener("verisoura-complete", onComplete);
      el.removeEventListener("verisoura-cancel", onCancel);
      el.removeEventListener("verisoura-error", onError);
    };
  }, [onDone]);

  return (
    <verisoura-verify
      ref={ref}
      client-token={clientToken}
      locale="ar"
      color-scheme="auto"
    />
  );
}
```

Notes:

- Attributes are kebab-case strings: `client-token`, `url`, `locale`,
  `color-scheme` (`light` | `dark` | `auto`).
- The element mounts the verification inline when it connects and cleans
  up when it unmounts. Give `clientToken` a stable value; a token is
  single-use, so fetch a fresh one from your backend for each attempt.
- Prefer the imperative API in modals or flows you control yourself:

```jsx
import { open } from "@verisoura/verify";

async function startVerification(clientToken) {
  const { result } = open({ clientToken, locale: "en" });
  const outcome = await result; // completed | cancelled | failed - never rejects
  return outcome;               // display only; the backend decides
}
```

- If you render the element inside a server-rendered page, importing the
  package on the server is safe: registration is skipped outside browsers.

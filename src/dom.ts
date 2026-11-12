/**
 * DOM layer: the modal (open), inline mount (mount), the iframe
 * lifecycle, and the popup fallback. All protocol decisions live in
 * core.ts so they stay testable without a browser.
 */
import {
  buildInitMessage,
  buildPopupUrl,
  deriveOrigin,
  eventFromMessage,
  isCameraFailure,
  outcomeFromMessage,
  parseBridgeMessage,
  resolvePageUrl,
  type OpenOptions,
  type Outcome,
  type VerifyFlow,
} from "./core.js";

const STYLE_ID = "verisoura-verify-styles";

// Minimal, self-contained, prefers-color-scheme aware. No external CSS.
const CSS = `
.vsv-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(10,13,18,.55);
--vsv-bg:#ffffff;--vsv-fg:#141a24;--vsv-muted:#5a6475;--vsv-border:#d9dee7;--vsv-accent:#2552cc;--vsv-accent-fg:#ffffff;}
@media (prefers-color-scheme:dark){.vsv-overlay{--vsv-bg:#171b23;--vsv-fg:#edf0f5;--vsv-muted:#9aa4b5;--vsv-border:#333a46;--vsv-accent:#7aa2ff;--vsv-accent-fg:#0d1320;}}
.vsv-overlay.vsv-light{--vsv-bg:#ffffff;--vsv-fg:#141a24;--vsv-muted:#5a6475;--vsv-border:#d9dee7;--vsv-accent:#2552cc;--vsv-accent-fg:#ffffff;}
.vsv-overlay.vsv-dark{--vsv-bg:#171b23;--vsv-fg:#edf0f5;--vsv-muted:#9aa4b5;--vsv-border:#333a46;--vsv-accent:#7aa2ff;--vsv-accent-fg:#0d1320;}
.vsv-modal{position:relative;width:min(420px,calc(100vw - 32px));height:min(720px,calc(100vh - 32px));background:var(--vsv-bg);color:var(--vsv-fg);
border-radius:12px;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.35);font:15px/1.5 system-ui,sans-serif;}
.vsv-close{position:absolute;top:8px;inset-inline-end:8px;z-index:2;width:32px;height:32px;border:0;border-radius:16px;cursor:pointer;
background:var(--vsv-bg);color:var(--vsv-muted);font-size:20px;line-height:1;box-shadow:0 0 0 1px var(--vsv-border);}
.vsv-close:hover{color:var(--vsv-fg);}
.vsv-frame{border:0;display:block;flex:1;width:100%;height:100%;background:var(--vsv-bg);}
.vsv-inline{position:relative;
--vsv-bg:#ffffff;--vsv-fg:#141a24;--vsv-muted:#5a6475;--vsv-border:#d9dee7;--vsv-accent:#2552cc;--vsv-accent-fg:#ffffff;
background:var(--vsv-bg);color:var(--vsv-fg);font:15px/1.5 system-ui,sans-serif;}
@media (prefers-color-scheme:dark){.vsv-inline{--vsv-bg:#171b23;--vsv-fg:#edf0f5;--vsv-muted:#9aa4b5;--vsv-border:#333a46;--vsv-accent:#7aa2ff;--vsv-accent-fg:#0d1320;}}
.vsv-inline.vsv-light{--vsv-bg:#ffffff;--vsv-fg:#141a24;--vsv-muted:#5a6475;--vsv-border:#d9dee7;--vsv-accent:#2552cc;--vsv-accent-fg:#ffffff;}
.vsv-inline.vsv-dark{--vsv-bg:#171b23;--vsv-fg:#edf0f5;--vsv-muted:#9aa4b5;--vsv-border:#333a46;--vsv-accent:#7aa2ff;--vsv-accent-fg:#0d1320;}
.vsv-inline .vsv-frame{height:600px;}
.vsv-notice{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;flex:1;min-height:200px;}
.vsv-notice p{margin:0;max-width:32ch;}
.vsv-notice .vsv-sub{color:var(--vsv-muted);font-size:13px;}
.vsv-btn{border:1px solid var(--vsv-border);border-radius:8px;background:var(--vsv-bg);color:var(--vsv-fg);padding:10px 18px;font:inherit;cursor:pointer;}
.vsv-btn-primary{background:var(--vsv-accent);border-color:var(--vsv-accent);color:var(--vsv-accent-fg);}
`;

function assertBrowser(): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("@verisoura/verify only runs in a browser.");
  }
}

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

function applyScheme(el: HTMLElement, options: OpenOptions): void {
  const scheme = options.appearance?.colorScheme;
  if (scheme === "light") el.classList.add("vsv-light");
  if (scheme === "dark") el.classList.add("vsv-dark");
}

interface FlowConfig {
  options: OpenOptions;
  pageUrl: string;
  origin: string;
  /** The element the iframe (and any notice panel) lives in. */
  frameParent: HTMLElement;
  mode: "modal" | "inline";
  onCleanup: () => void;
}

function runFlow(cfg: FlowConfig): VerifyFlow {
  let settled = false;
  let resolveOutcome!: (o: Outcome) => void;
  const result = new Promise<Outcome>((resolve) => {
    resolveOutcome = resolve;
  });

  let iframe: HTMLIFrameElement | null = null;
  let popup: Window | null = null;
  let popupPoll: ReturnType<typeof setInterval> | undefined;
  let fallbackStarted = false;
  let notice: HTMLElement | null = null;

  function createIframe(): void {
    const f = document.createElement("iframe");
    f.className = "vsv-frame";
    // Delegate camera access to the hosted page's origin.
    f.setAttribute("allow", "camera");
    f.setAttribute("title", "VeriSoura identity verification");
    // No token in the iframe URL: it travels only over postMessage,
    // after the page's "ready", with an exact targetOrigin.
    f.src = cfg.pageUrl;
    cfg.frameParent.appendChild(f);
    iframe = f;
  }

  function removeIframe(): void {
    if (iframe) {
      iframe.remove();
      iframe = null;
    }
  }

  function removeNotice(): void {
    if (notice) {
      notice.remove();
      notice = null;
    }
  }

  function cleanup(): void {
    window.removeEventListener("message", onMessage);
    if (popupPoll !== undefined) clearInterval(popupPoll);
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        /* cross-origin close can throw; nothing to do */
      }
    }
    popup = null;
    removeIframe();
    removeNotice();
    cfg.onCleanup();
  }

  function settle(outcome: Outcome): void {
    if (settled) return;
    settled = true;
    cleanup();
    resolveOutcome(outcome);
  }

  function isExpectedSource(source: MessageEventSource | null): boolean {
    if (popup && source === popup) return true;
    if (iframe && source === iframe.contentWindow) return true;
    return false;
  }

  function onMessage(e: MessageEvent): void {
    if (settled) return;
    const msg = parseBridgeMessage(e.data, e.origin, cfg.origin);
    if (!msg) return;
    if (!isExpectedSource(e.source)) return;

    if (msg.type === "ready") {
      // The page is listening: hand over the token with an EXACT targetOrigin.
      (e.source as Window).postMessage(buildInitMessage(cfg.options), cfg.origin);
      return;
    }
    if (msg.type === "event") {
      const ev = eventFromMessage(msg);
      if (ev && cfg.options.onEvent) {
        try {
          cfg.options.onEvent(ev);
        } catch {
          /* a host callback error must not break the flow */
        }
      }
      if (ev && isCameraFailure(msg)) startPopupFallback();
      return;
    }
    if (msg.type === "resize") {
      if (cfg.mode === "inline" && iframe && typeof msg.height === "number") {
        const h = Math.round(msg.height);
        if (h > 0 && h < 10000) iframe.style.height = `${h}px`;
      }
      return;
    }
    if (msg.type === "error" && isCameraFailure(msg) && !popup && !fallbackStarted) {
      // The embedded page cannot reach the camera: retry in a popup
      // instead of failing. A camera error from the popup itself falls
      // through and settles as a failed outcome.
      startPopupFallback();
      return;
    }
    const outcome = outcomeFromMessage(msg);
    if (outcome) settle(outcome);
    // Unknown types: ignored (additive protocol).
  }

  function openPopupWindow(): Window | null {
    // Token only in the URL fragment (never sent to the server; the page
    // removes it with history.replaceState on load).
    const url = buildPopupUrl(cfg.pageUrl, cfg.options.clientToken);
    try {
      return window.open(url, "verisoura-verify", "popup,width=480,height=760");
    } catch {
      return null;
    }
  }

  /** Returns true when the fallback took over handling of this message. */
  function startPopupFallback(): boolean {
    if (popup || fallbackStarted || settled) return popup !== null;
    fallbackStarted = true;
    removeIframe();
    const w = openPopupWindow();
    if (w) {
      adoptPopup(w);
    } else {
      showPopupBlockedNotice();
    }
    return true;
  }

  function adoptPopup(w: Window): void {
    popup = w;
    removeNotice();
    showNotice(
      "Verification continues in a new window.",
      "Finish it there, then come back to this page.",
      [["Cancel", () => settle({ status: "cancelled" }), false]]
    );
    popupPoll = setInterval(() => {
      if (settled) return;
      if (popup && popup.closed) settle({ status: "cancelled" });
    }, 500);
  }

  function showPopupBlockedNotice(): void {
    showNotice(
      "Camera access is not available in this embedded view.",
      "Continue in a new window to finish verification.",
      [
        [
          "Open verification",
          () => {
            // Runs on a click, so popup blockers allow it.
            const w = openPopupWindow();
            if (w) adoptPopup(w);
          },
          true,
        ],
        ["Cancel", () => settle({ status: "cancelled" }), false],
      ]
    );
  }

  function showNotice(
    text: string,
    sub: string,
    buttons: Array<[label: string, onClick: () => void, primary: boolean]>
  ): void {
    removeNotice();
    const panel = document.createElement("div");
    panel.className = "vsv-notice";
    panel.setAttribute("role", "status");
    const p = document.createElement("p");
    p.textContent = text;
    const s = document.createElement("p");
    s.className = "vsv-sub";
    s.textContent = sub;
    panel.appendChild(p);
    panel.appendChild(s);
    for (const [label, onClick, primary] of buttons) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = primary ? "vsv-btn vsv-btn-primary" : "vsv-btn";
      b.textContent = label;
      b.addEventListener("click", onClick);
      panel.appendChild(b);
    }
    cfg.frameParent.appendChild(panel);
    notice = panel;
  }

  window.addEventListener("message", onMessage);
  createIframe();

  return {
    result,
    close: () => settle({ status: "cancelled" }),
  };
}

/**
 * Opens the verification in a modal over the current page.
 * Returns {result, close}; `result` always resolves with one of the
 * three outcomes and never rejects.
 */
export function open(options: OpenOptions): VerifyFlow {
  assertBrowser();
  const pageUrl = resolvePageUrl(options.clientToken, options.url);
  const origin = deriveOrigin(pageUrl);
  injectStyles();

  const overlay = document.createElement("div");
  overlay.className = "vsv-overlay";
  applyScheme(overlay, options);

  const modal = document.createElement("div");
  modal.className = "vsv-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Identity verification");

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "vsv-close";
  closeBtn.setAttribute("aria-label", "Close verification");
  closeBtn.textContent = "×";
  modal.appendChild(closeBtn);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const flow = runFlow({
    options,
    pageUrl,
    origin,
    frameParent: modal,
    mode: "modal",
    onCleanup: () => overlay.remove(),
  });
  closeBtn.addEventListener("click", () => flow.close());
  return flow;
}

/**
 * Mounts the verification inline inside `target` (an element or a CSS
 * selector). The frame starts at 600px and follows the page's "resize"
 * messages. Returns {result, close} like open().
 */
export function mount(target: Element | string, options: OpenOptions): VerifyFlow {
  assertBrowser();
  const host =
    typeof target === "string" ? document.querySelector(target) : target;
  if (!host) {
    throw new Error(`mount target not found: ${String(target)}`);
  }
  const pageUrl = resolvePageUrl(options.clientToken, options.url);
  const origin = deriveOrigin(pageUrl);
  injectStyles();

  const container = document.createElement("div");
  container.className = "vsv-inline";
  applyScheme(container, options);
  host.appendChild(container);

  return runFlow({
    options,
    pageUrl,
    origin,
    frameParent: container,
    mode: "inline",
    onCleanup: () => container.remove(),
  });
}

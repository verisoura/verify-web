/**
 * <verisoura-verify client-token="vct_..." url="..." locale="ar" color-scheme="auto">
 *
 * Mounts the verification inline when connected and fires:
 *  - "verisoura-complete"  detail: {verificationId}  (display only!)
 *  - "verisoura-cancel"    detail: {}
 *  - "verisoura-error"     detail: {code, message, retryable}
 *  - "verisoura-event"     detail: {name, step?, passed?, reason?}
 *
 * The class is created lazily so this module can be imported in
 * non-browser environments (SSR, tests) without HTMLElement existing.
 */
import { mount } from "./dom.js";
import type { Appearance, VerifyError, VerifyFlow } from "./core.js";

export const ELEMENT_TAG = "verisoura-verify";

let cachedClass: CustomElementConstructor | null = null;

export function getElementClass(): CustomElementConstructor {
  if (cachedClass) return cachedClass;
  const Base = (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
  if (typeof Base !== "function") {
    throw new Error("Custom elements need a browser environment.");
  }

  class VerisouraVerifyElement extends Base {
    private flow: VerifyFlow | null = null;
    private disposed = false;

    connectedCallback(): void {
      if (this.flow) return;
      this.disposed = false;
      const clientToken = this.getAttribute("client-token");
      if (!clientToken) {
        this.fail({
          code: "configuration_invalid",
          message: "The client-token attribute is required.",
          retryable: false,
        });
        return;
      }
      const url = this.getAttribute("url") ?? undefined;
      const locale = this.getAttribute("locale") ?? undefined;
      const scheme = this.getAttribute("color-scheme");
      const appearance: Appearance | undefined =
        scheme === "light" || scheme === "dark" || scheme === "auto"
          ? { colorScheme: scheme }
          : undefined;

      let flow: VerifyFlow;
      try {
        flow = mount(this, {
          clientToken,
          url,
          locale,
          appearance,
          onEvent: (ev) => this.emit("verisoura-event", ev),
        });
      } catch (err) {
        this.fail({
          code: "configuration_invalid",
          message: err instanceof Error ? err.message : "Invalid configuration.",
          retryable: false,
        });
        return;
      }
      this.flow = flow;
      void flow.result.then((outcome) => {
        if (outcome.status === "completed") {
          // verificationId is display/diagnostics only; the backend must
          // act on its own webhook/GET, looked up by the id IT stored.
          this.emit("verisoura-complete", { verificationId: outcome.verificationId });
        } else if (outcome.status === "cancelled") {
          this.emit("verisoura-cancel", {});
        } else {
          this.emit("verisoura-error", outcome.error);
        }
      });
    }

    disconnectedCallback(): void {
      // Removing the element disposes the flow silently.
      this.disposed = true;
      this.flow?.close();
      this.flow = null;
    }

    /** Programmatic cancel; fires "verisoura-cancel". */
    close(): void {
      this.flow?.close();
    }

    private emit(name: string, detail: unknown): void {
      if (this.disposed) return;
      this.dispatchEvent(
        new CustomEvent(name, { detail, bubbles: true, composed: true })
      );
    }

    private fail(error: VerifyError): void {
      queueMicrotask(() => this.emit("verisoura-error", error));
    }
  }

  cachedClass = VerisouraVerifyElement as unknown as CustomElementConstructor;
  return cachedClass;
}

/** Registers the element (no-op outside a browser or when already defined). */
export function defineElement(tagName: string = ELEMENT_TAG): void {
  const registry = (globalThis as { customElements?: CustomElementRegistry })
    .customElements;
  if (!registry) return;
  if (registry.get(tagName)) return;
  registry.define(tagName, getElementClass());
}

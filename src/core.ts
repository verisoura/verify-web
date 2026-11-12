/**
 * Pure logic for the VeriSoura Verify web plugin: bridge protocol v1
 * constants, message validation, outcome mapping and URL building.
 *
 * Nothing in this module touches the DOM, so all of it runs (and is
 * tested) under Node's built-in test runner.
 *
 * Bridge protocol v1 (see client-api-v1.md): every message is
 * {"source":"verisoura-verify","bridge":1,"type":...}. Changes are
 * additive only; unknown types and fields are ignored.
 */

export const SDK_NAME = "@verisoura/verify";
export const SDK_VERSION = "0.1.0-dev";
export const BRIDGE_VERSION = 1;
export const BRIDGE_SOURCE = "verisoura-verify";
export const DEFAULT_PAGE_ORIGIN = "https://verify.verisoura.com";

/** Appearance options forwarded to the hosted page. */
export interface Appearance {
  colorScheme?: "light" | "dark" | "auto";
}

/** A non-sensitive progress event forwarded from the hosted page. */
export interface VerifyEvent {
  name: string;
  step?: number;
  passed?: boolean;
  reason?: string;
}

/** The error shape of a failed outcome. `code` is an OPEN set: new codes
 * appear without a major version bump, so never exhaustively switch on it. */
export interface VerifyError {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * Exactly three outcomes, for good.
 *
 * `verificationId` is for display and diagnostics ONLY. The device is
 * untrusted: your backend must act only on its own webhook or
 * GET /v1/verifications/{id}, looked up by the id IT stored at create time.
 */
export type Outcome =
  | { status: "completed"; verificationId: string }
  | { status: "cancelled" }
  | { status: "failed"; error: VerifyError };

export interface OpenOptions {
  /** The single-use client token from your backend's create call. */
  clientToken: string;
  /** The hosted page URL from the create response. Any fragment is
   * stripped; in iframe mode the token travels only over postMessage.
   * Defaults to the production page derived from the token. Override it
   * for testing against another deployment. */
  url?: string;
  /** "en" | "ar" (or any BCP 47 tag the page supports). */
  locale?: string;
  appearance?: Appearance;
  /** Non-sensitive progress events (never images, never scores). */
  onEvent?: (event: VerifyEvent) => void;
}

/** Handle returned by open() and mount(). `result` never rejects: it
 * always resolves with one of the three outcomes. */
export interface VerifyFlow {
  result: Promise<Outcome>;
  close(): void;
}

/** A validated bridge message. Extra fields are preserved (the protocol
 * is additive), but consumers must only read the documented ones. */
export interface BridgeMessage {
  source: string;
  bridge: number;
  type: string;
  [key: string]: unknown;
}

/** The origin of the hosted page, used as the exact postMessage
 * targetOrigin and to filter every incoming message. */
export function deriveOrigin(pageUrl: string): string {
  return new URL(pageUrl).origin;
}

/**
 * Derives the verification id from a client token.
 * Token shape (client-api-v1.md): "vct_" + 22-char id + "_" + secret.
 * Returns null when the token does not have that shape.
 */
export function tokenVerificationId(clientToken: string): string | null {
  if (typeof clientToken !== "string") return null;
  if (!clientToken.startsWith("vct_")) return null;
  // id occupies positions 4..25 inclusive; a "_" must follow, then a secret.
  if (clientToken.length < 4 + 22 + 1 + 1) return null;
  if (clientToken.charAt(26) !== "_") return null;
  const id = clientToken.slice(4, 26);
  if (!/^[A-Za-z0-9-]{22}$/.test(id)) return null;
  return `ver_${id}`;
}

/**
 * Resolves the hosted page URL (fragment always stripped - in iframe
 * mode the token travels only over postMessage).
 * Prefer passing the `url` from your create response; without it the
 * production URL is derived from the token.
 */
export function resolvePageUrl(clientToken: string, url?: string): string {
  if (url) {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  }
  const id = tokenVerificationId(clientToken);
  if (!id) {
    throw new Error(
      "clientToken does not look like a vct_ client token; pass the `url` from your create response instead."
    );
  }
  return `${DEFAULT_PAGE_ORIGIN}/v/${id}`;
}

/**
 * Builds the URL for link/popup mode. The token travels ONLY in the URL
 * fragment, which is never sent to the server and is removed by the page
 * with history.replaceState on load.
 */
export function buildPopupUrl(pageUrl: string, clientToken: string): string {
  const u = new URL(pageUrl);
  u.hash = clientToken;
  return u.toString();
}

/**
 * Validates an incoming postMessage. Returns the message only when ALL of:
 *  - event.origin equals the expected hosted-page origin,
 *  - data.source === "verisoura-verify",
 *  - data.bridge === 1,
 *  - data.type is a string.
 * Anything else returns null and must be ignored. Unknown types pass
 * validation (the protocol is additive); callers ignore types they do
 * not understand.
 */
export function parseBridgeMessage(
  data: unknown,
  eventOrigin: string,
  expectedOrigin: string
): BridgeMessage | null {
  if (eventOrigin !== expectedOrigin) return null;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.source !== BRIDGE_SOURCE) return null;
  if (d.bridge !== BRIDGE_VERSION) return null;
  if (typeof d.type !== "string") return null;
  return d as BridgeMessage;
}

/** Builds the shell->page init message, posted after the page's "ready". */
export function buildInitMessage(options: {
  clientToken: string;
  locale?: string;
  appearance?: Appearance;
}): Record<string, unknown> {
  const msg: Record<string, unknown> = {
    source: BRIDGE_SOURCE,
    bridge: BRIDGE_VERSION,
    type: "init",
    client_token: options.clientToken,
    sdk: { name: SDK_NAME, version: SDK_VERSION },
  };
  if (options.locale) msg.locale = options.locale;
  if (options.appearance) {
    msg.appearance = { colorScheme: options.appearance.colorScheme ?? "auto" };
  }
  return msg;
}

/** Maps a terminal bridge message to one of the three outcomes;
 * returns null for every non-terminal or unknown type. */
export function outcomeFromMessage(msg: BridgeMessage): Outcome | null {
  switch (msg.type) {
    case "completed":
      return {
        status: "completed",
        verificationId:
          typeof msg.verification_id === "string" ? msg.verification_id : "",
      };
    case "cancelled":
      return { status: "cancelled" };
    case "error":
      return { status: "failed", error: errorFromMessage(msg) };
    default:
      return null;
  }
}

/** Builds a VerifyError from an error bridge message, tolerating absent
 * fields (open, additive protocol). */
export function errorFromMessage(msg: BridgeMessage): VerifyError {
  const code =
    typeof msg.code === "string" && msg.code.length > 0 ? msg.code : "unknown_error";
  const message =
    typeof msg.message === "string" && msg.message.length > 0
      ? msg.message
      : `Verification failed (${code}).`;
  return { code, message, retryable: msg.retryable === true };
}

/** Extracts a progress event from an "event" message. Only the documented
 * fields are copied; everything else is dropped. Returns null when the
 * message is not a well-formed event. */
export function eventFromMessage(msg: BridgeMessage): VerifyEvent | null {
  if (msg.type !== "event" || typeof msg.name !== "string") return null;
  const ev: VerifyEvent = { name: msg.name };
  if (typeof msg.step === "number") ev.step = msg.step;
  if (typeof msg.passed === "boolean") ev.passed = msg.passed;
  if (typeof msg.reason === "string") ev.reason = msg.reason;
  return ev;
}

/**
 * True when a message means the embedded page cannot use the camera, so
 * the plugin should fall back to a popup:
 *  - an "event" named "camera_error", or
 *  - an "error" whose code starts with "camera_".
 */
export function isCameraFailure(msg: BridgeMessage): boolean {
  if (msg.type === "event") return msg.name === "camera_error";
  if (msg.type === "error") {
    return typeof msg.code === "string" && msg.code.startsWith("camera_");
  }
  return false;
}

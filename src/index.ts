/**
 * @verisoura/verify - web plugin for VeriSoura Verify.
 *
 * The device/browser is untrusted. This plugin returns exactly three
 * outcomes - completed(verificationId: display only) | cancelled |
 * failed(code, message, retryable) - and your backend must act only on
 * its own webhook or GET /v1/verifications/{id}, looked up by the id it
 * stored at create time.
 */
export {
  SDK_NAME,
  SDK_VERSION,
  BRIDGE_VERSION,
  BRIDGE_SOURCE,
  DEFAULT_PAGE_ORIGIN,
  deriveOrigin,
  tokenVerificationId,
  resolvePageUrl,
  buildPopupUrl,
  parseBridgeMessage,
  buildInitMessage,
  outcomeFromMessage,
  errorFromMessage,
  eventFromMessage,
  isCameraFailure,
} from "./core.js";
export type {
  Appearance,
  BridgeMessage,
  OpenOptions,
  Outcome,
  VerifyError,
  VerifyEvent,
  VerifyFlow,
} from "./core.js";
export { open, mount } from "./dom.js";
export { defineElement, getElementClass, ELEMENT_TAG } from "./element.js";

import { defineElement } from "./element.js";

// Auto-register <verisoura-verify> in browsers. Safe no-op elsewhere.
try {
  defineElement();
} catch {
  /* non-browser environment */
}

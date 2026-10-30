"use client";

/**
 * Browser Buffer shim: add base64url support on top of the native (or
 * webpack-injected) Buffer.
 *
 * Why: the Qoni SDK decodes JWT tokens with `Buffer.from(payload, "base64url")`.
 * Node supports that encoding natively; the webpack `buffer` polyfill in the
 * browser does not and throws `Unknown encoding: base64url`.
 *
 * Usage: point webpack's global `Buffer` ProvidePlugin in next.config at this
 * module's `Buffer` export so bare `Buffer` references in the SDK get the
 * patched version.
 */

// Browser buffer polyfill (npm `buffer`; Node builtin is not bundled for client).
import { Buffer as BaseBuffer } from "buffer/";

const tag = BaseBuffer as unknown as { __base64urlPatched?: boolean };

if (!tag.__base64urlPatched) {
  let nativeOk = false;
  try {
    BaseBuffer.from("aa", "base64url" as BufferEncoding);
    nativeOk = true;
  } catch {
    nativeOk = false;
  }

  if (!nativeOk) {
    const originalFrom = BaseBuffer.from.bind(BaseBuffer) as (...args: unknown[]) => unknown;
    const patched = (value: unknown, encoding?: unknown, ...rest: unknown[]) => {
      if (encoding === "base64url" && typeof value === "string") {
        const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
        return originalFrom(padded, "base64");
      }
      return originalFrom(value, encoding, ...rest);
    };
    (BaseBuffer as unknown as { from: unknown }).from = patched;
  }

  tag.__base64urlPatched = true;
}

export const Buffer = BaseBuffer;
export default { Buffer: BaseBuffer };

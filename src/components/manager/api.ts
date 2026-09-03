"use client";

/* ==========================================================================
   Talking to the manager API from the browser

   One place, because every screen does the same three things — send JSON,
   read the shape back, turn a failure into something the owner can act on —
   and a screen that improvises its own error handling is a screen that shows
   "undefined" at a coffee truck.
   ========================================================================== */

export interface ApiError {
  error: string;
  /** Present on `invalid_field`. The editor focuses this input. */
  field?: string;
  message?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function send<T>(url: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    /* A tethered phone at a market stand drops its connection regularly. This
       is the single most likely failure here, and it must not surface as a
       stack trace. */
    return { ok: false, error: { error: "offline" } };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const error = (body ?? {}) as Partial<ApiError>;
    return {
      ok: false,
      error: { ...error, error: error.error ?? "request_failed" },
    };
  }

  return { ok: true, data: (body ?? {}) as T };
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function post<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return send<T>(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function patch<T>(url: string, body: unknown): Promise<ApiResult<T>> {
  return send<T>(url, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
}

export function del<T>(url: string): Promise<ApiResult<T>> {
  return send<T>(url, { method: "DELETE" });
}

/** Multipart, for the photo upload. No Content-Type — the browser sets it. */
export function upload<T>(url: string, form: FormData): Promise<ApiResult<T>> {
  return send<T>(url, { method: "POST", body: form });
}

/* --------------------------------------------------------------------------
   Turning an error into something a human reads
   -------------------------------------------------------------------------- */

import type { Dict } from "@/lib/i18n";

/**
 * The API answers in English error codes; the owner reads Hebrew.
 *
 * Falls back to the generic save failure rather than showing the raw code —
 * a code the UI does not know about is a bug in the UI, and "write_failed"
 * on screen tells the owner nothing they can do anything with.
 */
export function errorMessage(error: ApiError, t: Dict): string {
  switch (error.error) {
    case "offline":
      return t.shop.loadErrorMessage;
    case "duplicate":
      return t.manager.validation.duplicateQty;
    case "in_use":
      return t.manager.deleteBlocked;
    case "unauthorized":
    case "forbidden":
      return t.manager.noAccessMessage;
    case "not_configured":
      return t.manager.readOnlyMessage;
    case "too_large":
      return t.manager.photos.tooLarge;
    default:
      return t.manager.saveFailed;
  }
}

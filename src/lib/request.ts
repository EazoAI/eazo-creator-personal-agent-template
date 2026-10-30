"use client";

import { auth } from "@eazo/sdk";

import { getResolvedLocale } from "@/i18n";

/** fetch wrapper: injects Eazo session and UI locale headers. */
export async function request(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const sessionHeader = await auth.getSessionHeader();
  const headers = new Headers(init.headers);
  if (sessionHeader) headers.set("x-eazo-session", sessionHeader);
  headers.set("x-locale", getResolvedLocale());
  return fetch(input, { ...init, headers });
}

"use client";

import { usePathname } from "next/navigation";

import ChatApp from "./chat-app";

/** Persistent ChatApp in root layout; session id is derived from the URL path. */
export function ChatRoot() {
  const pathname = usePathname();
  const match = pathname?.match(/^\/c\/([^/]+)/);
  const sessionId = match ? decodeURIComponent(match[1]) : undefined;
  return <ChatApp sessionId={sessionId} />;
}

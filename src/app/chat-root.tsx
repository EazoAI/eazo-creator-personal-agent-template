"use client";

import { usePathname } from "next/navigation";

import ChatApp from "./chat-app";

/**
 * 在根 layout 里常驻渲染 ChatApp，会话 id 从 URL 路径派生。
 *
 * 为什么放 layout：/ 与 /c/<id> 是不同的路由段，若各自页面渲染 ChatApp，
 * 导航时组件会卸载重挂 —— 既丢失实时 SSE 流，也会触发重复回放。
 * 常驻在 layout 则跨这两个路由不重挂，URL 变化只改 prop。
 */
export function ChatRoot() {
  const pathname = usePathname();
  const match = pathname?.match(/^\/c\/([^/]+)/);
  const sessionId = match ? decodeURIComponent(match[1]) : undefined;
  return <ChatApp sessionId={sessionId} />;
}

"use client";

import { auth } from "@eazo/sdk";

/**
 * fetch 包装：自动注入 Eazo 登录态头 `x-eazo-session`。
 *
 * SDK 从宿主桥（Eazo Mobile）或 localStorage（web）解析当前 session；
 * 服务端用 requireAuth 读这个头 + EAZO_PRIVATE_KEY 解出可信用户。
 *
 * 注意：SSE（EventSource）无法带自定义头，所以 /api/webagent/stream 不走这里——
 * 它靠不可猜的 runId 做能力级隔离（runId 只在已鉴权的 start 调用里返回）。
 */
export async function request(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const sessionHeader = await auth.getSessionHeader();
  const headers = new Headers(init.headers);
  if (sessionHeader) headers.set("x-eazo-session", sessionHeader);
  return fetch(input, { ...init, headers });
}

import type { Metadata } from "next";

import { EazoProvider } from "@eazo/sdk/react";

import { ChatRoot } from "./chat-root";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent · 云端浏览器替你办事",
  description: "一句话让云端浏览器 Agent 替你完成网页任务",
};

// EazoProvider 依赖运行时宿主 app 配置（NEXT_PUBLIC_EAZO_APP_ID），
// 不参与构建期静态预渲染，避免内置 /_not-found 预渲染时报错。
export const dynamic = "force-dynamic";

// ChatApp 常驻在 layout（经 ChatRoot）：/ 与 /c/<id> 导航时不重挂，
// 保住实时 SSE 流和本地对话状态。page.tsx / c/[id]/page.tsx 只是空壳，
// 让这两个路由存在；真正的 UI 一直是这同一个 ChatApp 实例。
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <EazoProvider>
          <ChatRoot />
          {children}
        </EazoProvider>
      </body>
    </html>
  );
}

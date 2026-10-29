import type { Metadata } from "next";

import { EazoProvider } from "@eazo/sdk/react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Agent · 云端浏览器替你办事",
  description: "一句话让云端浏览器 Agent 替你完成网页任务",
};

// EazoProvider 依赖运行时宿主 app 配置（NEXT_PUBLIC_EAZO_APP_ID），
// 不参与构建期静态预渲染，避免内置 /_not-found 预渲染时报错。
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <EazoProvider>{children}</EazoProvider>
      </body>
    </html>
  );
}

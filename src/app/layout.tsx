import type { Metadata } from "next";

import { EazoProvider } from "@eazo/sdk/react";

import { I18nProvider } from "@/components/i18n/i18n-provider";
import { ChatRoot } from "./chat-root";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent · Cloud browser at your service",
  description: "Tell the cloud browser agent what to do on the web in one sentence.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <I18nProvider>
          <EazoProvider>
            <ChatRoot />
            {children}
          </EazoProvider>
        </I18nProvider>
      </body>
    </html>
  );
}

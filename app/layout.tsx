import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./workspace-theme.css";
import "../features/command-center/workbench.css";
import "../features/conversation/conversation.css";
import "../features/conversation/settings.css";
import "../features/workspace/research-assistant.css";
import "../features/conversation/native-conversation.css";
import "../components/project-filters.css";
import "../features/workspace/submission-dialog.css";
import "../features/workspace/bridge-connection.css";
import "./components/ssh-terminal.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "SCOPE · 跨项目 Agent 工作台";
const description =
  "从本机 SSH Config 发现远端 Codex CLI、tmux 会话与实时终端活动。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title,
    description,
    icons: { icon: "/scope-logo.svg" },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "zh_CN",
      images: [
        {
          url: imageUrl,
          width: 1792,
          height: 1024,
          alt: "SCOPE Research Operations",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}

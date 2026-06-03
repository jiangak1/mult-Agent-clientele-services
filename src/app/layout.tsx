import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CSP - Customer Service Platform",
  description: "Enterprise Multi-Agent Customer Service Platform",
  manifest: "/manifest.json",
  themeColor: "#6c8cff",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CSP",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}

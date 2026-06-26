import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "NEXCODE",
  description: "Çoklu-agent, paralel vibe coding ortamı",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <head>
        {/* file:// (paketli) ve http (dev) ortamlarında çalışsın diye göreli yol */}
        <link rel="icon" type="image/png" href="./favicon.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}

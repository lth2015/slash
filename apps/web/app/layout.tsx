import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slash",
  description: "Unified command palette for SRE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProjectAi — Autonomous Academic Research Engine",
  description:
    "AI-powered multi-agent system that researches and writes comprehensive academic projects using style-specific guidelines",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
// Fonts are self-hosted (no internet needed on stage).
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-600.css";
import "@fontsource/kalam/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kagaz → App",
  description: "Paper sketch to working app, live, with Claude Code",
};

export const viewport: Viewport = {
  themeColor: "#0b0d12",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-stage font-sans text-zinc-100 antialiased">{children}</body>
    </html>
  );
}

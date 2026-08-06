import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

// JetBrains Mono used throughout -- body/UI, code, and headings all share
// it now, differentiated purely by weight (see globals.css: Bold for body
// text, ExtraBold for headings/display via font-extrabold). Loaded as a
// variable font (no fixed `weight` array) so the full weight axis is
// available for both.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Orion",
  description: "The control room for AI-governed engineering work",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}

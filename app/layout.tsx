import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const display = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-display" });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "DynaMo — CoolSip Control Room",
  description: "Context-aware ad automation: creatives that flip with the live weather.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}

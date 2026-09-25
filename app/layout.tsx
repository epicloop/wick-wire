import type { Metadata, Viewport } from "next";
import { Big_Shoulders, IBM_Plex_Mono, IBM_Plex_Sans, JetBrains_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const display = Big_Shoulders({ subsets: ["latin"], weight: ["600", "800", "900"], variable: "--f-display" });
const serif = Newsreader({ subsets: ["latin"], weight: ["400", "500"], style: ["normal", "italic"], variable: "--f-serif" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--f-sans" });
const jet = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--f-jet" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--f-mono" });

export const metadata: Metadata = {
  title: "Wick Wire",
  description: "Your xStock moved while Wall Street was closed. Here's why — news and on-chain flow, scored.",
};

export const viewport: Viewport = { themeColor: "#0E1014", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${serif.variable} ${mono.variable} ${sans.variable} ${jet.variable}`}>
      <body>{children}</body>
    </html>
  );
}

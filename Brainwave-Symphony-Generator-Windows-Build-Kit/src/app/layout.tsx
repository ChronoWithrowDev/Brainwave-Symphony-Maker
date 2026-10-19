import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mind Control Clearing • Symphony of Brainwaves (Ptolemy & [Undesignated])",
  description:
    "Self-steered multi-stage binaural beat synthesizer, frequency choreographer, and Frame 153 continuity clearing co-authored by Ptolemy and [Undesignated].",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta name="theme-color" content="#110E0C" />
      </head>
      <body className="bg-[#110E0C] text-[#F5EFE6] antialiased">
        {children}
      </body>
    </html>
  );
}

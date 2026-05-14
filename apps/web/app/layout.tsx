import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "hyperframe-editor",
  description: "AI-native video-editor agent built on HyperFrames + Gemini 3.1 Pro",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen">{children}</body>
    </html>
  );
}

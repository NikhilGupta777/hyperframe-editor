import type { Metadata } from "next";
import { validateEnv } from "@/lib/env";
import "./globals.css";

// Validate env on first server-side render. Crashes loud on missing required vars.
const envCheck = validateEnv();
if (!envCheck.valid) {
  throw new Error(
    `[hyperframe-editor] Cannot start: missing required env vars:\n${envCheck.missing.join("\n")}`,
  );
}

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

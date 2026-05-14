import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="font-display text-5xl tracking-tight">hyperframe-editor</h1>
      <p className="mt-4 text-lg opacity-80">
        AI-native video-editor agent. Prompt, preview, render — in the browser.
      </p>
      <div className="mt-10 flex gap-4">
        <Link
          href="/editor/demo"
          className="rounded-md bg-accent px-5 py-3 font-semibold text-ink hover:opacity-90"
        >
          Open the demo editor
        </Link>
        <a
          href="https://github.com/NikhilGupta777/hyperframe-editor"
          className="rounded-md border border-muted px-5 py-3 hover:bg-muted/10"
        >
          View on GitHub
        </a>
      </div>
      <ul className="mt-12 grid gap-3 text-sm opacity-80">
        <li>• Two loops: BUILD (prompt → MP4) and EDIT-SOURCE (video → polished cut)</li>
        <li>• 8 mandatory quality gates run on every render</li>
        <li>• HyperFrames composition is the source of truth</li>
        <li>• Frontend on Vercel · workers on Oracle Free Tier (ARM64)</li>
      </ul>
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

export interface SourceRow {
  id: string;
  kind: string;
  storageUri: string;
  durationSec?: string | number;
  width?: number;
  height?: number;
}

export function SourceUpload({
  projectId,
  disabled,
  onEditSource,
}: {
  projectId: string;
  disabled?: boolean;
  onEditSource?: (source: SourceRow) => void;
}) {
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/sources`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { sources?: SourceRow[] };
      setSources(j.sources ?? []);
    } catch {
      // ignore
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadProgress("Requesting upload URL…");
    try {
      const urlRes = await fetch(`/api/projects/${projectId}/upload-url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!urlRes.ok) {
        const j = (await urlRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `upload-url failed: HTTP ${urlRes.status}`);
      }
      const { url, key, contentType } = (await urlRes.json()) as {
        url: string;
        key: string;
        contentType: string;
      };

      if (!url.startsWith("data:")) {
        setUploadProgress(`Uploading ${(file.size / 1e6).toFixed(1)} MB…`);
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed: ${putRes.status}`);
        }
      }

      setUploadProgress("Registering source…");
      const kind = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("image/")
            ? "image"
            : "doc";

      const regRes = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageUri: `oci://hyperframe-editor/${key}`,
          kind,
        }),
      });
      if (!regRes.ok) {
        const j = (await regRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `register failed: HTTP ${regRes.status}`);
      }
      await refresh();
      setUploadProgress(null);
    } catch (e) {
      setUploadError((e as Error).message);
      setUploadProgress(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2 text-xs">
      <div className="text-[10px] uppercase tracking-wider opacity-60">Source files</div>

      {/* Drop zone — also serves as tap-to-browse on mobile */}
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        className="w-full rounded border-2 border-dashed border-muted/30 px-3 py-5 text-center
          hover:border-muted/60 active:border-accent/60 transition-colors disabled:opacity-50
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {uploadProgress ?? (uploading ? "Uploading…" : (
          <span>
            <span className="block text-lg mb-0.5 opacity-50">↑</span>
            Tap to browse or drop a file
          </span>
        ))}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="video/*,audio/*,image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {uploadError && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-2 text-[11px] text-red-200 break-words">
          {uploadError}
        </div>
      )}

      {sources.length > 0 && (
        <ul className="space-y-1">
          {sources.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 rounded border border-muted/30 px-2 py-2"
            >
              <span className="font-mono opacity-70 shrink-0">{s.kind}</span>
              <span className="flex-1 min-w-0 opacity-60 truncate text-[11px]">
                {s.storageUri.split("/").pop()}
              </span>
              {s.kind === "video" && onEditSource && (
                <button
                  disabled={disabled}
                  onClick={() => onEditSource(s)}
                  className="shrink-0 rounded bg-accent/20 border border-accent/40 text-accent text-[10px] px-2 py-1 hover:bg-accent/30 disabled:opacity-50 transition-colors"
                >
                  Edit
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

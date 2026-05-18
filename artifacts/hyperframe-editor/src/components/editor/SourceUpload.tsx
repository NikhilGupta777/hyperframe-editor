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
    setUploadProgress("requesting upload URL…");
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
        setUploadProgress(`uploading ${(file.size / 1e6).toFixed(1)} MB…`);
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`Upload failed: ${putRes.status}`);
        }
      }

      setUploadProgress("registering source…");
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
      <div
        className="rounded border-2 border-dashed border-muted/30 px-3 py-4 text-center cursor-pointer hover:border-muted/60 transition-colors"
        onClick={() => !disabled && fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (disabled) return;
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
      >
        {uploadProgress ?? (uploading ? "uploading…" : "Drop a video/audio/image or click to browse")}
      </div>
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
        <div className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          {uploadError}
        </div>
      )}
      {sources.length > 0 && (
        <ul className="space-y-1">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border border-muted/30 px-2 py-1">
              <span>
                <span className="font-mono opacity-70">{s.kind}</span>{" "}
                <span className="opacity-50 truncate max-w-[140px] inline-block align-bottom">
                  {s.storageUri.split("/").pop()}
                </span>
              </span>
              {s.kind === "video" && onEditSource && (
                <button
                  disabled={disabled}
                  onClick={() => onEditSource(s)}
                  className="text-accent text-[10px] hover:underline disabled:opacity-50"
                >
                  edit
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SourceRow {
  id: string;
  kind: string;
  storageUri: string;
  durationSec?: string | number;
  width?: number;
  height?: number;
}

/**
 * Source upload panel. Shown in the "assets" tab alongside the stock search.
 * Handles the two-step browser→OCI direct upload flow:
 *   1. POST /api/projects/:id/upload-url → { url, key, method }
 *   2. PUT bytes directly to the signed URL (no proxy through Vercel).
 *   3. POST /api/projects/:id/sources to register the source in the DB.
 *
 * Lists existing sources below the upload zone so the user can see what
 * they've already uploaded and (Phase 3+) trigger an edit-source loop.
 */
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
      const r = await fetch(`/api/projects/${projectId}/sources`, {
        cache: "no-store",
      });
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
    setUploadProgress("requesting upload URL\u2026");
    try {
      // Step 1: get a signed PUT URL from the API.
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

      // Step 2: PUT bytes directly to OCI (or the dev stub URL).
      if (!url.startsWith("data:")) {
        setUploadProgress(`uploading ${(file.size / 1e6).toFixed(1)} MB\u2026`);
        const putRes = await fetch(url, {
          method: "PUT",
          headers: { "content-type": contentType },
          body: file,
        });
        if (!putRes.ok) {
          throw new Error(`OCI PUT failed: ${putRes.status}`);
        }
      }

      // Step 3: register the source.
      setUploadProgress("registering source\u2026");
      const kind = file.type.startsWith("video/")
        ? "video"
        : file.type.startsWith("audio/")
          ? "audio"
          : file.type.startsWith("image/")
            ? "image"
            : "doc";
      const meta = await readMediaMetadata(file, kind);
      const regRes = await fetch(`/api/projects/${projectId}/sources`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          storageUri: `oci://${process.env.NEXT_PUBLIC_STORAGE_BUCKET ?? "bucket"}/${key}`,
          kind,
          ...meta,
        }),
      });
      if (!regRes.ok) {
        throw new Error(`register source failed: HTTP ${regRes.status}`);
      }
      setUploadProgress(null);
      void refresh();
    } catch (e) {
      setUploadError((e as Error).message);
      setUploadProgress(null);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="text-[10px] uppercase tracking-wider opacity-60 pb-1">
        Upload source media
      </div>
      <div
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        className="rounded border-2 border-dashed border-muted/40 p-4 text-center hover:border-accent/50 transition-colors"
      >
        <div className="opacity-70 mb-2">
          Drop a video, audio, or image file here
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
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || disabled}
          className="rounded bg-accent text-ink px-3 py-1 font-semibold disabled:opacity-50"
        >
          {uploading ? "Uploading\u2026" : "Choose file"}
        </button>
        {uploadProgress && (
          <div className="mt-2 opacity-70">{uploadProgress}</div>
        )}
        {uploadError && (
          <div className="mt-2 text-red-300">{uploadError}</div>
        )}
      </div>

      {sources.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider opacity-60 pb-1">
            Sources ({sources.length})
          </div>
          <ul className="space-y-1">
            {sources.map((s) => (
              <li
                key={s.id}
                className="rounded border border-muted/30 px-2 py-1 flex items-center justify-between"
              >
                <span className="font-mono opacity-80">{s.kind}</span>
                <div className="flex items-center gap-2">
                  {s.durationSec && (
                    <span className="opacity-60">
                      {Number(s.durationSec).toFixed(1)}s
                    </span>
                  )}
                  {s.kind === "video" && onEditSource && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onEditSource(s)}
                      className="rounded bg-accent px-2 py-0.5 font-semibold text-ink disabled:opacity-50"
                    >
                      Edit full video
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

async function readMediaMetadata(
  file: File,
  kind: string,
): Promise<{ durationSec?: number; width?: number; height?: number }> {
  if (kind !== "video" && kind !== "audio") return {};
  const url = URL.createObjectURL(file);
  try {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    const loaded = new Promise<void>((resolve, reject) => {
      el.onloadedmetadata = () => resolve();
      el.onerror = () => reject(new Error("could not read media metadata"));
    });
    el.src = url;
    await loaded;
    return {
      durationSec: Number.isFinite(el.duration) ? Number(el.duration.toFixed(3)) : undefined,
      width: kind === "video" ? (el as HTMLVideoElement).videoWidth || undefined : undefined,
      height: kind === "video" ? (el as HTMLVideoElement).videoHeight || undefined : undefined,
    };
  } catch {
    return {};
  } finally {
    URL.revokeObjectURL(url);
  }
}

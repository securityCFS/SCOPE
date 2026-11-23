<!-- SCOPE_MEDIA_PREVIEWS_BEGIN -->
## Result handoff: image and video previews

- When completed image/video artifacts are relevant to the result, include direct
  preview references in the final reply, not just a directory, HTML gallery, or
  a path inside a code block. Do not generate extra media solely to fill a report.
- Verify each referenced file exists, is non-empty, and is fully written. Use
  the absolute path on the current SSH host; resolve symlinks when practical.
  Keep durable artifacts under the project/output storage, not transient `/tmp`.
- Images: `![Short description](</absolute/path/figure.png>)`.
- Videos: `[Short description — video](</absolute/path/clip.mp4>)`.
  SCOPE renders direct MP4/M4V/WebM/OGV links as video players. Prefer an already
  available browser-compatible MP4 (H.264) or WebM; do not start a costly or lossy
  transcode without need. If a codec is unsupported, say so and retain the original.
- Show a small representative selection (normally 1–3 previews), plus the full
  gallery/output directory when there are more. Identify the host if artifacts
  are on another host; never present another host's path as locally accessible.
- Distinguish final artifacts from partial renders or running jobs. Do not claim
  to have visually inspected a video/image merely because its file exists.
- These are output-format rules only: they do not authorize uploads, emails,
  experiment launches, account changes, or interruption of existing processes.
<!-- SCOPE_MEDIA_PREVIEWS_END -->

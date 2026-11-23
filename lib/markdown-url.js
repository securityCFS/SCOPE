import { defaultUrlTransform } from "react-markdown";
import { markdownImageSource, markdownVideoSource } from "./markdown-images.js";
import { remoteFileTargetFromMarkdownHref } from "./remote-links.js";

// File hrefs must reach RemoteFileLink before react-markdown strips file: URLs.
// Without a session host, keep the default sanitizer (never open browser-local files).
export function markdownUrlTransform(url, key, host, cwd) {
  if (key === "src") return markdownImageSource(url, host, cwd);
  const video = markdownVideoSource(url, host, cwd);
  if (video) return video;
  if (host && remoteFileTargetFromMarkdownHref(url, cwd)) return url;
  return defaultUrlTransform(url);
}

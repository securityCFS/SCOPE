import { remoteFileTargetFromMarkdownHref } from "./remote-links.js";

export function isImageSource(src) {
  return typeof src === "string" && (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[?#]|$)/i.test(src) || src.startsWith("/scope-image-api?"));
}

export function isVideoSource(src) {
  return typeof src === "string" && (/\.(mp4|m4v|webm|ogv|mov)(?:[?#]|$)/i.test(src) || src.startsWith("/scope-video-api?"));
}

export function markdownVideoSource(src, host, cwd) {
  if (!isVideoSource(src)) return "";
  return markdownImageSource(src, host, cwd);
}

export function markdownImageSource(src, host, cwd) {
  if (typeof src !== "string" || !src) return "";
  if (/^https?:\/\//i.test(src)) return src;
  const target = remoteFileTargetFromMarkdownHref(src, cwd);
  if (!host || !target) return "";
  return `/${isVideoSource(src) ? "scope-video-api" : "scope-image-api"}?${new URLSearchParams({ host, path: target.path })}`;
}

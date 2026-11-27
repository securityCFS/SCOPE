export type RemotePortTarget = {
  port: number;
  protocol: string;
  pathAndQuery: string;
  rawHost: string;
};

export type BrowserLocationLike = {
  hostname?: string;
  origin?: string;
  protocol?: string;
  host?: string;
};

export function isRemoteBrowserLocation(
  locationLike?: BrowserLocationLike | null,
): boolean;

export function portForwardAccessUrl(
  localPort: number,
  options?: {
    pathAndQuery?: string;
    protocol?: string;
    location?: BrowserLocationLike | null;
  },
): string;

export function remotePortTargetFromMarkdownHref(
  href: string | undefined,
): RemotePortTarget | null;

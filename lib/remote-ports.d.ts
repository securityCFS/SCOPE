export type RemotePortTarget = {
  port: number;
  protocol: string;
  pathAndQuery: string;
  rawHost: string;
};

export function remotePortTargetFromMarkdownHref(
  href: string | undefined,
): RemotePortTarget | null;

export type PluginDescriptor = {
  source?: "builtin" | "local";
  manifest: {
    protocolVersion: number; id: string; name: string; version: string; description: string;
    permissions: string[];
    settings: { key: string; type: string; label: string; placeholder?: string; requiredWhenEnabled?: boolean }[];
    actions: { id: string; label: string; result: string }[];
    view?: string;
  };
  enabled: boolean; revision: number; config: Record<string, string>;
  status: { state: string; scannedAt: string | null; error: string | null };
};

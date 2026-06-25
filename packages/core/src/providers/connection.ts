/**
 * Agent bağlantı modu tercihi (PRD §9.5).
 * - `api_only`  : Sadece API anahtarı
 * - `cli_only`  : Sadece CLI abonelik
 * - `cli_first` : CLI öncelikli, kota dolunca API'ye geç (varsayılan)
 */
export type ConnectionPreference = "api_only" | "cli_only" | "cli_first";

export const DEFAULT_CONNECTION_PREFERENCE: ConnectionPreference = "cli_first";

export const CONNECTION_PREFERENCES: readonly ConnectionPreference[] = [
  "api_only",
  "cli_only",
  "cli_first",
];

export function isConnectionPreference(value: string): value is ConnectionPreference {
  return (CONNECTION_PREFERENCES as readonly string[]).includes(value);
}

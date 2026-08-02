/**
 * Agent connection mode preference.
 * - `api_only`  : API key only
 * - `cli_only`  : CLI subscription only
 * - `cli_first` : CLI first, switching to the API once the quota runs out (default)
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

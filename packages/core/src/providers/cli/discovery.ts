import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import type { AgentProfile, CliAdapter, NexcodeConfig } from "../../config/schema";
import { CLI_ADAPTER_SPECS, type CliAdapterSpec } from "./adapters";
import { logger } from "../../logger";

/**
 * CLI discovery.
 *
 * Alongside PATH, npm, pnpm, Yarn, Bun, Volta, Scoop, WinGet, Chocolatey, Homebrew and the
 * common Unix locations are scanned: whichever package manager the user installed their
 * CLI with, it is found, and they do not have to add it to PATH by hand.
 *
 * Automatic adapters the user deleted are kept in the `discoveryIgnoredAdapters` list and
 * are not recreated on the next scan.
 */

const WINDOWS_EXTENSIONS = ["", ".cmd", ".exe", ".bat", ".ps1"] as const;

/**
 * Joins paths with the separator of the **target platform**.
 *
 * `node:path.join` uses the separator of the machine it runs on; taking a `platform`
 * parameter keeps this function portable and testable.
 */
function joinPath(platform: NodeJS.Platform, ...segments: string[]): string {
  const separator = platform === "win32" ? "\\" : "/";
  return segments
    .map((segment, index) => (index === 0 ? segment.replace(/[\\/]+$/, "") : segment.replace(/^[\\/]+|[\\/]+$/g, "")))
    .filter((segment) => segment !== "")
    .join(separator);
}

/** The PATH separator also depends on the target platform. */
function pathDelimiter(platform: NodeJS.Platform): string {
  return platform === "win32" ? ";" : ":";
}

/** Package manager and installation locations (missing ones are skipped silently). */
export function candidateDirectories(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string[] {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  const dirs: string[] = (env.PATH ?? env.Path ?? "").split(pathDelimiter(platform)).filter((dir) => dir !== "");
  const p = (...segments: string[]): string => joinPath(platform, ...segments);

  if (platform === "win32") {
    const appData = env.APPDATA ?? p(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA ?? p(home, "AppData", "Local");
    const programData = env.ProgramData ?? "C:\\ProgramData";
    dirs.push(
      p(appData, "npm"), // npm global
      p(localAppData, "pnpm"), // pnpm
      p(localAppData, "Yarn", "bin"), // Yarn
      p(home, ".yarn", "bin"),
      p(home, ".bun", "bin"), // Bun
      p(localAppData, "Volta", "bin"), // Volta
      p(home, "scoop", "shims"), // Scoop
      p(localAppData, "Microsoft", "WindowsApps"), // WinGet
      p(programData, "chocolatey", "bin"), // Chocolatey
      p(localAppData, "Programs"),
    );
  } else {
    dirs.push(
      "/usr/local/bin",
      "/usr/bin",
      "/opt/homebrew/bin", // Homebrew (Apple Silicon)
      "/home/linuxbrew/.linuxbrew/bin", // Linuxbrew
      p(home, ".local", "bin"),
      p(home, ".npm-global", "bin"),
      p(home, ".bun", "bin"),
      p(home, ".volta", "bin"),
      p(home, ".yarn", "bin"),
      p(home, ".config", "yarn", "global", "node_modules", ".bin"),
      p(home, ".deno", "bin"),
    );
  }

  return [...new Set(dirs)];
}

export interface DiscoveredCli {
  adapter: CliAdapter;
  /** The command to execute: an absolute path or a name found on PATH. */
  command: string;
  version: string | null;
}

/** Looks for a command in the candidate directories; falls back to PATH resolution (where/which). */
export function locateBinary(
  binaries: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
): string | null {
  const extensions = platform === "win32" ? WINDOWS_EXTENSIONS : [""];

  for (const dir of candidateDirectories(env, platform)) {
    for (const binary of binaries) {
      for (const extension of extensions) {
        const candidate = joinPath(platform, dir, `${binary}${extension}`);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  const probe = platform === "win32" ? "where" : "which";
  for (const binary of binaries) {
    try {
      const result = spawnSync(probe, [binary], { encoding: "utf8", windowsHide: true, timeout: 4000 });
      const first = result.stdout?.split(/\r?\n/).find((line) => line.trim() !== "");
      if (result.status === 0 && first !== undefined) return first.trim();
    } catch {
      // Move on to the next candidate.
    }
  }
  return null;
}

function readVersion(command: string, spec: CliAdapterSpec): string | null {
  try {
    const result = spawnSync(command, [...spec.versionArgs], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    });
    if (result.status !== 0) return null;
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    return output.split(/\r?\n/)[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

/** Scans the installed CLIs. */
export function discoverClis(env: NodeJS.ProcessEnv = process.env, platform = process.platform): DiscoveredCli[] {
  const found: DiscoveredCli[] = [];
  for (const spec of Object.values(CLI_ADAPTER_SPECS)) {
    const command = locateBinary(spec.binaries, env, platform);
    if (command === null) continue;
    found.push({ adapter: spec.id, command, version: readVersion(command, spec) });
    logger.info("cli.discovered", { adapter: spec.id, command });
  }
  return found;
}

export interface SyncResult {
  agents: Record<string, AgentProfile>;
  added: string[];
  removed: string[];
  /** Built-in profiles whose command was filled in from discovery. */
  linked: string[];
}

/**
 * Reflects the discovered CLIs into the agent profiles.
 *
 * - Adapters the user hid are not added back.
 * - Built-in domain agents (`discovered: false`) are never deleted or overwritten.
 * - Automatically created profiles that are no longer installed are removed.
 * - **The missing `cmd` field of built-in profiles is filled in.** The six bundled agents
 *   only declare which adapter they use; the command path cannot be written into the config
 *   because it differs per machine. Without this, those profiles fail on every task saying
 *   "no command defined".
 */
export function syncDiscoveredAgents(config: NexcodeConfig, found: readonly DiscoveredCli[]): SyncResult {
  const ignored = new Set(config.discoveryIgnoredAdapters);
  const agents: Record<string, AgentProfile> = { ...config.agents };
  const added: string[] = [];
  const removed: string[] = [];
  const linked: string[] = [];

  const usable = found.filter((cli) => !ignored.has(cli.adapter));
  const liveIds = new Set(usable.map((cli) => discoveredId(cli.adapter)));
  const commandByAdapter = new Map(usable.map((cli) => [cli.adapter, cli.command]));

  for (const [id, profile] of Object.entries(agents)) {
    if (profile.discovered && !liveIds.has(id)) {
      delete agents[id];
      removed.push(id);
    }
  }

  for (const cli of usable) {
    const id = discoveredId(cli.adapter);
    const spec = CLI_ADAPTER_SPECS[cli.adapter as Exclude<CliAdapter, "custom">];
    const existing = agents[id];

    if (existing !== undefined) {
      // Preserve the user's edits; refresh only the command path.
      agents[id] = { ...existing, cmd: cli.command };
      continue;
    }

    agents[id] = {
      id,
      name: `${spec.label} (${spec.defaultRole})`,
      enabled: true,
      role: spec.defaultRole,
      roleFile: `${spec.defaultRole}.md`,
      connection: "cli_only",
      autonomy: "supervised",
      modelOverride: false,
      cmd: cli.command,
      args: [],
      adapter: cli.adapter,
      discovered: true,
    };
    added.push(id);
  }

  // Complete the command path of the built-in profiles from discovery.
  for (const [id, profile] of Object.entries(agents)) {
    if (profile.discovered) continue;
    if (profile.cmd !== undefined && profile.cmd !== "") continue;
    if (profile.adapter === undefined || profile.adapter === "custom") continue;

    const command = commandByAdapter.get(profile.adapter);
    if (command === undefined) continue;

    agents[id] = { ...profile, cmd: command };
    linked.push(id);
  }

  return { agents, added, removed, linked };
}

function discoveredId(adapter: CliAdapter): string {
  return `cli-${adapter}`;
}

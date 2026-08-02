import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../config/schema";
import { FALLBACK_CONFIG } from "../../config/defaults";
import { candidateDirectories, syncDiscoveredAgents, type DiscoveredCli } from "./discovery";

describe("candidateDirectories", () => {
  it("scans the package manager locations on Windows", () => {
    const dirs = candidateDirectories(
      {
        PATH: "C:\\Windows\\system32",
        USERPROFILE: "C:\\Users\\Ali",
        APPDATA: "C:\\Users\\Ali\\AppData\\Roaming",
        LOCALAPPDATA: "C:\\Users\\Ali\\AppData\\Local",
        ProgramData: "C:\\ProgramData",
      },
      "win32",
    );
    const joined = dirs.join("|");
    expect(joined).toContain("AppData\\Roaming\\npm"); // npm
    expect(joined).toContain("AppData\\Local\\pnpm"); // pnpm
    expect(joined).toContain("Yarn\\bin"); // Yarn
    expect(joined).toContain(".bun\\bin"); // Bun
    expect(joined).toContain("Volta\\bin"); // Volta
    expect(joined).toContain("scoop\\shims"); // Scoop
    expect(joined).toContain("WindowsApps"); // WinGet
    expect(joined).toContain("chocolatey\\bin"); // Chocolatey
    expect(dirs).toContain("C:\\Windows\\system32");
  });

  it("scans Homebrew and the user locations on Unix", () => {
    const dirs = candidateDirectories({ PATH: "/usr/bin", HOME: "/home/ali" }, "linux");
    const joined = dirs.join("|");
    expect(joined).toContain("/opt/homebrew/bin");
    expect(joined).toContain("/home/linuxbrew/.linuxbrew/bin");
    expect(joined).toContain("/home/ali/.local/bin");
    expect(joined).toContain("/home/ali/.bun/bin");
    expect(joined).toContain("/home/ali/.volta/bin");
  });

  it("de-duplicates repeated directories", () => {
    const dirs = candidateDirectories({ PATH: "/usr/bin:/usr/bin:/usr/local/bin", HOME: "/home/ali" }, "linux");
    expect(dirs.filter((dir) => dir === "/usr/bin")).toHaveLength(1);
  });
});

describe("syncDiscoveredAgents", () => {
  const found: DiscoveredCli[] = [
    { adapter: "codex", command: "C:/npm/codex.cmd", version: "1.0" },
    { adapter: "opencode", command: "/usr/local/bin/opencode", version: "2.0" },
  ];

  it("adds the discovered CLIs as specialist profiles", () => {
    const { agents, added } = syncDiscoveredAgents(FALLBACK_CONFIG, found);
    expect(added.sort()).toEqual(["cli-codex", "cli-opencode"]);
    expect(agents["cli-codex"]?.cmd).toBe("C:/npm/codex.cmd");
    expect(agents["cli-codex"]?.discovered).toBe(true);
    expect(agents["cli-codex"]?.connection).toBe("cli_only");
  });

  it("does not touch the built-in domain agents", () => {
    const { agents } = syncDiscoveredAgents(FALLBACK_CONFIG, found);
    expect(agents.ceo).toEqual(FALLBACK_CONFIG.agents.ceo);
    expect(agents.backend).toEqual(FALLBACK_CONFIG.agents.backend);
  });

  it("does not add back an adapter the user hid", () => {
    const config = normalizeConfig({ ...FALLBACK_CONFIG, discoveryIgnoredAdapters: ["codex"] });
    const { agents, added } = syncDiscoveredAgents(config, found);
    expect(added).toEqual(["cli-opencode"]);
    expect(agents["cli-codex"]).toBeUndefined();
  });

  it("preserves user edits in an existing profile and only refreshes the command", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      agents: {
        ...FALLBACK_CONFIG.agents,
        "cli-codex": {
          id: "cli-codex",
          name: "My Codex",
          role: "reviewer",
          roleFile: "reviewer.md",
          discovered: true,
          cmd: "old/path/codex",
          adapter: "codex",
        },
      },
    });
    const { agents } = syncDiscoveredAgents(config, found);
    expect(agents["cli-codex"]?.name).toBe("My Codex");
    expect(agents["cli-codex"]?.role).toBe("reviewer");
    expect(agents["cli-codex"]?.cmd).toBe("C:/npm/codex.cmd");
  });

  it("removes an automatic profile that is no longer installed", () => {
    const config = normalizeConfig({
      ...FALLBACK_CONFIG,
      agents: {
        ...FALLBACK_CONFIG.agents,
        "cli-gemini": { id: "cli-gemini", name: "Gemini", role: "reviewer", discovered: true, cmd: "gemini" },
      },
    });
    const { agents, removed } = syncDiscoveredAgents(config, found);
    expect(removed).toEqual(["cli-gemini"]);
    expect(agents["cli-gemini"]).toBeUndefined();
  });

  it("preserves the built-in agents when no CLI is found", () => {
    const { agents, added } = syncDiscoveredAgents(FALLBACK_CONFIG, []);
    expect(added).toEqual([]);
    expect(Object.keys(agents).sort()).toEqual(["backend", "ceo", "devops", "frontend", "qa", "security"]);
  });

  it("leaves the result normalisable", () => {
    const { agents } = syncDiscoveredAgents(FALLBACK_CONFIG, found);
    expect(() => normalizeConfig({ ...FALLBACK_CONFIG, agents })).not.toThrow();
  });
});

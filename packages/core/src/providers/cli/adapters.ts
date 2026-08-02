import type { CliAdapter, OrchestrationRole } from "../../config/schema";
import { ADAPTER_SILENCE_SECONDS } from "../../config/schema";

/**
 * Execution contract of the known CLI adapters.
 *
 * Invariants:
 * - Every invocation has to be **non-interactive and autonomous**; unsupported or
 *   outdated flags must not leak into profiles.
 * - The health check and normal execution use the **same** prompt materialisation;
 *   otherwise a healthy CLI is wrongly counted as `failed`.
 */

export type PromptMode = "stdin" | "arg" | "file";

export interface CliAdapterSpec {
  id: CliAdapter;
  label: string;
  /** Command names to look for (without extension). */
  binaries: readonly string[];
  versionArgs: readonly string[];
  /** Default arguments for non-interactive autonomous execution. */
  defaultArgs: readonly string[];
  /** How the prompt is handed to the process. */
  promptMode: PromptMode;
  /** Extra arguments carrying the `{PROMPT}` / `{PROMPT_FILE}` placeholder. */
  promptArgs: readonly string[];
  /** Converts the selected model into a CLI argument; an empty model produces no argument. */
  modelArgs: (model: string) => string[];
  /** Orchestration role suggested for this CLI during discovery. */
  defaultRole: OrchestrationRole;
  silenceSeconds: number;
  /** Environment variables required for autonomous execution. */
  env?: Readonly<Record<string, string>>;
}

const noModelArgs = (): string[] => [];

export const CLI_ADAPTER_SPECS: Readonly<Record<Exclude<CliAdapter, "custom">, CliAdapterSpec>> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    binaries: ["claude", "claude-code"],
    versionArgs: ["--version"],
    // `acceptEdits`: file edits are applied without asking, while dangerous shell commands
    // still require approval. `bypassPermissions` is deliberately not used; isolation and
    // the approval gate are our layer's job, not a reason to disable all of the CLI's guards.
    defaultArgs: ["-p", "--output-format", "json", "--permission-mode", "acceptEdits"],
    promptMode: "stdin",
    promptArgs: [],
    // Not duplicated when the profile already carries an explicit `--model`/`-m`; that check lives in effectiveArgs.
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.claude,
  },
  codex: {
    id: "codex",
    label: "Codex CLI",
    binaries: ["codex"],
    versionArgs: ["--version"],
    // `workspace-write`: model commands can write inside the working directory but not outside it.
    // `danger-full-access` is deliberately not used.
    defaultArgs: ["exec", "--skip-git-repo-check", "--sandbox", "workspace-write"],
    promptMode: "arg",
    promptArgs: ["{PROMPT}"],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.codex,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    binaries: ["gemini"],
    versionArgs: ["--version"],
    defaultArgs: ["--yolo"],
    promptMode: "arg",
    promptArgs: ["-p", "{PROMPT}"],
    // The Gemini CLI uses its own default model; there is no catalogue support.
    modelArgs: noModelArgs,
    defaultRole: "reviewer",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.gemini,
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    binaries: ["opencode"],
    versionArgs: ["--version"],
    defaultArgs: ["run"],
    promptMode: "file",
    promptArgs: ["{PROMPT_FILE}"],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "executor",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.opencode,
    env: { OPENCODE_PERMISSION_MODE: "auto" },
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity CLI",
    binaries: ["antigravity"],
    versionArgs: ["--version"],
    defaultArgs: ["--non-interactive"],
    promptMode: "stdin",
    promptArgs: [],
    modelArgs: (model) => (model === "" ? [] : ["--model", model]),
    defaultRole: "planner",
    silenceSeconds: ADAPTER_SILENCE_SECONDS.antigravity,
  },
};

export function specFor(adapter: CliAdapter | undefined): CliAdapterSpec | undefined {
  if (adapter === undefined || adapter === "custom") return undefined;
  return CLI_ADAPTER_SPECS[adapter];
}

/** Whether the profile already passes an explicit model argument (prevents duplication). */
export function hasExplicitModelArg(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--model" || arg === "-m" || arg.startsWith("--model="));
}

export interface EffectiveInvocation {
  args: string[];
  promptMode: PromptMode;
  silenceSeconds: number;
  env: Readonly<Record<string, string>>;
}

/**
 * Builds the arguments to execute from an agent profile.
 *
 * Model precedence: **agent override > CLI-wide setting > CLI default**.
 * Nothing is added when the profile carries an explicit model argument.
 */
export function effectiveInvocation(input: {
  adapter: CliAdapter | undefined;
  profileArgs: readonly string[];
  /** Agent override model, when present. */
  agentModel: string;
  /** `cliSettings[adapter].model`. */
  globalModel: string;
}): EffectiveInvocation {
  const spec = specFor(input.adapter);
  if (spec === undefined) {
    return {
      args: [...input.profileArgs],
      promptMode: "stdin",
      silenceSeconds: ADAPTER_SILENCE_SECONDS.custom,
      env: {},
    };
  }

  const base = input.profileArgs.length > 0 ? [...input.profileArgs] : [...spec.defaultArgs];
  const model = input.agentModel !== "" ? input.agentModel : input.globalModel;
  const modelArgs = hasExplicitModelArg(base) ? [] : spec.modelArgs(model);

  return {
    args: [...base, ...modelArgs, ...spec.promptArgs],
    promptMode: spec.promptMode,
    silenceSeconds: spec.silenceSeconds,
    env: spec.env ?? {},
  };
}

/**
 * Fills the prompt placeholders with real values.
 * Adapters that use `{PROMPT_FILE}` are given a temporary file path.
 */
export function materializePrompt(
  args: readonly string[],
  prompt: string,
  promptFilePath: string | null,
): string[] {
  return args.map((arg) =>
    arg.replace("{PROMPT}", prompt).replace("{PROMPT_FILE}", promptFilePath ?? ""),
  );
}

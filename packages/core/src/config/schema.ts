import { z } from "zod";
import type { ConnectionPreference } from "../providers/connection";

/**
 * The NEXCODE runtime configuration contract.
 *
 * `resources/nexcode.config.default.json` is the shareable template and is committed to the
 * repository; the personal `config.json` is produced in the user data directory and never
 * enters Git.
 *
 * `normalizeConfig()` is **pure and idempotent**: it always returns the same output for the
 * same input, never mutates the input, and applying it to its own output changes nothing.
 * When this contract changes, these files have to be handled together: `config/defaults.ts`,
 * `resources/nexcode.config.default.json`, the settings UI and `config/schema.test.ts`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Execution policy: sets the speed and quality budget of a task. */
export const EXECUTION_MODES = ["auto", "fast", "balanced", "deep"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** The kinds of work the operator can hand to a specialist. */
export const ASSIGNMENT_KINDS = ["plan", "implement", "review", "research"] as const;
export type AssignmentKind = (typeof ASSIGNMENT_KINDS)[number];

/** Orchestration role: BINDING determination of which kind of work it can take. */
export const ORCHESTRATION_ROLES = ["operator", "planner", "executor", "reviewer"] as const;
export type OrchestrationRole = (typeof ORCHESTRATION_ROLES)[number];

/**
 * Role to allowed kind of work. This mapping is binding: even if the operator produces a
 * wrong pairing, the engine moves the assignment to a suitable role. Legacy capability
 * values in a profile cannot widen that boundary.
 */
export const ALLOWED_KINDS: Readonly<Record<OrchestrationRole, readonly AssignmentKind[]>> = {
  operator: [],
  planner: ["plan", "research"],
  executor: ["implement"],
  reviewer: ["review"],
};

/** Known CLI adapters; unrecognised commands become `custom`. */
export const CLI_ADAPTERS = ["claude", "codex", "gemini", "opencode", "antigravity", "custom"] as const;
export type CliAdapter = (typeof CLI_ADAPTERS)[number];

/**
 * CLI brand colours: the SINGLE standard across the four visual surfaces (Command Center,
 * Board, Live Code, Team Flow). Running and error states are conveyed by separate cues
 * rather than by colour.
 */
export const CLI_COLOR: Readonly<Record<CliAdapter, string>> = {
  codex: "#10a37f",
  claude: "#d97757",
  gemini: "#4285f4",
  opencode: "#0ea5e9",
  antigravity: "#a855f7",
  custom: "#6b7280",
};

/**
 * Silence limit per adapter (seconds). When a CLI produces no new output for this long, the
 * delegation is classified as stalled: that does NOT mean the process never ran, and the
 * progress recorded up to that point is preserved.
 */
export const ADAPTER_SILENCE_SECONDS: Readonly<Record<CliAdapter, number>> = {
  codex: 180,
  gemini: 180,
  claude: 240,
  opencode: 300,
  antigravity: 240,
  custom: 300,
};

/**
 * Connection preference: API key, CLI subscription, or CLI that falls back to the API once
 * the quota runs out. The single source of truth is `providers/connection.ts`; the type
 * check below keeps the two from diverging.
 */
const CONNECTION_PREFERENCE_VALUES = ["api_only", "cli_only", "cli_first"] as const;
type ConnectionPreferenceCheck = ConnectionPreference extends (typeof CONNECTION_PREFERENCE_VALUES)[number]
  ? (typeof CONNECTION_PREFERENCE_VALUES)[number] extends ConnectionPreference
    ? true
    : never
  : never;
const _connectionPreferencesInSync: ConnectionPreferenceCheck = true;
void _connectionPreferencesInSync;

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

const modelRefSchema = z.object({
  provider: z.string().min(1),
  modelId: z.string().min(1),
});

const agentProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  /** Orchestration role: the source of the allowed kind of work (ALLOWED_KINDS). */
  role: z.enum(ORCHESTRATION_ROLES),
  /** NexCode domain agent (ceo/frontend/backend/security/qa/devops); absent for discovered CLIs. */
  domain: z.string().optional(),
  /** Role prompt file: resolved under `resources/roles/<lang>/`. */
  roleFile: z.string().default("executor.md"),
  connection: z.enum(CONNECTION_PREFERENCE_VALUES).default("cli_first"),
  autonomy: z.enum(["manual", "supervised", "autonomous"]).default("supervised"),
  /** Model used in API mode; when left empty the agent default applies. */
  model: modelRefSchema.optional(),
  /**
   * `true` when the user selected the model explicitly. Without this flag, a model suggestion
   * written by automatic discovery CANNOT override the global CLI setting.
   */
  modelOverride: z.boolean().default(false),
  /** Command to run in CLI mode (populated for discovered agents). */
  cmd: z.string().optional(),
  args: z.array(z.string()).default([]),
  adapter: z.enum(CLI_ADAPTERS).optional(),
  /** Whether it was created by automatic discovery: deleting it adds it to the hidden list. */
  discovered: z.boolean().default(false),
});

const scheduleTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("interval"), everyMinutes: z.number().int().min(1) }),
  z.object({ type: z.literal("daily"), at: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({
    type: z.literal("weekly"),
    at: z.string().regex(/^\d{2}:\d{2}$/),
    days: z.array(z.number().int().min(0).max(6)).min(1),
  }),
]);

const scheduleSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  targetDir: z.string().optional(),
  operatorAgentId: z.string().optional(),
  executionMode: z.enum(EXECUTION_MODES).default("auto"),
  trigger: scheduleTriggerSchema,
  enabled: z.boolean().default(true),
  createdAt: z.string(),
  lastRunAt: z.string().nullable().default(null),
  nextRunAt: z.string().nullable().default(null),
  lastTaskId: z.string().nullable().default(null),
});

const cliModelSettingSchema = z.object({
  model: z.string().default(""),
  reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  serviceTier: z.string().optional(),
  /**
   * When no model is written explicitly, these patterns are tried in order and the FIRST
   * match is used; `*` is the wildcard. Provider names differ from person to person.
   */
  modelPreferences: z.array(z.string()).default([]),
  /** Providers not to assume are reachable (delete the line if you use a local server). */
  modelExclude: z.array(z.string()).default([]),
});

export const nexcodeConfigSchema = z
  .object({
    /** Schema version, for forward-only migration. */
    version: z.number().int().min(1).default(1),

    /** Interface language; `system` uses the operating system language, falling back to EN. */
    language: z.enum(["system", "en", "tr"]).default("system"),

    /** `auto` executes the plan directly; `ask` sends a risky plan to human approval. */
    approvalMode: z.enum(["auto", "ask"]).default("auto"),
    /** Default working directory; `.` is the folder the application opened. */
    workingDir: z.string().default("."),

    /** Daily ceiling on total model calls (budget protection). */
    dailyCallBudget: z.number().int().min(1).default(150),
    /** How long the engine waits while the queue is empty (seconds). */
    pollSeconds: z.number().int().min(1).default(15),

    memoryCharBudget: z.number().int().min(0).default(8000),
    teamContextCharBudget: z.number().int().min(0).default(30000),
    /**
     * When the user task text exceeds this limit (for example a 1000+ line spec), the full
     * text is written to `.nexcode/TASK-<id>.md` in the working directory, and only a head
     * plus tail summary and a "read the full text from the file" marker are embedded into the
     * prompt. This keeps the strict JSON operator protocol intact on large text and stops
     * context from being cut silently.
     */
    taskPromptCharBudget: z.number().int().min(500).default(6000),

    /** Total time ceiling of a delegation (seconds). */
    agentTimeoutSeconds: z.number().int().min(30).default(900),
    /** How long without new output before a delegation is terminated (seconds). */
    cliSilenceTimeoutSeconds: z.number().int().min(30).default(300),

    /** Autonomous execution consent: while this is null the engine cannot start. */
    autonomousConsentAcceptedAt: z.string().nullable().default(null),
    /** Automatic adapters the user deleted; they are not recreated on the next scan. */
    discoveryIgnoredAdapters: z.array(z.string()).default([]),

    /** Whether the live line diff (the Live Code surface) is on, and its scan interval. */
    liveDiff: z.boolean().default(true),
    liveDiffIntervalMs: z.number().int().min(500).default(2500),

    /** Automatic pre-task checkpoint and how many versions to keep. */
    versioning: z.boolean().default(true),
    versioningRetention: z.number().int().min(1).default(20),

    /**
     * Agent jail. `workspace` means the agent can only write inside the working directory;
     * writing outside it is blocked (Docker and Git are NOT required). `off` means
     * unrestricted. `extraWritableDirs` are absolute paths outside the working directory
     * that are allowed, for monorepos.
     */
    sandbox: z
      .object({
        mode: z.enum(["workspace", "off"]).default("workspace"),
        extraWritableDirs: z.array(z.string()).default([]),
      })
      .default({}),

    /**
     * Per-task git worktree isolation.
     *
     * In `task` mode the task runs in its own worktree and its own branch without touching
     * the main working tree at all; on delivery the work is committed to the branch. Nothing
     * is sent to a remote. `off` is the default and preserves the behaviour exactly.
     */
    worktree: z
      .object({
        mode: z.enum(["off", "task"]).default("off"),
        branchPrefix: z.string().default("nexcode/"),
        /** Setup commands to run after the isolated tree is created (for example installing dependencies). */
        setupCommands: z.array(z.string()).default([]),
        /**
         * Paths to bind into the isolated tree that do not belong in the repository (for
         * example `node_modules`, `.env`). Absolute paths and `..` escapes are dropped during
         * normalisation.
         */
        linkPaths: z.array(z.string()).default([]),
        commit: z.boolean().default(true),
        /** The isolated tree of a failed task is kept so it can be inspected. */
        keepOnFailure: z.boolean().default(true),
        setupTimeoutSeconds: z.number().int().min(10).default(600),
      })
      .default({}),

    /**
     * Verification gate. After the assignments of each round finish, these commands run
     * fail-fast in the working directory and the result is handed to the operator as
     * evidence. A red gate closes the delivery shortcuts. While `commands` is empty the gate
     * never runs (opt-in).
     */
    verify: z
      .object({
        commands: z.array(z.string()).default([]),
        timeoutSeconds: z.number().int().min(5).default(600),
        maxOutputChars: z.number().int().min(200).default(6000),
        blockOnFailure: z.boolean().default(true),
        /** A red gate blocks delivery at most this many times; after that it delivers with a warning. */
        maxAttempts: z.number().int().min(1).default(2),
      })
      .default({}),

    /**
     * How many tasks run at once. A value above 1 requires `worktree.mode: "task"`; without
     * isolation, parallel tasks corrupt each other's working tree.
     */
    maxConcurrentTasks: z.number().int().min(1).max(8).default(1),

    /** Outbound MCP server: exposes NEXCODE to other coding agents as a tool. */
    mcpServer: z
      .object({
        /** Allow an external client to start and stop the engine. */
        allowEngineControl: z.boolean().default(false),
      })
      .default({}),

    /**
     * The `.nexcode/CONTEXT.md` project profile of each working directory is loaded to the
     * operator when a task opens (so it does not have to scan all the code again); at the end
     * of the task the operator REVISES the profile (it is not a changelog). `false` restores
     * the old global memory behaviour.
     */
    projectContext: z.boolean().default(true),
    projectContextCharBudget: z.number().int().min(0).default(6000),

    /** On task completion or failure, `{text,…}` is POSTed to the webhook (Slack compatible). */
    notify: z
      .object({
        webhookUrl: z.string().default(""),
        onComplete: z.boolean().default(true),
        onFailed: z.boolean().default(true),
      })
      .default({}),

    operator: z
      .object({
        /** The agent profile acting as operator (empty means the first suitable `operator` role). */
        agentId: z.string().default(""),
        /** The operator role is fixed; the user can edit its content but the file name does not change. */
        roleFile: z.literal("operator.md").default("operator.md"),
        maxRounds: z.number().int().min(1).default(6),
        maxDelegationsPerRound: z.number().int().min(1).default(8),
        maxInfrastructureRecoveryRounds: z.number().int().min(0).default(2),
        protocolRetries: z.number().int().min(0).default(2),
        /**
         * When every assignment of the round completed and the most recent review is PASS,
         * skip the second operator evaluation call. `false` forces the older, more expensive
         * evaluation path.
         */
        passFastPath: z.boolean().default(true),
      })
      .default({}),

    /**
     * On a transient provider error (rate limit, overload, network) the delegation is retried
     * with the same agent using exponential backoff; on a permanent error the work is handed
     * to a healthy agent with the same capability. Going back to the operator and spending a
     * new planning round is the last resort.
     */
    resilience: z
      .object({
        transientRetries: z.number().int().min(0).default(2),
        retryBaseSeconds: z.number().int().min(1).default(3),
        maxFailoverAgents: z.number().int().min(0).default(1),
      })
      .default({}),

    /**
     * CLI-wide model policy. Precedence: agent override > the value here > the CLI default.
     * An empty model uses the CLI's own account or organisation default.
     */
    cliSettings: z
      .object({
        claude: cliModelSettingSchema.default({}),
        codex: cliModelSettingSchema.default({}),
        gemini: cliModelSettingSchema.default({}),
        opencode: cliModelSettingSchema.default({}),
        antigravity: cliModelSettingSchema.default({}),
      })
      .default({}),

    /**
     * Only the skills in the `enabled` list are scanned. The operator sees a task-scoped
     * shortlist rather than the whole catalogue; a specialist reads the full guide from the
     * file only when needed. On first setup the list is filled with every bundled skill.
     */
    skills: z
      .object({
        enabled: z.array(z.string()).default([]),
        autoMatch: z.boolean().default(true),
        catalogLimit: z.number().int().min(1).default(12),
        maxSkillsPerAssignment: z.number().int().min(0).default(3),
        charBudget: z.number().int().min(0).default(2400),
        referenceCharBudget: z.number().int().min(0).default(1200),
      })
      .default({}),

    /** Agent profiles: id to profile. The 6 domain agents plus the discovered CLIs. */
    agents: z.record(agentProfileSchema).default({}),

    /** Scheduled tasks. */
    schedules: z.array(scheduleSchema).default([]),

    /**
     * QA escalation chain: tried in order from cheap to expensive. A simple task is solved at
     * the cheapest tier and only moves up when it has to.
     */
    escalation: z
      .object({
        qa: z.array(modelRefSchema).default([]),
      })
      .default({}),

    /** CLI subscription quota: once the sliding window fills, `cli_first` agents fall back to the API. */
    quota: z
      .object({
        windowHours: z.number().min(0.5).default(5),
        maxCallsPerWindow: z.number().int().min(1).default(50),
      })
      .default({}),

    /**
     * A plan containing one of these strings goes to human approval while
     * `approvalMode: ask`. A plan placed in the approval queue is hashed; if the stored plan
     * changes, the approval is rejected.
     */
    riskyPatterns: z.array(z.string()).default([]),
  })
  .strip();

export type NexcodeConfig = z.infer<typeof nexcodeConfigSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type ScheduleTrigger = z.infer<typeof scheduleTriggerSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type CliModelSetting = z.infer<typeof cliModelSettingSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────────────

/** Known CLI names, used to derive the adapter from a `cmd` value. */
const CMD_TO_ADAPTER: ReadonlyArray<readonly [RegExp, CliAdapter]> = [
  [/(^|[\\/])claude(-code)?(\.(cmd|bat|exe))?$/i, "claude"],
  [/(^|[\\/])codex(\.(cmd|bat|exe))?$/i, "codex"],
  [/(^|[\\/])gemini(\.(cmd|bat|exe))?$/i, "gemini"],
  [/(^|[\\/])opencode(\.(cmd|bat|exe))?$/i, "opencode"],
  [/(^|[\\/])antigravity(\.(cmd|bat|exe))?$/i, "antigravity"],
];

/**
 * Derives the known adapter from a command name. A `cmd` carrying a known CLI name TAKES
 * PRECEDENCE over a conflicting `adapter` field in the profile: that way a broken profile
 * created on one machine (for example `adapter: claude` plus `cmd: codex`) does not run the
 * wrong CLI on another machine.
 */
export function adapterFromCmd(cmd: string | undefined): CliAdapter | undefined {
  if (!cmd) return undefined;
  const bare = cmd.trim().replace(/^["']|["']$/g, "");
  for (const [pattern, adapter] of CMD_TO_ADAPTER) {
    if (pattern.test(bare)) return adapter;
  }
  return undefined;
}

/** Whether a role can take a given kind of work (the binding contract). */
export function roleAllowsKind(role: OrchestrationRole, kind: AssignmentKind): boolean {
  return ALLOWED_KINDS[role].includes(kind);
}

/** The orchestration role that can take a given kind of work. */
export function roleForKind(kind: AssignmentKind): OrchestrationRole {
  if (kind === "review") return "reviewer";
  if (kind === "implement") return "executor";
  return "planner";
}

/** Silence limit by adapter (seconds); an unknown adapter counts as `custom`. */
export function silenceSecondsFor(adapter: CliAdapter | undefined): number {
  return ADAPTER_SILENCE_SECONDS[adapter ?? "custom"];
}

/**
 * Converts a raw config (hand-edited, from an older schema, or partly broken) into a valid
 * `NexcodeConfig`.
 *
 * PURE and IDEMPOTENT: the input is not mutated, and `normalize(normalize(x)) === normalize(x)`.
 *
 * The repairs applied:
 * - A known `cmd` overrides a conflicting `adapter` field and clears the stale model override.
 * - A `model` field on an automatically discovered profile that the user did not choose is
 *   dropped, so it cannot silently override the global CLI setting.
 * - `roleFile` is always consistent with the role; the operator role is pinned to `operator.md`.
 * - The agent record key and the `id` field are kept equal.
 */
export function normalizeConfig(raw: unknown): NexcodeConfig {
  const parsed = nexcodeConfigSchema.parse(raw ?? {});

  const agents: Record<string, AgentProfile> = {};
  for (const [key, profile] of Object.entries(parsed.agents)) {
    const derived = adapterFromCmd(profile.cmd);
    // A known command name overrides a conflicting adapter field.
    const adapterConflict = derived !== undefined && profile.adapter !== undefined && profile.adapter !== derived;
    const adapter = derived ?? profile.adapter;

    // On a conflict the stale model override is not carried over; on a discovered profile a
    // model the user did not choose cannot override the global CLI setting.
    const keepModel = profile.model !== undefined && !adapterConflict && (!profile.discovered || profile.modelOverride);

    agents[key] = {
      ...profile,
      id: key,
      ...(adapter !== undefined ? { adapter } : {}),
      ...(adapterConflict ? { args: [] } : {}),
      ...(keepModel ? {} : { model: undefined, modelOverride: false }),
      roleFile: profile.role === "operator" ? "operator.md" : defaultRoleFile(profile),
    };
  }

  const worktree = {
    ...parsed.worktree,
    branchPrefix: parsed.worktree.branchPrefix.trim() === "" ? "nexcode/" : parsed.worktree.branchPrefix,
    setupCommands: parsed.worktree.setupCommands.map((c) => c.trim()).filter((c) => c !== ""),
    // Linked paths cannot reach outside the working tree.
    linkPaths: dedupe(parsed.worktree.linkPaths.map((p) => p.trim()).filter(isContainedRelativePath)),
  };

  return {
    ...parsed,
    agents,
    worktree,
    verify: {
      ...parsed.verify,
      commands: parsed.verify.commands.map((c) => c.trim()).filter((c) => c !== ""),
    },
    // Parallelism without isolation causes data loss; fall to the safe side.
    maxConcurrentTasks: worktree.mode === "task" ? parsed.maxConcurrentTasks : 1,
    riskyPatterns: dedupe(parsed.riskyPatterns),
    discoveryIgnoredAdapters: dedupe(parsed.discoveryIgnoredAdapters),
    skills: { ...parsed.skills, enabled: dedupe(parsed.skills.enabled) },
  };
}

/** Pure check that rejects absolute paths and `..` escapes (does not depend on node:path). */
export function isContainedRelativePath(value: string): boolean {
  if (value === "") return false;
  // Unix root, Windows drive and UNC share.
  if (value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split(/[\\/]/).includes("..");
}

function defaultRoleFile(profile: AgentProfile): string {
  const expected = `${profile.role}.md`;
  // A custom role file written by the user is preserved; only another role's file is corrected.
  const isStandard = ORCHESTRATION_ROLES.some((role) => profile.roleFile === `${role}.md`);
  return isStandard ? expected : profile.roleFile;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

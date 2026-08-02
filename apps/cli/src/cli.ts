#!/usr/bin/env node
import { createContext, resolveDataDir } from "./context";
import { runTaskCommand, runStatusCommand, runRunCommand, runApprovalsCommand } from "./commands/tasks";
import { runDoctorCommand } from "./commands/doctor";
import { runMcpCommand } from "./commands/mcp";
import { runConsentCommand } from "./commands/consent";

/**
 * NEXCODE command line interface.
 *
 * Full orchestration without the desktop panel: queue a task, run the engine, inspect
 * status, approve risky plans and expose NEXCODE to another agent as an MCP tool.
 *
 * The panel and the CLI can share the same database (`NEXCODE_HOME`), so a task queued
 * from the terminal also shows up in the panel.
 */

const USAGE = `
NEXCODE runs the coding CLIs you already have as one operator-led team.

USAGE
  nexcode <command> [options]

COMMANDS
  task <goal>         Add a new task to the queue
  run                 Start the engine and work through the queue
  status              Show the queue and the engine status
  approvals           List risky plans awaiting approval and decide on them
  doctor              Check installed CLIs, configuration and readiness
  consent             Show and grant autonomous execution consent (required by the engine)
  mcp                 Expose NEXCODE as an MCP server (stdio)
  version             Print the version

OPTIONS
  --mode <auto|fast|balanced|deep>   Execution depth (default: auto)
  --dir <path>                       Working directory (default: current directory)
  --once                             run: exit once the queue drains
  --approve <id> | --reject <id>     approvals: apply the decision
  --accept | --revoke                consent: grant or revoke consent
  --json                             Print output as JSON

ENVIRONMENT
  NEXCODE_HOME   Data root (default: ~/.nexcode)

EXAMPLES
  npx nexcode doctor
  npx nexcode consent --accept
  npx nexcode task "add the avatar upload flow and write its tests" --mode balanced
  npx nexcode run --once
`;

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/** Parses the `--key value`, `--key=value` and `--flag` forms. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }

    const next = argv[i + 1];
    // If the next value is not a flag, it is this flag's value.
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }

  return { command: positional.shift() ?? "", positional, flags };
}

async function main(): Promise<number> {
  const { command, positional, flags } = parseArgs(process.argv.slice(2));

  if (command === "" || command === "help" || flags.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === "version" || flags.version === true) {
    process.stdout.write(`${readVersion()}\n`);
    return 0;
  }

  // The MCP stdio transport sets up its own context and reserves stdout for the protocol.
  if (command === "mcp") return await runMcpCommand();

  switch (command) {
    case "task":
      return runTaskCommand(positional, flags);
    case "run":
      return await runRunCommand(flags);
    case "status":
      return runStatusCommand(flags);
    case "approvals":
      return runApprovalsCommand(flags);
    case "doctor":
      return runDoctorCommand(flags);
    case "consent":
      return runConsentCommand(flags);
    default:
      process.stderr.write(`Unknown command: ${command}\n${USAGE}\n`);
      return 1;
  }
}

function readVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

// The command only runs when executed directly; importing this as a module
// (tests, embedded use) has no side effects.
if (require.main === module) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`Error: ${String(error)}\n`);
      process.exitCode = 1;
    });
}

export { createContext, resolveDataDir };

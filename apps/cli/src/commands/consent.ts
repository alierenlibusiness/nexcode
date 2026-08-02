import { createContext } from "../context";

/**
 * Autonomous execution consent.
 *
 * The engine cannot start without this consent. The desktop application collects it
 * through a consent dialog; without the panel the user has to run this command
 * explicitly. Consent is granted once and stored in the configuration with a timestamp.
 */

const NOTICE = `
Autonomous execution consent
============================

The NEXCODE engine runs your installed coding CLIs on YOUR behalf and with YOUR
permissions. Once you accept, the engine can:

  - Read, create, modify and delete files in the working directory
  - Invoke installed CLIs with your own session and your own quota
  - Run the verification commands you define (test, lint, build)
  - When enabled, open a git worktree and branch per task and commit to that branch

What the engine does NOT do on its own:

  - It sends nothing to a remote (no push, no PR)
  - A risky plan waits for your approval while approvalMode is "ask"
  - It takes a checkpoint before every task; undo is a single command

To accept: nexcode consent --accept
To revoke: nexcode consent --revoke
`;

export function runConsentCommand(flags: Record<string, string | boolean>): number {
  const ctx = createContext();
  const config = ctx.configRepo.load();

  if (flags.revoke === true) {
    ctx.configRepo.save({ ...config, autonomousConsentAcceptedAt: null });
    process.stdout.write("Autonomous execution consent revoked. The engine can no longer start.\n");
    return 0;
  }

  if (flags.accept === true) {
    const acceptedAt = new Date().toISOString();
    ctx.configRepo.save({ ...config, autonomousConsentAcceptedAt: acceptedAt });
    process.stdout.write(`Autonomous execution accepted (${acceptedAt}).\n\nTo start: nexcode run\n`);
    return 0;
  }

  process.stdout.write(NOTICE);
  if (config.autonomousConsentAcceptedAt !== null) {
    process.stdout.write(`\nStatus: accepted (${config.autonomousConsentAcceptedAt})\n`);
    return 0;
  }

  process.stdout.write("\nStatus: not accepted\n");
  // Not having consent is a requirement rather than an error; exit 1 so scripts can tell them apart.
  return 1;
}

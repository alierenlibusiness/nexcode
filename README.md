<div align="center">

# Git Worktree Isolation

**Agents get their own copy of the repository. Your working tree is never touched.**

</div>

---

## The problem

Letting an autonomous agent edit the directory you have open in your editor is how you end
up with half-written files during a rebase, a `git status` you cannot read, and no clean way
to tell what the agent changed from what you changed.

## What this branch adds

Every task gets its own git worktree and its own branch.

```
your-repo/                        <- untouched, yours
  .git/
  src/

userData/worktrees/<task-id>/     <- the agent's world
  src/                            <- full checkout of HEAD
  node_modules -> linked
```

```jsonc
{
  "worktree": {
    "mode": "task",
    "branchPrefix": "nexcode/",
    "setupCommands": ["pnpm install --frozen-lockfile"],
    "linkPaths": ["node_modules", ".env"],
    "commit": true,
    "keepOnFailure": true,
    "setupTimeoutSeconds": 600
  }
}
```

Turn it on and the delivery stops being a pile of edits in your checkout and becomes a branch
you can review, diff and merge like any other.

## What happens during a task

1. `git worktree add -b nexcode/task-<id> <path> HEAD`
2. `linkPaths` are symlinked in, so a fresh tree does not need a fresh `node_modules`
3. `setupCommands` run inside the isolated tree
4. The agent, the live diff, checkpoints and the verification gate all target that tree
5. On delivery, changes are staged and committed to the branch
6. The tree is removed; the branch and its commits stay

**Nothing is pushed.** No remote is contacted, no PR is opened. What happens to the branch
afterwards is your decision.

## The subtle part

The working directory and the project directory are not the same thing.

Agents work in the isolated tree. But the project profile (`.nexcode/CONTEXT.md`), which is
how NEXCODE remembers what a codebase is about across tasks, is read from and written to the
**original repository**. Write it into the worktree and it disappears when the worktree is
removed, silently, and the system quietly gets dumber over time.

The engine models this explicitly:

```ts
interface EngineTask {
  workingDir: string;   // isolated tree: agents, diffs, checkpoints, verification
  projectDir?: string;  // original repo: project profile lives here
}
```

## Failure behavior

Isolation never costs you a task. If git is missing, the directory is not a repository, or
HEAD has no commits, the setup emits a warning and the task runs in the main tree exactly as
it would have before.

If a task fails, `keepOnFailure` leaves the tree in place with its path reported, so you can
open it and see what the agent actually did.

Empty commits are never created. If a task changed nothing, that is reported instead.

## Safety

`linkPaths` entries are relative and contained. Absolute paths and `..` escapes are stripped
during config normalization, so a link target can never point outside the working tree.

## Files

```
packages/core/src/worktree/worktree.ts        setup, finalize, cleanup
packages/core/src/worktree/worktree.test.ts   26 tests, all against a fake git port
apps/desktop/src/process-ports.ts             real git execution
apps/desktop/src/engine-host.ts               task lifecycle wiring
```

The manager is pure: git runs through an injected port, so branch naming, fallback paths,
link handling, commit rules and cleanup are all tested without touching a real repository.

## Verify

```bash
pnpm test --filter worktree
```

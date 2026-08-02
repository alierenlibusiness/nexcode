# Contributing

## Setup

```bash
pnpm install
pnpm -r build      # core must build first, the apps depend on it
pnpm dev
```

## Before every PR

```bash
pnpm typecheck     # zero errors
pnpm lint
pnpm test
```

CI additionally runs an em dash scan, a dependency audit and a secret leak scan.

## Coding standards

- **Strict TypeScript.** `strict`, `noImplicitAny` and `noUncheckedIndexedAccess` are on.
  `any` is banned; use `JsonValue` at JSON boundaries.

- **Pure core, injected ports.** Logic in `packages/core` never touches processes, the
  filesystem or the database directly. Those arrive through interfaces, which is why the
  whole task lifecycle runs against fake agents in milliseconds. When you add a capability,
  define the port first.

- **Respect the package boundaries.** A module that depends on `node:*` cannot be added to
  the pure `@nexcode/core` index; it breaks the renderer build. Use the right subpath:
  `@nexcode/core/db`, `/providers`, `/mcp` or `/host`.

- **No em dashes.** Use a colon, a semicolon or parentheses instead.

- **Comments explain why.** The code already says what it does. A comment should say why it
  is written that way and which trap it avoids.

## Tests

- Unit tests are required for orchestration logic.
- Engine behavior is exercised end to end with fake agent processes. See
  `packages/core/src/engine/engine.test.ts` and `engine-verify.test.ts` for the pattern.
- If a behavior is a contract (for example "a red gate closes the fast path"), there must be
  a test that proves it. When the contract changes, the test changes with it.

## Working on the CLI

The published `nexcode` package bundles the core into a single file, so only one unscoped
package ships. Build and try it locally:

```bash
pnpm -r build
node apps/cli/dist/cli.js doctor
```

To verify the real installation path, pack it and install the tarball globally:

```bash
cd apps/cli
npm pack
npm install -g ./nexcode-0.1.0.tgz
nexcode doctor
```

## Commits

Conventional Commits:

```
feat(engine): add verification gate
fix(db): correct Dirent typing in checkpoint walker
docs: rewrite architecture invariants
```

## Changing an invariant

`docs/ARCHITECTURE.md` lists the contracts the system guarantees. If you change one, update
the document in the same PR and explain why in the commit body. When the document and the
code disagree, the code is right, which is exactly why the two must move together.

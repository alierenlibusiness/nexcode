<div align="center">

# Interface

**Four surfaces, one event stream. Watch a team of agents work in real time.**

</div>

---

## What this branch is about

Autonomous agents are unsettling when you cannot see them. The point of this interface is
that at any moment you know which agent is running, what it is writing, why the operator made
its last decision, and exactly what changed on disk.

## The surfaces

### Command Center

Everything you need to run the system in one screen: a goal composer with execution mode,
the queue, the live event stream, the approval card and engine controls.

KPIs across the top: rounds, delegations, active tasks, changed files, call budget.

### Board

Task lifecycle across four columns: Pending, Running, Completed, Failed. Running tasks are
pulled out of the queue snapshot using the engine's active ids and highlighted.

Cards are deliberately **not** draggable. Status is what the engine knows, not what you drag
it to. A board you can lie to is worse than no board.

### Live Code

Git-style diffs streaming as agents write. Per-file add and remove counts, hunk headers, real
line numbers on both sides, color-coded lines.

Files whose contents cannot be shown safely are listed with the reason instead of the body:

| Status | Shown |
|---|---|
| `binary` | "Binary file, contents not displayed" |
| `too-large` | "File exceeded the limit" |
| `redacted` | "Sensitive file, contents hidden for security" |
| `unreadable` | "File could not be read" |

`.env` files and credentials never render. Not truncated, not masked: never sent.

### Team Flow

The orchestration scene. An operator core at the center, agent nodes in orbit, data packets
animating along the links while work is in flight, and a chronological timeline beside it.

Agents are colored by their CLI brand. Inactive nodes dim rather than disappear, so you can
see who has worked on the task, not just who is working right now.

The scene is drawn with plain SVG. No WebGL library is loaded: it opens instantly, scales to
any window size, and stays smooth on machines without a discrete GPU.

## The event contract

All four surfaces read one stream, established once at the shell level. Switching surfaces
does not reconnect and cannot drop events.

The replay order matters:

```ts
// 1. Subscribe to the live stream FIRST.
const unsubscribe = api.onEngineEvent(apply);

// 2. Then pull history.
for (const event of await api.taskEvents(taskId)) apply(event);

// 3. `seq` is shared between history and live, so overlap deduplicates.
if (seen.has(event.seq)) return;
```

Do it the other way around and every event arriving during the replay is lost. It looks
correct in testing and quietly loses data under real load.

## Design decisions

**Raw stdout is not in the timeline.** Agent output chunks arrive as events but belong in a
terminal view, not an activity feed. The timeline shows what happened, not what was printed.

**Errors are shown, not swallowed.** Starting the engine without autonomy consent fails with
the actual reason next to the button.

**Stopping explains itself.** The stop control notes that in-flight work is not interrupted,
because a stop button that silently means "later" is a stop button people stop trusting.

## Files

```
apps/renderer/app/
  page.tsx                    shell and surface navigation
  lib/engine-store.ts         event stream, replay dedup, timeline projection
  components/CommandCenter.tsx
  components/BoardView.tsx
  components/LiveCodeView.tsx
  components/TeamFlowView.tsx
```

Built on Next.js static export, React 19 and Tailwind, loaded by Electron over a custom
`app://` protocol so absolute asset paths resolve correctly.

## Verify

```bash
pnpm --filter @nexcode/renderer build
pnpm dev
```

## License

MIT. See [`LICENSE`](LICENSE).

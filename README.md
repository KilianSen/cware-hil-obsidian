# cware-hil-obsidian

The Obsidian side of the **cware** human-in-the-loop stack: a sidebar panel that
shows pending questions from Claude Code agents (open questions, choices, approval
requests) with inline answer controls, plus a live dashboard of what your agents
are doing.

It connects over a WebSocket bridge to the hub
([cware-hil-mcp](https://github.com/KilianSen/cware-hil-mcp)); shared domain types
and the bridge protocol come from
[cware-hil-lib](https://github.com/KilianSen/cware-hil-lib) (a git dependency).

```
Claude Code agents ──HTTP /mcp──▶  hub (:22360)  ◀──ws /bridge──  this plugin
```

## Build

```bash
npm install
npm run build        # tsc typecheck + esbuild bundle -> main.js
npm run dev          # esbuild watch
```

## Install into a vault

Build, then copy the three plugin files into your vault and enable it under
*Community plugins*:

```bash
mkdir -p <vault>/.obsidian/plugins/cc-hitl
cp main.js manifest.json styles.css <vault>/.obsidian/plugins/cc-hitl/
```

Then in Obsidian → *Settings → Claude Code HITL*, set the **host**, **port**, and
**token** (from the hub: `cc-hitl token`, or the hub's `/setup` page). Open the
panel from the ribbon (message icon) or the *Open HITL panel* command.

## How it connects

The plugin opens `ws://<host>:<port>/bridge?token=<token>`, reconciles via a fresh
snapshot on every (re)connect, and reconnects with exponential backoff. Answers and
cancellations are sent back to the hub, which resolves the agent's blocking tool call.

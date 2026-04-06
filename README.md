# ClaudeBar

macOS menu bar app for tracking Claude AI token usage. Shows session, weekly, and Extra tier usage in a compact dropdown.

## Features

- ⚡ Lives in the macOS menu bar — no dock icon
- Shows session utilization (5h rolling window) and weekly usage
- Extra tier cost tracking
- Auto-refreshes every 5 minutes
- One-click login via `claude auth login` CLI
- Clean, minimal dark UI

## Install

```bash
# Build from source
npm install
npm run build

# Or download the latest .app from Releases
```

## Usage

1. Open the app
2. Click **⚡ → Login** in the menu bar
3. A browser opens to complete OAuth via Claude CLI
4. Approve in browser — the app auto-reads your token

## Build

```bash
npm install
npm run build
```

Output: `dist/mac-arm64/ClaudeBar.app`

## Tech

- Electron (no bundler — plain JS)
- No external runtime dependencies
- Token stored at `~/.config/usage-tracker/claude_token.json`

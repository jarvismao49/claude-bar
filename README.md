# ClaudeBar

macOS menu bar app for tracking Claude AI token usage. Shows session, weekly, and Extra tier usage in a compact dropdown.

## Features

- ⚡ Lives in the macOS menu bar — no dock icon
- Shows session utilization (5h rolling window) and weekly usage
- Extra tier cost tracking
- Auto-refreshes every 5 minutes
- Browser-based OAuth login — no Claude CLI required
- Clean, minimal dark UI

## Install

```bash
# Build from source
npm install
npm run build

# Or download the latest .app from Releases and move to /Applications/
```

## Usage

1. Open the app
2. Click **⚡ → Login** in the menu bar
3. A browser opens to claude.ai — log in there
4. Open DevTools (F12) → Network tab
5. Filter by `api/oauth/usage` → find the request → copy the `Bearer <token>` value from Request Headers
6. Paste the token into the login window → Save & Connect

No API keys, no CLI, no configuration needed on a new machine.

## Build

```bash
npm install
npm run build
```

Output: `dist/mac-arm64/ClaudeBar.app`

## Tech

- Electron (no bundler — plain JS)
- No external dependencies beyond Electron
- Token stored at `~/.config/usage-tracker/claude_token.json`

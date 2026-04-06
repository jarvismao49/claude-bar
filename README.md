# ClaudeBar

Menu bar app for Claude ( Anthropic ) usage tracking.

Shows your current session %, weekly %, and pace — right in the macOS menu bar.

---

## Install

1. Download the latest `.zip` from [Releases](https://github.com/jarvismao49/claude-bar/releases)
2. Unzip → move `ClaudeBar.app` to `/Applications/`
3. Open `ClaudeBar.app`
4. Click **⚡ → Login** — opens browser → approve → done

---

## Features

**Usage tracking**
- Session % and weekly % from Claude API (reads `~/.claude/.credentials.json`)
- Falls back to `claude /usage` CLI if OAuth token is stale
- Pace tracking — "On pace", "Runs out in Xh Ym", "X% reserve"

**Local cost scanning**
- Scans `~/.config/claude/projects/**/*.jsonl` for Claude Code session data
- Shows local token totals and session count in the menu and Settings

**Settings** (⚡ → Settings)
- Poll interval: 1 / 2 / 5 / 15 / 30 minutes
- Display mode: % remaining or % used
- Launch at login (macOS LoginItems)
- Local cost rescan
- 14-day usage history chart with avg / peak / low

**Auto-update**
- Checks GitHub releases on startup
- Shows update banner in menu if a new version is available

---

## Data sources

| Source | What | Where |
|--------|------|-------|
| OAuth API | Session %, weekly % | Primary — always fresh |
| `claude /usage` CLI | Same | Fallback when OAuth fails |
| `~/.config/claude/projects/**/*.jsonl` | Local token counts | Claude Code sessions |

---

## Architecture

```
src/
  index.js      — Electron main process, tray, polling, OAuth, CLI fallback
  preload.js   — contextBridge IPC (settings, data, costs, history)
  providers/
    anthropic.js  — OAuth token + API calls
    openai.js     — stub
    minimax.js    — stub
  settings.html — Settings window UI
  login.html    — Login window UI
```

---

## Build from source

```bash
npm install
npm start       # dev mode
npm run build   # packaged app → dist/mac-arm64/
```

---

## Release history

- **v1.3.0** — Local costs in menu, 30-day history chart, auto-update banner
- **v1.2.0** — Auto-start, local scanner, settings window, cost history
- **v1.1.0** — Token refresh, CLI fallback, pace tracking
- **v1.0.1** — Login flow, 18px icon

# TODO — ClaudeBar

## P0 — Must have
- [x] Menu bar icon (18x18 .png)
- [x] Poll Anthropic `/v1/dashboard/billing/subscription` for plan limits
- [x] Poll `/v1/billing/credit_summary` for credit balance
- [x] Show session %, weekly %, credit balance in menu
- [x] Login flow — OAuth via `claude auth login` (open browser, save token)
- [x] Token refresh — read fresh token from `~/.claude/.credentials.json` on every poll
- [x] CLI fallback — `claude /usage` via PTY when OAuth fails
- [x] Pace tracking — On pace / Runs out in Xh Ym / X% reserve
- [x] Settings window — poll interval, display mode, login item toggle
- [x] Auto-start on login — macOS LoginItems via Electron `setLoginItemSettings`
- [x] Local cost scanning — parse `~/.config/claude/projects/**/*.jsonl` for Claude Code tokens
- [x] Robust error states — exponential backoff, error source labeled in menu

## P1 — Should have
- [x] 512x512 app icon for Finder/Dock
- [x] Cost history — daily snapshots in `~/.config/usage-tracker/history.json`
- [x] Auto-update checker — queries GitHub releases on startup, shows update banner
- [x] Settings window — poll interval, display mode, login item, local costs display + rescan
- [x] Settings window — 14-day history chart with avg/peak/low stats

## P2 — Nice to have
- [x] Local costs row in menu itself (not just settings)
- [ ] Sparkle auto-update integration (requires code signing + update server)
- [ ] OpenAI provider stub
- [ ] MiniMax provider stub
- [ ] Multiple account detection (if multiple tokens in credentials)
- [ ] Keyboard shortcut to toggle the bar

## Known issues
- LoginItems API silently fails in dev mode (only works in packaged app) — expected behavior
- Notarization skipped (requires paid Apple Developer account) — app still runs fine in dev/packaged mode

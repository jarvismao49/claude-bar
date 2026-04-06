# ClaudeBar — Development Roadmap

## v1.0.0
- Initial release — basic Electron menu bar app with OAuth usage API
- ⚠️ Issues: token refresh broken, no CLI fallback, no pace tracking

---

## Phase 1 — v1.1.0 (P0: Token refresh, CLI fallback, pace tracking)

### P0-1: Token Refresh
- [x] Read `~/.claude/.credentials.json` on every poll (like CodexBar)
- [x] Add refresh token support — POST to `/oauth/token` with `grant_type=refresh_token`
- [x] Detect 401 → attempt refresh → retry

### P0-2: CLI Fallback
- [x] When OAuth fails, spawn `claude /usage` via PTY (child_process with script trick)
- [x] Parse `/usage` output for session %, weekly %, reset time
- [x] Handle CLI not installed error gracefully

### P0-3: Pace Tracking
- [x] Calculate pace: (time_elapsed/window_duration) vs (usage_used/budget)
- [x] Show "on pace" / "X% deficit" / "X% reserve"
- [x] Show "runs out in Xh Ym" countdown when in deficit

---

## Phase 2 — v1.2.0 (P1: Settings window, auto-start, local cost, error states)

### P1-1: Settings Window
- [ ] Electron BrowserWindow settings panel
- [ ] Poll interval selector (1m / 2m / 5m / 15m / 30m)
- [ ] Display mode (percent remaining / percent used)
- [ ] Save to config.json

### P1-2: Auto-start on Login
- [ ] macOS LoginItems via Electron's `app.setLoginItemSettings`
- [ ] Toggle in settings

### P1-3: Local Cost Scanning
- [ ] Parse `~/.config/claude/projects/**/*.jsonl`
- [ ] Extract `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`
- [ ] Deduplicate streaming chunks by `message.id`
- [ ] Store and display as secondary "Local Cost" row

### P1-4: Robust Error States
- [ ] Dim icon when last refresh failed
- [ ] Show error indicator in menu
- [ ] Retry with exponential backoff on network errors

---

## Phase 3 — v1.3.0 (P2: Keychain, multi-account, Sparkle, history)

### P2-1: Keychain Cookie Import
- [ ] Use `node-keytar` to access macOS Keychain
- [ ] Import `sessionKey` from Safari/Chrome for web API fallback

### P2-2: Multi-account Support
- [ ] Read multiple tokens from `~/.claude/.credentials.json` if multiple accounts exist
- [ ] Stack account rows in menu

### P2-3: Sparkle Auto-update
- [ ] Add `electron-updater` / `sparkle` for built-in updates
- [ ] Update release workflow

### P2-4: Cost History
- [ ] Store daily usage snapshots in `~/.config/usage-tracker/history.json`
- [ ] Keep last 90 days
- [ ] Future: trend charts in settings window

---

## Provider Roadmap (Future)
- OpenAI API usage
- MiniMax API usage
- Unified multi-provider menu

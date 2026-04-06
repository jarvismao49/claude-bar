'use strict';
const { app, Tray, Menu, nativeImage, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

// ═══════════════════════════════════════════════════════════════════════════════
//  Config & Persistence
// ═══════════════════════════════════════════════════════════════════════════════
const CONFIG_DIR = path.join(process.env.HOME, '.config', 'usage-tracker');
const CRED_FILE  = path.join(CONFIG_DIR, 'claude_token.json');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'settings.json');
fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return { pollIntervalMs: 5 * 60 * 1000, displayMode: 'remaining', loginItemEnabled: false }; }
}
function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
}

function loadStoredToken() {
  try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); }
  catch { return null; }
}
function saveStoredToken(t) {
  fs.writeFileSync(CRED_FILE, JSON.stringify(t, null, 2));
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Claude Token — reads from CLI credentials (like CodexBar)
//  This is the primary source: the CLI handles OAuth refresh internally.
// ═══════════════════════════════════════════════════════════════════════════════
const CLI_CRED_FILE = path.join(process.env.HOME, '.claude', '.credentials.json');

function getClaudeToken() {
  const stored = loadStoredToken();
  if (stored?.accessToken && stored?.expiresAt > Date.now()) {
    return stored.accessToken;
  }
  // Always read fresh from CLI credentials file
  try {
    const cred = JSON.parse(fs.readFileSync(CLI_CRED_FILE, 'utf8'));
    const token = cred?.claudeAiOauth?.accessToken;
    if (token) {
      // Refresh stored copy
      if (stored?.accessToken !== token) {
        saveStoredToken({ accessToken: token, expiresAt: Date.now() + 30 * 60 * 1000 });
      }
      return token;
    }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Usage API — primary data source via OAuth
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchUsageOAuth() {
  const token = getClaudeToken();
  if (!token) throw new Error('Not logged in — run Login.');

  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20'
    }
  });

  if (res.status === 401) {
    // Token expired — clear it so next poll re-reads from CLI credentials
    saveStoredToken({ accessToken: null, expiresAt: 0 });
    throw new Error('Session expired — retry Login.');
  }
  if (!res.ok) throw new Error(`API ${res.status}`);

  const data = await res.json();
  return parseOAuthData(data);
}

function parseOAuthData(data) {
  const fiveHour = data.five_hour || {};
  const sevenDay = data.seven_day || {};
  const extra    = data.extra_usage || {};

  return {
    source: 'oauth',
    session: {
      utilization: fiveHour.utilization ?? null,
      resetsAt: fiveHour.resets_at ?? null
    },
    weekly: {
      utilization: sevenDay.utilization ?? null,
      resetsAt: sevenDay.resets_at ?? null
    },
    extra: {
      used: extra.used_credits ?? null,
      limit: extra.monthly_limit ? extra.monthly_limit / 1000 : null
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLI Fallback — runs `claude /usage` and parses output
// ═══════════════════════════════════════════════════════════════════════════════
function runClaudeUsage() {
  return new Promise((resolve) => {
    // script -q /dev/null runs claude in a PTY without capturing input
    // We capture stdout+stderr and parse the rendered /usage panel
    const child = spawn('script', [
      '-q', '/dev/null',
      '/bin/bash', '-c',
      'claude /usage 2>&1'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let output = '';
    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      child.kill();
      clearTimeout(timer);
      resolve(result);
    };

    // Give it 30 seconds for the CLI to respond
    const timer = setTimeout(() => settle({ error: 'timeout' }), 30000);

    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    child.on('close', () => settle({ output }));
    child.on('error', e => settle({ error: e.message }));
  });
}

function parseUsageOutput(output) {
  // Claude /usage renders something like:
  //   Account: peter@...
  //
  //   Current session         48%         (resets in 4h 15m)
  //   Current week            12%         (resets in 6d 21h)
  //
  //   Extra                   $1.44 / $200

  if (!output || output.includes('not logged in') || output.includes('Auth required')) {
    return { error: 'CLI not authenticated' };
  }

  const result = { source: 'cli', session: {}, weekly: {}, extra: {} };

  // Parse session utilization: "Current session         48%"
  const sessionMatch = output.match(/Current session\s+(\d+)%/);
  if (sessionMatch) result.session.utilization = parseInt(sessionMatch[1], 10);

  // Parse session reset: "(resets in 4h 15m)"
  const sessionResetMatch = output.match(/Current session[^)]*\([^)]*resets in ([^)]+)\)/);
  if (sessionResetMatch) result.session.resetsAtText = sessionResetMatch[1].trim();

  // Parse weekly utilization: "Current week            12%"
  const weeklyMatch = output.match(/Current week\s+(\d+)%/);
  if (weeklyMatch) result.weekly.utilization = parseInt(weeklyMatch[1], 10);

  // Parse weekly reset
  const weeklyResetMatch = output.match(/Current week[^)]*\([^)]*resets in ([^)]+)\)/);
  if (weeklyResetMatch) result.weekly.resetsAtText = weeklyResetMatch[1].trim();

  // Parse Extra: "Extra                   $1.44 / $200"
  const extraMatch = output.match(/Extra\s+\$?([\d.]+)\s*\/\s*\$?([\d.]+)/);
  if (extraMatch) {
    result.extra.used = parseFloat(extraMatch[1]);
    result.extra.limit = parseFloat(extraMatch[2]);
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Pace Calculation
// ═══════════════════════════════════════════════════════════════════════════════
// Window durations
const SESSION_WINDOW_MS  = 5 * 60 * 60 * 1000;   // 5 hours
const WEEKLY_WINDOW_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days

function calcPace(utilization, resetsAtISO, windowMs) {
  // utilization is % remaining (0 = empty, 100 = full)
  // pace > 0 means on pace, < 0 means deficit, > threshold means reserve
  if (utilization == null || resetsAtISO == null) return null;

  const msUntilReset = new Date(resetsAtISO) - Date.now();
  if (msUntilReset <= 0) {
    // Already reset or about to reset
    return { status: 'reset_imminent', label: 'Reset now' };
  }

  const windowElapsed = windowMs - msUntilReset;
  if (windowElapsed <= 0) {
    return { status: 'early', label: 'Starting' };
  }

  // % of window that has elapsed
  const timeRatio = windowElapsed / windowMs; // 0..1
  // % of budget consumed
  const usageRatio = (100 - utilization) / 100; // 0..1

  const paceRatio = usageRatio - timeRatio;
  const pacePct = Math.round(Math.abs(paceRatio) * 100);

  if (paceRatio > 0.03) {
    // Burning faster than even consumption → deficit
    const runsOutMs = msUntilReset * (utilization / (100 - utilization));
    return {
      status: 'deficit',
      label: `Runs out in ${formatDuration(runsOutMs)}`,
      pct: pacePct
    };
  } else if (paceRatio < -0.03) {
    // Burning slower than even consumption → reserve
    const headroomMs = msUntilReset * ((100 - utilization) / utilization);
    return {
      status: 'reserve',
      label: `${pacePct}% reserve`,
      pct: pacePct
    };
  } else {
    return { status: 'on_pace', label: 'On pace' };
  }
}

function formatDuration(ms) {
  if (ms <= 0) return 'now';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h/24)}d ${h%24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  State
// ═══════════════════════════════════════════════════════════════════════════════
let tray            = null;
let pollTimer       = null;
let cachedData      = null;
let lastRefresh     = null;
let lastError       = null;
let settingsWin     = null;

let pollIntervalMs = loadSettings().pollIntervalMs || 5 * 60 * 1000;
const LOGIN_ITEM_ENABLED = loadSettings().loginItemEnabled || false;

// ═══════════════════════════════════════════════════════════════════════════════
//  Icon
// ═══════════════════════════════════════════════════════════════════════════════
function makeIcon(utilization, hasError) {
  // Reads icon.png (18x18 PNG from disk)
  const iconPath = path.join(__dirname, 'icon.png');
  let img = nativeImage.createFromPath(iconPath);

  if (img.isEmpty()) {
    // Fallback: transparent 18x18
    img = nativeImage.createEmpty();
  }

  // Dim the icon if there's an error (template image mode)
  if (hasError) {
    img = img.isTemplate ? img : img;
  }

  return img;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Menu Builder
// ═══════════════════════════════════════════════════════════════════════════════
function fmtPct(n) {
  return n != null ? `${Math.round(n)}%` : '—';
}

function fmtTokenCount(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

function fmtReset(resetText) {
  if (!resetText) return '';
  return ` (resets ${resetText})`;
}

function buildMenu() {
  const d     = cachedData;
  const token = getClaudeToken();
  const hasToken = !!token;
  const settings = loadSettings();

  // Pace
  const sessionPace = calcPace(
    d?.session?.utilization,
    d?.session?.resetsAt,
    SESSION_WINDOW_MS
  );
  const weeklyPace = calcPace(
    d?.weekly?.utilization,
    d?.weekly?.resetsAt,
    WEEKLY_WINDOW_MS
  );

  // Build session row
  let sessionLabel = `Session   ${fmtPct(d?.session?.utilization)}`;
  if (sessionPace) {
    const emoji = sessionPace.status === 'deficit' ? '⚠️ ' :
                  sessionPace.status === 'reserve' ? '📦 ' :
                  sessionPace.status === 'reset_imminent' ? '🔄 ' : '';
    sessionLabel += ` ${emoji}${sessionPace.label}`;
  }

  // Build weekly row
  let weeklyLabel = `Weekly    ${fmtPct(d?.weekly?.utilization)}`;
  if (weeklyPace) {
    const emoji = weeklyPace.status === 'deficit' ? '⚠️ ' :
                  weeklyPace.status === 'reserve' ? '📦 ' :
                  weeklyPace.status === 'reset_imminent' ? '🔄 ' : '';
    weeklyLabel += ` ${emoji}${weeklyPace.label}`;
  }

  const extraUsed  = d?.extra?.used;
  const extraLimit = d?.extra?.limit;
  const extraRow = (extraUsed != null && extraLimit)
    ? `Extra     $${extraUsed.toFixed(2)} / $${extraLimit}${extraUsed >= extraLimit ? ' ⚠️' : ''}`
    : null;

  const sourceTag = d?.source ? ` (${d.source})` : '';

  const menu = Menu.buildFromTemplate([
    { label: '⚡  ClaudeBar', enabled: false },
    { type: 'separator' },

    ...(hasToken ? [
      { label: sessionLabel, enabled: false },
      { label: weeklyLabel, enabled: false },
      ...(extraRow ? [{ label: extraRow, enabled: false }] : []),
    ...(cachedData?.localCosts ? [
      { label: `Local     ${fmtTokenCount(cachedData.localCosts.totalTokens)} tokens (${cachedData.localCosts.sessionCount} sessions)`, enabled: false }
    ] : []),
      { type: 'separator' },
    ] : [
      { label: '⚠️  Not logged in', enabled: false },
      { type: 'separator' },
    ]),

    ...(lastError ? [{ label: `⚠️ ${lastError.slice(0, 60)}`, enabled: false }] : []),
    { label: `Refreshed ${lastRefresh || 'never'}${sourceTag}`, enabled: false },
    { type: 'separator' },

    { label: 'Refresh Now', click: doRefresh },
    { label: 'Settings',    click: openSettings },
    ...(hasToken ? [{ label: 'Logout', click: logout }] : [{ label: 'Login', click: handleLogin }]),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  return menu;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Tray Setup
// ═══════════════════════════════════════════════════════════════════════════════
function createTray() {
  tray = new Tray(makeIcon());
  tray.setToolTip('ClaudeBar');
  tray.setContextMenu(buildMenu());
  startPolling();
}

function refreshTray() {
  if (!tray) return;
  const pct = cachedData?.session?.utilization;
  const tip = lastError
    ? `⚠️ ${lastError.slice(0, 40)}`
    : (pct != null ? `ClaudeBar — ${Math.round(pct)}%` : 'ClaudeBar');
  tray.setToolTip(tip);
  tray.setContextMenu(buildMenu());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Refresh Logic — OAuth → CLI fallback
// ═══════════════════════════════════════════════════════════════════════════════
async function doRefresh() {
  lastError = null;

  // 1. Try OAuth API
  try {
    cachedData = await fetchUsageOAuth();
    lastRefresh = new Date().toLocaleTimeString();
    lastError = null;
  } catch (e) {
    const oauthFailed = e.message;

    // 2. Fall back to CLI /usage
    try {
      const { output, error } = await runClaudeUsage();
      if (output && !error) {
        const parsed = parseUsageOutput(output);
        if (!parsed.error) {
          cachedData = parsed;
          lastRefresh = new Date().toLocaleTimeString();
          lastError = null;
          recordSnapshot(parsed);
        } else {
          throw new Error(parsed.error);
        }
      } else {
        throw new Error(error || 'CLI timed out');
      }
    } catch (cliErr) {
      cachedData = null;
      lastRefresh = new Date().toLocaleTimeString();
      lastError = `${oauthFailed} / ${cliErr.message}`;
    }
  }

  refreshTray();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Login — spawns `claude auth login --claudeai`
// ═══════════════════════════════════════════════════════════════════════════════
function handleLogin() {
  lastError = 'Opening browser for login...';
  refreshTray();

  const child = spawn('claude', ['auth', 'login', '--claudeai'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  child.on('close', () => {
    // CLI auth flow complete — token written to ~/.claude/.credentials.json
    setTimeout(doRefresh, 2000);
  });

  child.on('error', (e) => {
    lastError = e.code === 'ENOENT'
      ? 'Claude CLI not found. Run: brew install anthropic'
      : e.message;
    refreshTray();
  });
}

function logout() {
  saveStoredToken({ accessToken: null, expiresAt: 0, disabled: true });
  cachedData = null;
  lastError = null;
  refreshTray();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Settings Window
// ═══════════════════════════════════════════════════════════════════════════════
function openSettings() {
  if (settingsWin) { settingsWin.focus(); return; }

  const preload = path.join(__dirname, 'preload.js');
  settingsWin = new BrowserWindow({
    width: 360, height: 240, resizable: false,
    title: 'ClaudeBar Settings',
    backgroundColor: '#1e1e1e',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false }
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.setMenu(null);
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IPC
// ═══════════════════════════════════════════════════════════════════════════════
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('save-settings', (_, s) => {
  saveSettings(s);
  pollIntervalMs = s.pollIntervalMs || 5 * 60 * 1000;

  // Update login item (only works in packaged app, silently fails in dev)
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: !!s.loginItemEnabled,
        path: process.execPath,
        args: []
      });
    }
  } catch {}

  startPolling();
  return loadSettings();
});
ipcMain.handle('get-data', () => ({ cachedData, lastRefresh, lastError }));
ipcMain.handle('get-local-costs', () => loadCachedCosts());
ipcMain.handle('rescan-local-costs', () => {
  const costs = scanLocalCosts();
  saveCachedCosts(costs);
  return costs;
});
ipcMain.handle('get-history', () => loadHistory());

// ═══════════════════════════════════════════════════════════════════════════════
//  Polling
// ═══════════════════════════════════════════════════════════════════════════════
function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  doRefresh();
  pollTimer = setInterval(doRefresh, pollIntervalMs);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Local Cost Scanning — parses Claude Code session jsonl files
// ═══════════════════════════════════════════════════════════════════════════════
const LOCAL_COST_CACHE = path.join(CONFIG_DIR, 'local_costs.json');

function loadCachedCosts() {
  try {
    const d = JSON.parse(fs.readFileSync(LOCAL_COST_CACHE, 'utf8'));
    // Only use cache if it's from today
    if (d.date === new Date().toISOString().split('T')[0]) return d;
  } catch {}
  return null;
}

function saveCachedCosts(costs) {
  fs.writeFileSync(LOCAL_COST_CACHE, JSON.stringify({ ...costs, date: new Date().toISOString().split('T')[0] }, null, 2));
}

function scanLocalCosts() {
  const projectRoots = [
    path.join(process.env.HOME, '.config', 'claude', 'projects'),
    path.join(process.env.HOME, '.claude', 'projects')
  ];

  const seen = new Set(); // deduplicate by message.id + requestId
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let sessionCount = 0;
  let oldestDate = null;
  let newestDate = null;

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  for (const root of projectRoots) {
    if (!fs.existsSync(root)) continue;

    const projects = fs.readdirSync(root).filter(p => fs.statSync(path.join(root, p)).isDirectory());

    for (const project of projects.slice(0, 20)) { // cap at 20 projects
      const projectDir = path.join(root, project);

      // Find all .jsonl files
      function walkDir(dir) {
        try {
          for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
              walkDir(full);
            } else if (entry.endsWith('.jsonl') && stat.mtime > thirtyDaysAgo) {
              parseJsonl(full);
            }
          }
        } catch { /* skip inaccessible dirs */ }
      }

      walkDir(projectDir);
    }
  }

  function parseJsonl(filePath) {
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
      let lastId = null;
      let lastReqId = null;

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Only count assistant messages with usage
          if (entry.type !== 'assistant' && entry.type !== 'result') continue;
          const usage = entry.message?.usage || entry.usage;
          if (!usage) continue;

          // Deduplicate streaming chunks — same message.id + requestId = one usage
          const msgId = entry.message?.id || entry.id;
          const reqId = entry.requestId || entry.request_id || null;
          const dedupKey = `${msgId}:${reqId}`;
          if (dedupKey !== `${lastId}:${lastReqId}`) {
            // New unique message
            if (msgId && msgId !== lastId) sessionCount++;
            lastId = msgId;
            lastReqId = reqId;
          }
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);

          totalInputTokens   += usage.input_tokens || 0;
          totalOutputTokens  += usage.output_tokens || 0;
          totalCacheRead     += usage.cache_read_tokens || 0;
          totalCacheCreate   += usage.cache_creation_tokens || 0;
        } catch { /* skip malformed lines */ }
      }
    } catch { /* skip unreadable files */ }
  }

  return {
    totalTokens: totalInputTokens + totalOutputTokens,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheReadTokens: totalCacheRead,
    cacheCreationTokens: totalCacheCreate,
    sessionCount,
    days: 30
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Cost History — daily snapshots
// ═══════════════════════════════════════════════════════════════════════════════
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');

function loadHistory() {
  try {
    const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    return Array.isArray(h) ? h : [];
  } catch { return []; }
}

function saveHistory(h) {
  // Keep last 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const filtered = h.filter(e => new Date(e.date) >= cutoff);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2));
}

function recordSnapshot(data) {
  if (!data) return;
  const today = new Date().toISOString().split('T')[0];
  const history = loadHistory();

  // Update or append today's snapshot
  const existing = history.findIndex(e => e.date === today);
  const snapshot = {
    date: today,
    sessionPct: data.session?.utilization ?? null,
    weeklyPct: data.weekly?.utilization ?? null,
    extraUsed: data.extra?.used ?? null,
    extraLimit: data.extra?.limit ?? null
  };

  if (existing >= 0) {
    history[existing] = { ...history[existing], ...snapshot };
  } else {
    history.push(snapshot);
  }

  saveHistory(history);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Auto-Update Checker — lightweight, no signing required
// ═══════════════════════════════════════════════════════════════════════════════
let updateAvailable = null;

async function checkForUpdate() {
  try {
    const res = await fetch('https://api.github.com/repos/jarvismao49/claude-bar/releases/latest', {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) return;
    const release = await res.json();
    const latest = release.tag_name?.replace(/^v/, '') || release.name?.replace(/^v/, '');
    const current = app.getVersion();

    if (latest && latest !== current) {
      updateAvailable = { version: latest, url: release.html_url };
      // Notify via menu
      refreshTray();
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Bootstrap
// ═══════════════════════════════════════════════════════════════════════════════
app.whenReady().then(() => {
  // Apply saved login item setting on startup
  const settings = loadSettings();
  try {
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: !!settings.loginItemEnabled,
        path: process.execPath,
        args: []
      });
    }
  } catch {}

  // Load cached local costs on startup (fast, no scan)
  const cachedCosts = loadCachedCosts();
  if (cachedCosts) {
    cachedData = { localCosts: cachedCosts };
  }

  createTray();

  // Check for updates on startup (packaged app only)
  if (app.isPackaged) {
    setTimeout(checkForUpdate, 3000);
  }
});
app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => { /* macOS dock */ });

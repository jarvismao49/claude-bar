const { app, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// ── Config & Data ─────────────────────────────────────────────────────────────
const CONFIG_DIR = path.join(process.env.HOME, '.config', 'usage-tracker');
const CRED_FILE = path.join(CONFIG_DIR, 'claude_token.json');
fs.mkdirSync(CONFIG_DIR, { recursive: true });

function loadToken() {
  try { return JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')); }
  catch { return null; }
}
function saveToken(t) {
  fs.writeFileSync(CRED_FILE, JSON.stringify(t, null, 2));
}
function loadDisabled() {
  return loadToken()?.disabled || false;
}

// ── Claude OAuth (usage API) ───────────────────────────────────────────────────
function getClaudeToken() {
  const stored = loadToken();
  if (stored?.accessToken && stored?.expiresAt > Date.now()) {
    return stored.accessToken;
  }
  if (storeDisabled) return null;
  try {
    const cred = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude', '.credentials.json'), 'utf8'));
    return cred?.claudeAiOauth?.accessToken || null;
  } catch { return null; }
}

async function fetchClaudeUsage() {
  const token = getClaudeToken();
  if (!token) throw new Error('Not logged in — click Login.');

  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20'
    }
  });

  if (!res.ok) {
    if (res.status === 401) {
      saveToken({ accessToken: null, expiresAt: 0, disabled: true });
      throw new Error('Session expired — please login again.');
    }
    throw new Error(`Claude API ${res.status}`);
  }
  return await res.json();
}

// ── CLI Login ─────────────────────────────────────────────────────────────────
// Runs `claude auth login --claudeai` which prints the OAuth URL to stdout.
// The CLI opens the browser automatically — we just need to capture the URL
// so we know the auth started. After the user approves in browser, the CLI
// writes the token to ~/.claude/.credentials.json automatically.
function runClaudeLogin() {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['auth', 'login', '--claudeai'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result) => {
      if (settled) return;
      settled = true;
      child.kill();
      clearTimeout(timeout);
      resolve(result);
    };

    // Timeout after 2 min — OAuth browser flow takes time
    const timeout = setTimeout(() => {
      // Even on timeout, if we got a URL, count it as success
      const url = extractOAuthUrl(stdout + stderr);
      if (url) resolve({ url, output: stdout + stderr });
      else settle({ url: null, output: stdout + stderr });
    }, 120000);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const url = extractOAuthUrl(stdout + stderr);
      settle({ url, output: stdout + stderr, code });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function extractOAuthUrl(text) {
  // Match any URL that contains oauth/authorize or similar OAuth flow
  const match = text.match(/https?:\/\/[^\s'"]+oauth[^\s'"]*/);
  if (match) {
    let url = match[0];
    while (url.length && '.,;:!?)]\'">'.includes(url[url.length-1])) {
      url = url.slice(0, -1);
    }
    return url;
  }
  // Fall back to any claudecode URL
  const fallback = text.match(/https?:\/\/[^\s'"]+claude[^\s'"]*/);
  if (fallback) {
    let url = fallback[0];
    while (url.length && '.,;:!?)]\'">'.includes(url[url.length-1])) {
      url = url.slice(0, -1);
    }
    return url;
  }
  return null;
}

// ── State ────────────────────────────────────────────────────────────────────
let tray = null;
let pollTimer = null;
let cachedUsage = null;
let lastRefresh = null;
let refreshError = null;
let pollIntervalMs = 5 * 60 * 1000;
let storeDisabled = loadDisabled();
let loginChild = null;

// ── Icon ─────────────────────────────────────────────────────────────────────
function createIcon() {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtPct(n) { return n != null ? `${Math.round(n)}%` : '—'; }
function resetIn(iso) {
  if (!iso) return '';
  try {
    const diffMs = new Date(iso) - Date.now();
    if (diffMs <= 0) return ' (reset now)';
    return ` (${Math.floor(diffMs / 3600000)}h ${Math.floor((diffMs % 3600000) / 60000)}m)`;
  } catch { return ''; }
}

function buildMenu() {
  const u = cachedUsage;
  const hasToken = !!getClaudeToken();

  const sessionPct = u?.five_hour?.utilization;
  const weeklyPct = u?.seven_day?.utilization;
  const sessionResets = u?.five_hour?.resets_at;
  const weeklyResets = u?.seven_day?.resets_at;
  const extraLimit = u?.extra_usage?.monthly_limit;
  const extraUsed = u?.extra_usage?.used_credits;

  return Menu.buildFromTemplate([
    { label: '⚡  ClaudeBar', enabled: false },
    { type: 'separator' },
    ...(hasToken ? [
      { label: `Session   ${fmtPct(sessionPct)}${resetIn(sessionResets)}`, enabled: false },
      { label: `Weekly    ${fmtPct(weeklyPct)}${resetIn(weeklyResets)}`, enabled: false },
      ...(extraLimit ? [{ label: `Extra     $${(extraUsed || 0).toFixed(2)} of $${extraLimit/1000}${extraUsed >= extraLimit ? ' ⚠️' : ''}`, enabled: false }] : []),
      { type: 'separator' },
    ] : [
      { label: '⚠️  Not logged in', enabled: false },
      { type: 'separator' },
    ]),
    ...(refreshError ? [{ label: `⚠️ ${refreshError.slice(0, 50)}`, enabled: false }] : []),
    { label: `Refreshed ${lastRefresh || 'never'}`, enabled: false },
    { type: 'separator' },
    { label: 'Login', click: handleLogin },
    ...(hasToken ? [{ label: 'Logout', click: logout }] : []),
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);
}

function createTray() {
  tray = new Tray(createIcon());
  tray.setToolTip('ClaudeBar');
  refreshTray();
  startPolling();
}

function refreshTray() {
  if (!tray) return;
  const u = cachedUsage;
  const hasToken = !!getClaudeToken();
  tray.setToolTip(hasToken ? `ClaudeBar — Session ${fmtPct(u?.five_hour?.utilization)}` : 'ClaudeBar — Not logged in');
  tray.setContextMenu(buildMenu());
}

// ── Login Handler ─────────────────────────────────────────────────────────────
async function handleLogin() {
  refreshError = 'Opening browser...';
  refreshTray();

  try {
    const child = spawn('claude', ['auth', 'login', '--claudeai'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    loginChild = child;
    let stderr = '';

    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      loginChild = null;
      // OAuth flow completed — token should now be in ~/.claude/.credentials.json
      storeDisabled = false;
      setTimeout(doRefresh, 1000);
    });

    child.on('error', (e) => {
      loginChild = null;
      if (e.code === 'ENOENT') {
        refreshError = 'Claude CLI not found. Run: brew install anthropic';
      } else {
        refreshError = e.message;
      }
      refreshTray();
    });

  } catch (e) {
    if (e.code === 'ENOENT' || e.message.includes('not found')) {
      refreshError = 'Claude CLI not found. Run: brew install anthropic';
    } else {
      refreshError = e.message;
    }
    refreshTray();
  }
}

function logout() {
  saveToken({ accessToken: null, expiresAt: 0, disabled: true });
  storeDisabled = true;
  cachedUsage = null;
  refreshError = null;
  refreshTray();
}

// ── Polling ──────────────────────────────────────────────────────────────────
async function doRefresh() {
  try {
    cachedUsage = await fetchClaudeUsage();
    lastRefresh = new Date().toLocaleTimeString();
    refreshError = null;
  } catch (e) {
    refreshError = e.message;
  }
  refreshTray();
}

function startPolling() {
  doRefresh();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(doRefresh, pollIntervalMs);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
app.whenReady().then(() => { createTray(); });
app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => { /* macOS dock */ });

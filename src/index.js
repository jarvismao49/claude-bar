const { app, Tray, Menu, nativeImage, shell, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.name = 'ClaudeBar';

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
  const t = loadToken();
  return t?.disabled || false;
}

// ── Claude OAuth ──────────────────────────────────────────────────────────────
function getClaudeToken() {
  // 1. Use stored token if valid
  const stored = loadToken();
  if (stored?.accessToken && stored?.expiresAt > Date.now()) {
    return stored.accessToken;
  }
  // 2. Fall back to Claude CLI credentials (only if not explicitly logged out)
  if (storeDisabled) return null;
  try {
    const cred = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.claude', '.credentials.json'), 'utf8'));
    return cred?.claudeAiOauth?.accessToken || null;
  } catch { return null; }
}

async function fetchClaudeUsage() {
  const token = getClaudeToken();
  if (!token) throw new Error('Not logged in — click Login to authenticate.');

  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20'
    }
  });

  if (!res.ok) {
    const err = await res.text();
    if (res.status === 401) {
      // Token expired — clear it
      saveToken({ accessToken: null, expiresAt: 0 });
      throw new Error('Session expired — please login again.');
    }
    throw new Error(`Claude API ${res.status}`);
  }
  return await res.json();
}

// ── State ────────────────────────────────────────────────────────────────────
let tray = null;
let pollTimer = null;
let cachedUsage = null;
let lastRefresh = null;
let refreshError = null;
let pollIntervalMs = 5 * 60 * 1000;
let loginWin = null;
let storeDisabled = loadDisabled();

// ── Icon ─────────────────────────────────────────────────────────────────────
function createIcon(utilization) {
  return nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtPct(n) { return n != null ? `${Math.round(n)}%` : '—'; }
function resetIn(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffMs = d - Date.now();
    if (diffMs <= 0) return ' (reset now)';
    const h = Math.floor(diffMs / 3600000);
    const m = Math.floor((diffMs % 3600000) / 60000);
    return ` (${h}h ${m}m)`;
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

  const menuItems = [
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
    ...(hasToken ? [{ label: 'Refresh Now', click: doRefresh }] : [{ label: 'Login', click: openLogin }]),
    { label: 'Logout', click: logout },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ];

  return Menu.buildFromTemplate(menuItems);
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

// ── Login Window ─────────────────────────────────────────────────────────────
function openLogin() {
  if (loginWin) { loginWin.focus(); return; }

  loginWin = new BrowserWindow({
    width: 420, height: 340, resizable: false,
    title: 'Login to Claude',
    backgroundColor: '#1e1e1e',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  loginWin.loadFile(path.join(__dirname, 'login.html'));
  loginWin.setMenu(null);
  loginWin.on('closed', () => { loginWin = null; });

  // Open browser to Claude OAuth
  shell.openExternal('https://claude.ai/login');
}

function logout() {
  saveToken({ accessToken: null, expiresAt: 0, disabled: true });
  storeDisabled = true;
  cachedUsage = null;
  refreshError = null;
  refreshTray();
}

// ── IPC ──────────────────────────────────────────────────────────────────────
const { ipcMain } = require('electron');

ipcMain.on('save-token', (_, { accessToken, expiresAt }) => {
  saveToken({ accessToken, expiresAt });
  doRefresh();
});

ipcMain.handle('get-token', () => {
  const t = loadToken();
  return { hasToken: !!t?.accessToken };
});

// ── Bootstrap ────────────────────────────────────────────────────────────────
app.whenReady().then(() => { createTray(); });
app.on('window-all-closed', () => { /* stay in tray */ });
app.on('activate', () => { /* macOS dock */ });

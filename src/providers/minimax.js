const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(process.env.HOME, '.config', 'usage-tracker', 'usage.json');

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

async function fetchAndStore(apiKey) {
  // TODO: Implement when MiniMax API is available
  console.log('[MiniMax] Stub — not yet implemented');
}

module.exports = { fetchAndStore };

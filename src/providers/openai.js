const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(process.env.HOME, '.config', 'usage-tracker', 'usage.json');

function loadDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function dateStr(d) {
  return d.toISOString().split('T')[0];
}

async function fetchAndStore(apiKey) {
  // TODO: Implement when OpenAI admin key is available
  // Expected endpoint: GET https://api.openai.com/v1/organization/usage/completions
  // For now, just log
  console.log('[OpenAI] Stub — not yet implemented');
}

module.exports = { fetchAndStore };

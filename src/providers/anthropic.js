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

// Fetch Anthropic usage via Admin API
async function fetchAndStore(adminKey) {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), 1); // first of month

  const params = new URLSearchParams({
    starting_at: start.toISOString(),
    ending_at: end.toISOString(),
    bucket_width: '1d'
  });

  let data;
  try {
    const res = await fetch(`https://api.anthropic.com/v1/organizations/usage_report/messages?${params}`, {
      headers: {
        'x-api-key': adminKey,
        'anthropic-version': '2023-06-01',
        'User-Agent': 'UsageTracker/1.0'
      }
    });
    data = await res.json();
  } catch (e) {
    throw new Error(`Anthropic API error: ${e.message}`);
  }

  if (data.type === 'error') {
    throw new Error(data.error?.message || 'Anthropic API error');
  }

  // Response: { data: [{ starting_at, ending_at, results: [] }] }
  const buckets = data.data || [];
  if (!buckets.length) return;

  const db = loadDB();
  const existingByDate = {};
  for (const e of db.entries) {
    if (e.provider === 'anthropic') existingByDate[e.date] = e;
  }

  for (const bucket of buckets) {
    const date = dateStr(new Date(bucket.starting_at));
    const results = bucket.results || [];

    let inputTokens = 0, outputTokens = 0, cacheRead = 0, cacheCreate = 0;
    for (const r of results) {
      inputTokens += r.input_tokens || 0;
      outputTokens += r.output_tokens || 0;
      cacheRead += r.cache_read_tokens || 0;
      cacheCreate += r.cache_creation_tokens || 0;
    }

    const tokens = inputTokens + outputTokens;
    if (tokens === 0) continue; // skip days with no usage

    // Pricing: ~$3/M input, ~$15/M output (Sonnet 4)
    const cost = (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);

    const existing = existingByDate[date] || { id: Date.now() + Math.random(), provider: 'anthropic', date };
    existing.inputTokens = inputTokens;
    existing.outputTokens = outputTokens;
    existing.cacheReadTokens = cacheRead;
    existing.cacheCreationTokens = cacheCreate;
    existing.tokens = tokens;
    existing.cost = cost;

    if (!existingByDate[date]) db.entries.push(existing);
  }

  saveDB(db);
}

module.exports = { fetchAndStore };

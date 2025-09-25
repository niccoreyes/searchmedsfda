import axios from 'axios';
import * as fs from 'fs/promises';

// Simple Node/TS script to query PNF API endpoints server-side and save results
// Usage examples (from project root):
//  npm install axios
//  npx ts-node pnf-fetch.ts --search "paracetamol" --limit 20 --details --out ./paracetamol.json
//  node dist/pnf-fetch.js --search "paracetamol" --limit 20 --details --out ./paracetamol.json

const BASE = 'https://pnf-api.doh.gov.ph';
// Add standard browser headers to reduce chance of Cloudflare/origin blocking
const DEFAULT_HEADERS: Record<string, string> = {
  Referer: 'https://pnf.doh.gov.ph/',
  Origin: 'https://pnf.doh.gov.ph',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'same-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty'
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out: any = { search: '', limit: 50, details: false, out: './pnf-results.json', cookie: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--search' && args[i + 1]) { out.search = args[++i]; }
    else if (a === '--limit' && args[i + 1]) { out.limit = Number(args[++i]) || out.limit; }
    else if (a === '--details') { out.details = true; }
    else if (a === '--out' && args[i + 1]) { out.out = args[++i]; }
    else if (a === '--cookie' && args[i + 1]) { out.cookie = args[++i]; }
    else if (a === '--help') { out.help = true; }
  }
  return out;
}

async function fetchSidebar(cookie?: string) {
  const url = `${BASE}/api/pnf`;
  const headers = { ...DEFAULT_HEADERS } as Record<string, string>;
  if (cookie) headers.Cookie = cookie;
  const res = await axios.get(url, { headers, timeout: 15000 });
  return res.data;
}

async function searchGenerics(params: Record<string, any>, cookie?: string) {
  const url = `${BASE}/api/home`;
  const headers = { ...DEFAULT_HEADERS } as Record<string, string>;
  if (cookie) headers.Cookie = cookie;
  const res = await axios.get(url, { params, headers, timeout: 20000 });
  return res.data;
}

async function fetchDrugDetail(id: number | string, cookie?: string) {
  const url = `${BASE}/api/drug/${id}`;
  const headers = { ...DEFAULT_HEADERS } as Record<string, string>;
  if (cookie) headers.Cookie = cookie;
  const res = await axios.get(url, { headers, timeout: 20000 });
  return res.data;
}

async function delay(ms: number) {
	return new Promise((r) => setTimeout(r, ms));
}

// polite delay configuration to avoid rate limiting
const MIN_DELAY_MS = 700;
const MAX_DELAY_MS = 2500;

async function politeDelay() {
	const ms = MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1));
	await delay(ms);
}

// Fetch with retries + exponential backoff to handle transient 403/5xx
async function fetchDrugDetailWithRetries(id: number | string, maxAttempts = 5, cookie?: string) {
  let attempt = 0;
  const base = 700;
  while (attempt < maxAttempts) {
    try {
      return await fetchDrugDetail(id, cookie);
    } catch (err: any) {
      attempt++;
      const status = err?.response?.status;
      if (attempt >= maxAttempts) throw err;
      const backoff = base * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
      console.warn(`Attempt ${attempt}/${maxAttempts} failed for id=${id} status=${status}. Waiting ${backoff}ms before retrying.`);
      await delay(backoff);
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const argv = parseArgs();
  if (argv.help) {
    console.log('Usage: node pnf-fetch.js --search "term" --limit 50 --details --out ./file.json --cookie "name=value; name2=value2"');
    process.exit(0);
  }

  console.log('Starting PNF fetch with options:', argv);

  // optional: fetch sidebar/filter data
  try {
    const sidebar = await fetchSidebar(argv.cookie);
    console.log('Fetched sidebar data');
    await fs.writeFile('./pnf-sidebar.json', JSON.stringify(sidebar, null, 2));
  } catch (err: any) {
    console.warn('Sidebar fetch failed (non-fatal):', err?.response?.status ?? err?.message ?? err);
    if (err?.response?.status === 403) console.warn('403 from sidebar — the API may require a valid session or Cloudflare challenge. Try passing browser cookies with --cookie or use a headful browser to retrieve data.');
  }

  // search generics
  const params: any = {
    pnfSections: '',
    pnfCategories: '',
    therapeuticCategories: '',
    subTherapeuticCategories: '',
    pnfCare: '',
    reservedAmr: '',
    globalSearch: argv.search || ''
  };

  let results: any = null;
  try {
    results = await searchGenerics(params, argv.cookie);
  } catch (err: any) {
    console.error('Search request failed:', err?.response?.status, err?.message || err);
    if (err?.response?.status === 403) console.error('403 Forbidden — try passing a cookie from a browser session with --cookie or run this from an environment that can solve Cloudflare JS challenge (headful browser).');
    process.exit(1);
  }

  const generics = results?.drugGenerics || [];
  console.log('Generics found:', generics.length);

  const take = Math.min(argv.limit || 50, generics.length);
  const selected = generics.slice(0, take);

  const output: any = { meta: { searched: argv.search, totalFound: results?.totalDrugs ?? null, returned: selected.length, timestamp: new Date().toISOString() }, generics: [] };

  for (let i = 0; i < selected.length; i++) {
    const g = selected[i];
    const record: any = { id: g.id, name: g.name, ...g };
    if (argv.details) {
      // polite delay to avoid provoking rate limits
      await politeDelay();
      try {
        const det = await fetchDrugDetailWithRetries(g.id, 5);
        // the API returns a wrapper: {status:..., drug: {...} }
        record.detail = det?.drug ?? det;
        console.log(`Fetched detail ${i + 1}/${take}: ${g.name}`);
      } catch (err: any) {
        console.warn(`Failed to fetch detail for id=${g.id} name=${g.name}:`, err?.response?.status ?? err?.message ?? err);
        record.detailError = { message: err?.message, status: err?.response?.status };
      }
    }
    output.generics.push(record);
  }

  try {
    await fs.writeFile(argv.out, JSON.stringify(output, null, 2));
    console.log('Wrote results to', argv.out);
  } catch (err) {
    console.error('Failed to write output file:', err);
  }
}

main().catch((e) => {
	console.error('Fatal error', e);
	process.exit(1);
});

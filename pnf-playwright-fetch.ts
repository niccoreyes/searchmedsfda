import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs/promises';

// Playwright fetch script for PNF
// Usage:
//  npm install -D playwright
//  npx ts-node pnf-playwright-fetch.ts --search "paracetamol" --limit 10 --out ./pnf-playwright.json --headless=false
// Or with Bun (after installing playwright):
//  bunx ts-node pnf-playwright-fetch.ts --search "paracetamol"

function parseArgs() {
  const args = process.argv.slice(2);
  const out: any = { search: '', limit: 50, out: './pnf-playwright.json', headless: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--search' && args[i + 1]) out.search = args[++i];
    else if (a === '--limit' && args[i + 1]) out.limit = Number(args[++i]) || out.limit;
    else if (a === '--out' && args[i + 1]) out.out = args[++i];
    else if (a === '--headless' && args[i + 1]) out.headless = args[++i] === 'true';
    else if (a === '--help') out.help = true;
  }
  return out;
}

async function run() {
  const argv = parseArgs();
  if (argv.help || !argv.search) {
    console.log('Usage: node pnf-playwright-fetch.js --search "term" --limit 20 --out ./file.json --headless=false');
    process.exit(0);
  }

  console.log('Launching Playwright (headless=', argv.headless, ')');
  const browser: Browser = await chromium.launch({ headless: argv.headless });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
  });
  const page: Page = await context.newPage();

  // capture API responses
  const homeResponses: any[] = [];
  const drugResponses: Map<string, any> = new Map();

  page.on('response', async (response) => {
    try {
      const url = response.url();
      if (url.includes('/api/home')) {
        const body = await response.json().catch(() => null);
        homeResponses.push({ url, status: response.status(), body });
        console.log('Captured /api/home response', response.status());
      } else if (url.includes('/api/drug/')) {
        const id = url.split('/').pop();
        const body = await response.json().catch(() => null);
        drugResponses.set(id || url, { url, status: response.status(), body });
        console.log('Captured /api/drug response', id, response.status());
      } else if (url.includes('/api/pnf')) {
        const body = await response.json().catch(() => null);
        console.log('Captured /api/pnf', response.status());
        // Save sidebar if needed
        await fs.writeFile('./pnf-playwright-sidebar.json', JSON.stringify(body, null, 2)).catch(() => {});
      }
    } catch (e) {
      // ignore
    }
  });

  // go to site
  await page.goto('https://pnf.doh.gov.ph/', { waitUntil: 'networkidle' });
  console.log('Page loaded');

  // Ensure the input exists
  const inputSelector = '#inputGlobalSearch';
  await page.waitForSelector(inputSelector, { timeout: 10000 });

  // fill input and trigger search via clicking search button
  await page.fill(inputSelector, argv.search);
  // click the search button (the page code uses a "Search" button next to input)
  const searchButton = await page.$('button:has-text("Search")');
  if (searchButton) {
    await searchButton.click();
  } else {
    // fallback: press Enter in input
    await page.press(inputSelector, 'Enter');
  }

  // wait a bit for network calls
  await page.waitForTimeout(2000);

  // Wait for at least one /api/home response captured or give up after timeout
  const maxWait = 20000; // 20s
  const start = Date.now();
  while (homeResponses.length === 0 && Date.now() - start < maxWait) {
    await page.waitForTimeout(500);
  }

  if (homeResponses.length === 0) {
    console.error('No /api/home response captured. The site may still be blocking requests or using a different flow. Try running with headless=false so you can complete challenges manually.');
    await browser.close();
    process.exit(1);
  }

  // take the most recent /api/home response
  const home = homeResponses[homeResponses.length - 1].body;
  const generics = home?.drugGenerics || [];
  console.log('Generics found (in response):', generics.length);

  const take = Math.min(argv.limit || 50, generics.length);
  const selected = generics.slice(0, take);

  // For each selected generic, trigger detail view to make the site request (which we intercept above)
  for (let i = 0; i < selected.length; i++) {
    const g = selected[i];
    // try to click element that corresponds to generic — site renders a button per generic; find by text
    try {
      const selector = `button:has-text("${g.name}")`;
      const el = await page.$(selector);
      if (el) {
        await el.click();
        // wait for detail network call
        await page.waitForTimeout(800 + Math.random() * 800);
      } else {
        // fallback: directly call fetch from page context to /api/drug/{id}
        await page.evaluate(async (id) => {
          await fetch(`/api/drug/${id}`).then((r) => r.json()).catch(() => null);
        }, g.id);
        await page.waitForTimeout(500);
      }
    } catch (e) {
      // ignore per-item failures
    }
  }

  // gather captured drug details
  const details: any[] = [];
  for (const g of selected) {
    const id = String(g.id);
    const captured = drugResponses.get(id);
    if (captured) details.push({ id, body: captured.body });
    else details.push({ id, body: null });
  }

  const output = { meta: { searched: argv.search, timestamp: new Date().toISOString(), totalFound: home?.totalDrugs ?? null }, generics: selected, details };

  await fs.writeFile(argv.out, JSON.stringify(output, null, 2));
  console.log('Wrote results to', argv.out);

  await browser.close();
}

run().catch((e) => {
  console.error('Playwright script failed:', e);
  process.exit(1);
});

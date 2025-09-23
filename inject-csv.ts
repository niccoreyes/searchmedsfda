// Bun script to inject CSV content into searchmeds.html and output index.html
import { readFile, writeFile } from 'fs/promises';

async function main() {
  const htmlPath = 'searchmeds.html';
  const csvPath = 'ALL_DrugProducts.csv';
  const outPath = 'index.html';

  // Read HTML and CSV
  const [html, csv] = await Promise.all([
    readFile(htmlPath, 'utf8'),
    readFile(csvPath, 'utf8'),
  ]);

  // Find injection marker
  const marker = '<!-- CSV_INJECT_HERE -->';
  if (!html.includes(marker)) {
    throw new Error('Marker not found in HTML');
  }

  // Prepare CSV as a JS variable using JSON.stringify for safe embedding
  const csvScript = `<script id="csv-data">\nwindow.CSV_DATA = ${JSON.stringify(csv)};\n</script>\n`;

  // Inject CSV
  const injected = html.replace(marker, `${marker}\n${csvScript}`);

  // Write to index.html
  await writeFile(outPath, injected, 'utf8');
  console.log(`Injected CSV into ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });

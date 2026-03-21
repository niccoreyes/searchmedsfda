#!/usr/bin/env bun
/**
 * FDA Philippines Drug Product Harvester
 * Recursively queries the FDA API and maps CDRR data to CSV format
 * State-managed for resumability after interruptions
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  API_BASE_URL: "https://verification.fda.gov.ph/api/search",
  STATE_FILE: "fda_harvester_state.json",
  CSV_FILE: "fda_harvested_products.csv",
  LOG_FILE: "fda_harvester.log",
  DELAY_MS: 1500, // Delay between requests to be respectful
  TIMEOUT_MS: 120000, // 120 second timeout for API requests (A-Z queries are large)
  MAX_RETRIES: 3,
  SAVE_INTERVAL: 10, // Save state every N successful requests
  MAX_DRILL_DOWN_DEPTH: 4, // Maximum depth for drilling down (A -> AA -> AAA -> AAAA)
};

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

type QueueItem = {
  query: string;
  depth: number;
  parentQuery: string | null;
};

type ProcessingState = {
  queryQueue: QueueItem[];
  completedQueries: Set<string>;
  failedQueries: Map<string, { error: string; timestamp: number; retries: number }>;
  registrationNumbers: Set<string>; // For deduplication
  totalProcessed: number;
  startTime: string;
  lastSaved: string;
  interruptedAt?: string;
  pendingUserDecision?: {
    query: string;
    itemIndex: number;
    fieldName: string;
    problematicValue: string;
    choices: string[];
  };
};

function createInitialState(): ProcessingState {
  const queue: QueueItem[] = [];
  // Initialize with A-Z
  for (let i = 65; i <= 90; i++) {
    queue.push({
      query: String.fromCharCode(i),
      depth: 1,
      parentQuery: null,
    });
  }

  return {
    queryQueue: queue,
    completedQueries: new Set(),
    failedQueries: new Map(),
    registrationNumbers: new Set(),
    totalProcessed: 0,
    startTime: new Date().toISOString(),
    lastSaved: new Date().toISOString(),
  };
}

function saveState(state: ProcessingState) {
  const serialized = {
    queryQueue: state.queryQueue,
    completedQueries: Array.from(state.completedQueries),
    failedQueries: Array.from(state.failedQueries.entries()),
    registrationNumbers: Array.from(state.registrationNumbers),
    totalProcessed: state.totalProcessed,
    startTime: state.startTime,
    lastSaved: new Date().toISOString(),
    interruptedAt: state.interruptedAt,
    pendingUserDecision: state.pendingUserDecision,
  };

  writeFileSync(CONFIG.STATE_FILE, JSON.stringify(serialized, null, 2));
  log(`State saved: ${state.totalProcessed} processed, ${state.queryQueue.length} pending`);
}

function loadState(): ProcessingState | null {
  if (!existsSync(CONFIG.STATE_FILE)) return null;

  try {
    const data = JSON.parse(readFileSync(CONFIG.STATE_FILE, "utf-8"));
    return {
      queryQueue: data.queryQueue || [],
      completedQueries: new Set(data.completedQueries || []),
      failedQueries: new Map(data.failedQueries || []),
      registrationNumbers: new Set(data.registrationNumbers || []),
      totalProcessed: data.totalProcessed || 0,
      startTime: data.startTime || new Date().toISOString(),
      lastSaved: data.lastSaved || new Date().toISOString(),
      interruptedAt: data.interruptedAt,
      pendingUserDecision: data.pendingUserDecision,
    };
  } catch (e) {
    console.error("Failed to load state, starting fresh");
    return null;
  }
}

// ============================================================================
// LOGGING
// ============================================================================

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(line.trim());
  appendFileSync(CONFIG.LOG_FILE, line);
}

// ============================================================================
// CSV HANDLING
// ============================================================================

const CSV_HEADERS = [
  "Product Information",
  "Registration Number",
  "Generic Name",
  "Brand Name",
  "Dosage Strength",
  "Dosage Form",
  "Classification",
  "Packaging",
  "Pharmacologic Category",
  "Manufacturer",
  "Country of Origin",
  "Trader",
  "Importer",
  "Distributor",
  "Application Type",
  "Issuance Date",
  "Expiry Date",
];

function escapeCsvField(field: string): string {
  if (field === null || field === undefined) return "";
  const str = String(field);
  // Escape quotes by doubling them, and wrap in quotes if contains special chars
  if (str.includes('"') || str.includes(",") || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function initializeCsv() {
  if (!existsSync(CONFIG.CSV_FILE)) {
    const headerLine = CSV_HEADERS.map(escapeCsvField).join(",") + "\n";
    writeFileSync(CONFIG.CSV_FILE, "\ufeff" + headerLine); // BOM for Excel
    log(`Created new CSV file: ${CONFIG.CSV_FILE}`);
  }
}

function appendToCsv(records: CDRRRecord[], state: ProcessingState): number {
  let addedCount = 0;
  const lines: string[] = [];

  for (const record of records) {
    // Deduplication by registration number
    if (state.registrationNumbers.has(record.registration_number)) {
      continue;
    }

    state.registrationNumbers.add(record.registration_number);

    const fields = [
      "", // Product Information (file link) - not available in search API
      record.registration_number,
      record.generic_name,
      record.brand_name,
      record.dosage_strength,
      record.dosage_form,
      record.classification,
      record.packaging,
      record.pharmacologic_category,
      record.manufacturer,
      record.country_of_origin,
      record.trader || "",
      record.importer,
      record.distributor,
      record.app_type,
      record.issuance_date,
      record.expiry_date,
    ];

    const line = fields.map(escapeCsvField).join(",");
    lines.push(line);
    addedCount++;
  }

  if (lines.length > 0) {
    appendFileSync(CONFIG.CSV_FILE, lines.join("\n") + "\n");
  }

  return addedCount;
}

// ============================================================================
// API HANDLING
// ============================================================================

type CDRRRecord = {
  registration_number: string;
  generic_name: string;
  brand_name: string;
  dosage_strength: string;
  dosage_form: string;
  classification: string;
  packaging: string;
  manufacturer: string;
  country_of_origin: string;
  trader: string | null;
  importer: string;
  distributor: string;
  app_type: string;
  issuance_date: string;
  expiry_date: string;
  pharmacologic_category: string;
};

type APISearchResponse = {
  lto_food?: unknown[];
  lto_drugs?: unknown[];
  lto_medicaldevice?: unknown[];
  lto_healthrelateddevice?: unknown[];
  lto_pco?: unknown[];
  fdafoodproducts?: unknown[];
  cdrr?: CDRRRecord[];
  lto_cosmetics?: unknown[];
  lto_hup?: unknown[];
  lto_tcca?: unknown[];
  cpr_cdrrhr?: unknown[];
  healthcare_waste?: unknown[];
  water_purification?: unknown[];
  xray?: unknown[];
  csl_batch?: unknown[];
  csl_lot?: unknown[];
  vat_exempt?: unknown[];
  cosmetic_NN?: unknown[];
  cmdn?: unknown[];
  localcgmp?: unknown[];
  desktopForeigncgmp?: unknown[];
  inspectedForeign?: unknown[];
  PermitToRegister?: unknown[];
  lto_huhs?: unknown[];
  cpr_hup?: unknown[];
  cpr_huhs?: unknown[];
  tcca_notif?: unknown[];
  food_gmp?: unknown[];
  HACCP?: unknown[];
  HACCPprod?: unknown[];
  otherEST?: unknown[];
  fdawebsite?: unknown[];
  tcca_notif_products?: unknown[];
  cdrr_PIPIL?: unknown[];
};

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
        Referer: "https://verification.fda.gov.ph/",
      },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function queryAPI(query: string, retryCount = 0): Promise<APIResult> {
  const url = `${CONFIG.API_BASE_URL}?q=${encodeURIComponent(query)}`;
  log(`Querying: ${query} (attempt ${retryCount + 1})`);

  try {
    const response = await fetchWithTimeout(url, CONFIG.TIMEOUT_MS);

    if (!response.ok) {
      if (response.status === 404 || response.status >= 500) {
        return { type: "error", error: `HTTP ${response.status}`, shouldDrillDown: true };
      }
      return { type: "error", error: `HTTP ${response.status}`, shouldDrillDown: false };
    }

    const text = await response.text();

    // Handle empty response
    if (!text || text.trim() === "") {
      return { type: "empty" };
    }

    let data: APISearchResponse;
    try {
      data = JSON.parse(text) as APISearchResponse;
    } catch (parseError) {
      return {
        type: "parse_error",
        rawText: text,
        error: parseError instanceof Error ? parseError.message : "Unknown parse error",
      };
    }

    return { type: "success", data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    if (error instanceof Error && error.name === "AbortError") {
      log(`Timeout for query: ${query}`);
      return { type: "error", error: "Timeout", shouldDrillDown: true };
    }

    if (retryCount < CONFIG.MAX_RETRIES) {
      log(`Retry ${retryCount + 1}/${CONFIG.MAX_RETRIES} for ${query} after error: ${errorMessage}`);
      await delay(2000 * (retryCount + 1)); // Exponential backoff
      return queryAPI(query, retryCount + 1);
    }

    return { type: "error", error: errorMessage, shouldDrillDown: true };
  }
}

type APIResult =
  | { type: "success"; data: APISearchResponse }
  | { type: "empty" }
  | { type: "error"; error: string; shouldDrillDown?: boolean }
  | { type: "parse_error"; rawText: string; error: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// CHARACTER HANDLING
// ============================================================================

function containsNonAscii(str: string): boolean {
  return /[^\x00-\x7F]/.test(str);
}

function sanitizeRecord(record: CDRRRecord): CDRRRecord | null {
  const fields: (keyof CDRRRecord)[] = [
    "registration_number",
    "generic_name",
    "brand_name",
    "dosage_strength",
    "dosage_form",
    "classification",
    "packaging",
    "manufacturer",
    "country_of_origin",
    "trader",
    "importer",
    "distributor",
    "app_type",
    "issuance_date",
    "expiry_date",
    "pharmacologic_category",
  ];

  for (const field of fields) {
    const value = record[field];
    if (typeof value === "string" && containsNonAscii(value)) {
      // Auto-sanitize: replace non-ASCII with closest ASCII equivalent or ?
      const sanitized = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
        .replace(/[^\x00-\x7F]/g, "?"); // Replace remaining with ?

      (record as Record<string, string>)[field] = sanitized;
    }
  }

  return record;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

function generateSubQueries(query: string): string[] {
  const subQueries: string[] = [];
  for (let i = 65; i <= 90; i++) {
    subQueries.push(query + String.fromCharCode(i));
  }
  return subQueries;
}

async function processQuery(
  item: QueueItem,
  state: ProcessingState
): Promise<{ success: boolean; shouldDrillDown: boolean; recordsFound: number }> {
  const result = await queryAPI(item.query);

  if (result.type === "success") {
    const cdrrRecords = result.data.cdrr || [];

    if (cdrrRecords.length > 0) {
      // Sanitize and validate records
      const validRecords: CDRRRecord[] = [];

      for (let i = 0; i < cdrrRecords.length; i++) {
        const rawRecord = cdrrRecords[i];
        if (!rawRecord) continue;
        const record = sanitizeRecord(rawRecord);
        if (record) {
          validRecords.push(record);
        }
      }

      const added = appendToCsv(validRecords, state);
      log(`Query ${item.query}: Found ${cdrrRecords.length} CDRR records, ${added} new added`);
      return { success: true, shouldDrillDown: false, recordsFound: added };
    }

    // No CDRR records found - DO NOT drill down if no records returned
    // This prevents infinite loops on empty branches
    return { success: true, shouldDrillDown: false, recordsFound: 0 };
  }

  if (result.type === "parse_error") {
    log(`Parse error for query ${item.query}: ${result.error}`);
    // Only drill down on parse errors if we haven't reached max depth
    const shouldDrillDown = item.depth < CONFIG.MAX_DRILL_DOWN_DEPTH;
    return { success: false, shouldDrillDown, recordsFound: 0 };
  }

  if (result.type === "empty") {
    log(`Empty response for query: ${item.query}`);
    return { success: true, shouldDrillDown: false, recordsFound: 0 };
  }

  // Error case
  log(`Error for query ${item.query}: ${result.error}`);
  return {
    success: false,
    shouldDrillDown: result.shouldDrillDown || false,
    recordsFound: 0,
  };
}

async function runHarvester(resume = false) {
  log("=".repeat(60));
  log("FDA Philippines Drug Product Harvester Starting");
  log("=".repeat(60));

  let state: ProcessingState;

  if (resume) {
    const loaded = loadState();
    if (loaded) {
      state = loaded;
      log(`Resumed from save point: ${state.totalProcessed} records processed`);

      if (state.pendingUserDecision) {
        log(`Pending decision from previous run for query: ${state.pendingUserDecision.query}`);
        // Handle pending decision here if needed
        delete state.pendingUserDecision;
      }
    } else {
      log("No state file found, starting fresh");
      state = createInitialState();
    }
  } else {
    // Fresh start - backup existing state if exists
    if (existsSync(CONFIG.STATE_FILE)) {
      const backupName = `${CONFIG.STATE_FILE}.backup.${Date.now()}`;
      writeFileSync(backupName, readFileSync(CONFIG.STATE_FILE));
      log(`Backed up existing state to ${backupName}`);
    }
    state = createInitialState();
  }

  initializeCsv();
  saveState(state);

  // Setup graceful shutdown
  let isShuttingDown = false;

  const handleShutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log(`\nReceived ${signal}. Saving state and exiting gracefully...`);
    state.interruptedAt = new Date().toISOString();
    saveState(state);
    process.exit(0);
  };

  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));

  // Main processing loop
  while (state.queryQueue.length > 0 && !isShuttingDown) {
    const item = state.queryQueue.shift()!;

    if (state.completedQueries.has(item.query)) {
      continue;
    }

    const result = await processQuery(item, state);

    if (result.success) {
      state.completedQueries.add(item.query);
      state.totalProcessed += result.recordsFound;

      // If we should drill down, add sub-queries
      if (result.shouldDrillDown && item.depth < CONFIG.MAX_DRILL_DOWN_DEPTH) {
        const subQueries = generateSubQueries(item.query);
        // Add to front of queue for depth-first search (more efficient)
        for (const sq of subQueries.reverse()) {
          if (!state.completedQueries.has(sq)) {
            state.queryQueue.unshift({
              query: sq,
              depth: item.depth + 1,
              parentQuery: item.query,
            });
          }
        }
        log(`Drilling down: ${item.query} -> [${subQueries.join(", ")}]`);
      }
    } else {
      // Failed - check if we should retry or drill down
      const existingFail = state.failedQueries.get(item.query);
      const retries = (existingFail?.retries || 0) + 1;

      if (result.shouldDrillDown && item.depth < CONFIG.MAX_DRILL_DOWN_DEPTH) {
        // Drill down immediately on server errors (500, timeout, etc.)
        const subQueries = generateSubQueries(item.query);
        for (const sq of subQueries.reverse()) {
          if (!state.completedQueries.has(sq) && !state.queryQueue.some(q => q.query === sq)) {
            state.queryQueue.unshift({
              query: sq,
              depth: item.depth + 1,
              parentQuery: item.query,
            });
          }
        }
        log(`Drilling down on error: ${item.query} -> [${subQueries.join(", ")}]`);
        state.completedQueries.add(item.query); // Mark as processed to avoid retry
        state.failedQueries.delete(item.query); // Remove from failed if it was there
      } else if (retries < CONFIG.MAX_RETRIES) {
        // Retry later for non-drillable failures
        state.failedQueries.set(item.query, {
          error: "Failed to process",
          timestamp: Date.now(),
          retries,
        });
        // Put back in queue if retries left
        if (retries < CONFIG.MAX_RETRIES * 2) {
          state.queryQueue.push(item);
        }
      }
    }

    // Save state periodically
    if (state.totalProcessed % CONFIG.SAVE_INTERVAL === 0) {
      saveState(state);
    }

    // Delay to be respectful to the server
    await delay(CONFIG.DELAY_MS);
  }

  // Final save
  saveState(state);
  log("=".repeat(60));
  log(`Harvest complete! Total records: ${state.totalProcessed}`);
  log(`CSV file: ${CONFIG.CSV_FILE}`);
  log(`State file: ${CONFIG.STATE_FILE}`);
  log("=".repeat(60));
}

// ============================================================================
// CLI INTERFACE
// ============================================================================

function printUsage() {
  console.log(`
FDA Philippines Drug Product Harvester

Usage:
  bun run fda_harvester.ts [command] [options]

Commands:
  start       Start fresh harvest (resets state)
  resume      Resume from previous save point
  status      Show current status without running
  reset       Reset state and start over

Options:
  --help, -h  Show this help message

Examples:
  bun run fda_harvester.ts start
  bun run fda_harvester.ts resume
`);
}

function showStatus() {
  const state = loadState();
  if (!state) {
    console.log("No state file found. Run with 'start' to begin.");
    return;
  }

  console.log(`
=== Harvester Status ===
Start Time:           ${state.startTime}
Last Saved:           ${state.lastSaved}
Total Processed:      ${state.totalProcessed} records
Queue Size:           ${state.queryQueue.length} queries pending
Completed Queries:    ${state.completedQueries.size}
Failed Queries:       ${state.failedQueries.size}
Unique Registrations: ${state.registrationNumbers.size}
${state.interruptedAt ? `Last Interrupted:     ${state.interruptedAt}` : ""}
`);
}

// Main entry point
async function main() {
  const args = process.argv.slice(2);
  const command = args[0]?.toLowerCase();

  switch (command) {
    case "start":
      await runHarvester(false);
      break;
    case "resume":
      await runHarvester(true);
      break;
    case "status":
      showStatus();
      break;
    case "reset":
      console.log("Resetting state...");
      if (existsSync(CONFIG.STATE_FILE)) {
        const backupName = `${CONFIG.STATE_FILE}.backup.${Date.now()}`;
        writeFileSync(backupName, readFileSync(CONFIG.STATE_FILE));
        console.log(`Old state backed up to ${backupName}`);
      }
      const fresh = createInitialState();
      saveState(fresh);
      console.log("State reset. Run with 'start' to begin fresh harvest.");
      break;
    case "--help":
    case "-h":
    case undefined:
    default:
      printUsage();
      break;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

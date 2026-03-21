#!/usr/bin/env bun
/**
 * Statistics Script
 * Shows detailed statistics about the harvested data
 */

import { existsSync, readFileSync } from "fs";

const STATE_FILE = "fda_harvester_state.json";
const CSV_FILE = "fda_harvested_products.csv";
const LOG_FILE = "fda_harvester.log";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function showStats() {
  console.log("=".repeat(60));
  console.log("FDA Harvester Statistics");
  console.log("=".repeat(60));

  // State file stats
  if (existsSync(STATE_FILE)) {
    try {
      const state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      console.log("\n📊 State File:");
      console.log(`   Start Time: ${state.startTime || "N/A"}`);
      console.log(`   Last Saved: ${state.lastSaved || "N/A"}`);
      console.log(`   Total Processed: ${state.totalProcessed || 0}`);
      console.log(`   Queue Size: ${state.queryQueue?.length || 0} pending`);
      console.log(`   Completed Queries: ${state.completedQueries?.length || 0}`);
      console.log(`   Failed Queries: ${state.failedQueries?.length || 0}`);
      console.log(`   Unique Registrations: ${state.registrationNumbers?.length || 0}`);

      if (state.interruptedAt) {
        console.log(`   ⚠️ Interrupted at: ${state.interruptedAt}`);
      }

      if (state.pendingUserDecision) {
        console.log(`   ⚠️ Pending user decision for query: ${state.pendingUserDecision.query}`);
      }

      // Show next 5 queries in queue
      if (state.queryQueue?.length > 0) {
        console.log(`\n   Next 5 queries to process:`);
        state.queryQueue.slice(0, 5).forEach((q: { query: string; depth: number }, i: number) => {
          console.log(`     ${i + 1}. ${q.query} (depth: ${q.depth})`);
        });
      }
    } catch (e) {
      console.log("\n⚠️ Error reading state file");
    }
  } else {
    console.log("\n📊 State File: Not found");
  }

  // CSV stats
  if (existsSync(CSV_FILE)) {
    try {
      const content = readFileSync(CSV_FILE, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());
      const dataRows = lines.slice(1);

      console.log("\n📁 CSV File:");
      console.log(`   Total Records: ${dataRows.length}`);

      // Count by country
      const countryCount = new Map<string, number>();
      const manufacturerCount = new Map<string, number>();
      const classificationCount = new Map<string, number>();

      for (const line of dataRows) {
        const fields = parseCsvLine(line);
        if (fields.length >= 11) {
          const country = fields[10]?.replace(/^"|"$/g, "") || "Unknown";
          const manufacturer = fields[9]?.replace(/^"|"$/g, "") || "Unknown";
          const classification = fields[6]?.replace(/^"|"$/g, "") || "Unknown";

          countryCount.set(country, (countryCount.get(country) || 0) + 1);
          manufacturerCount.set(manufacturer, (manufacturerCount.get(manufacturer) || 0) + 1);
          classificationCount.set(classification, (classificationCount.get(classification) || 0) + 1);
        }
      }

      console.log("\n   Top 10 Countries:");
      Array.from(countryCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([country, count]) => {
          console.log(`     ${country}: ${count}`);
        });

      console.log("\n   Classifications:");
      Array.from(classificationCount.entries())
        .sort((a, b) => b[1] - a[1])
        .forEach(([cls, count]) => {
          console.log(`     ${cls}: ${count}`);
        });

    } catch (e) {
      console.log("\n⚠️ Error reading CSV file");
    }
  } else {
    console.log("\n📁 CSV File: Not found");
  }

  // Log file stats
  if (existsSync(LOG_FILE)) {
    try {
      const logContent = readFileSync(LOG_FILE, "utf-8");
      const logLines = logContent.split("\n").filter((l) => l.trim());
      console.log("\n📝 Log File:");
      console.log(`   Total Entries: ${logLines.length}`);

      // Show last few entries
      console.log("\n   Last 5 log entries:");
      logLines.slice(-5).forEach((line) => {
        console.log(`     ${line.substring(0, 80)}...`);
      });
    } catch (e) {
      console.log("\n⚠️ Error reading log file");
    }
  }

  console.log("\n" + "=".repeat(60));
}

showStats();

#!/usr/bin/env bun
/**
 * CSV Validation Script
 * Validates the harvested CSV for data integrity
 */

import { existsSync, readFileSync } from "fs";

const CSV_FILE = "fda_harvested_products.csv";

function validateCsv() {
  if (!existsSync(CSV_FILE)) {
    console.log(`CSV file not found: ${CSV_FILE}`);
    process.exit(1);
  }

  const content = readFileSync(CSV_FILE, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  console.log(`Total lines (including header): ${lines.length}`);

  if (lines.length === 0) {
    console.log("Empty CSV file");
    return;
  }

  // Check header
  const header = lines[0];
  const expectedHeaders = [
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

  const headers = header.split(",").map((h) => h.replace(/^"|"$/g, ""));
  console.log(`\nHeaders (${headers.length}):`);
  console.log(headers.join(" | "));

  // Validate data rows
  const dataRows = lines.slice(1);
  const regNumbers = new Set<string>();
  const duplicates: string[] = [];
  const emptyRegNumbers: number[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const line = dataRows[i];
    const fields = parseCsvLine(line);

    if (fields.length < 2) {
      console.log(`Line ${i + 2}: Malformed line - ${line.substring(0, 50)}...`);
      continue;
    }

    const regNum = fields[1]?.replace(/^"|"$/g, "");
    if (!regNum || regNum.trim() === "") {
      emptyRegNumbers.push(i + 2);
    } else if (regNumbers.has(regNum)) {
      duplicates.push(regNum);
    } else {
      regNumbers.add(regNum);
    }
  }

  console.log(`\n=== Validation Results ===`);
  console.log(`Total data rows: ${dataRows.length}`);
  console.log(`Unique registration numbers: ${regNumbers.size}`);

  if (duplicates.length > 0) {
    console.log(`⚠️ Duplicate registration numbers found: ${duplicates.length}`);
    console.log(duplicates.slice(0, 10).join(", "));
    if (duplicates.length > 10) console.log(`... and ${duplicates.length - 10} more`);
  } else {
    console.log(`✅ No duplicate registration numbers`);
  }

  if (emptyRegNumbers.length > 0) {
    console.log(`⚠️ Rows with empty registration numbers: ${emptyRegNumbers.length}`);
    console.log(`Line numbers: ${emptyRegNumbers.slice(0, 10).join(", ")}`);
  } else {
    console.log(`✅ All rows have registration numbers`);
  }

  // Sample data
  console.log(`\n=== Sample Records ===`);
  for (let i = 0; i < Math.min(3, dataRows.length); i++) {
    const fields = parseCsvLine(dataRows[i]);
    console.log(`\nRecord ${i + 1}:`);
    console.log(`  Reg#: ${fields[1] || "N/A"}`);
    console.log(`  Generic: ${fields[2] || "N/A"}`);
    console.log(`  Brand: ${fields[3] || "N/A"}`);
    console.log(`  Manufacturer: ${fields[9] || "N/A"}`);
  }
}

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
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

validateCsv();

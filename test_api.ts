#!/usr/bin/env bun
/**
 * API Test Script
 * Test the FDA API to ensure it works before running the full harvest
 */

const API_BASE_URL = "https://verification.fda.gov.ph/api/search";

async function testAPI() {
  console.log("Testing FDA Philippines API...\n");

  const testQueries = ["A", "Mounjaro", "Tirzepatide", "DR-XY49501"];

  for (const query of testQueries) {
    const url = `${API_BASE_URL}?q=${encodeURIComponent(query)}`;
    console.log(`Query: "${query}"`);
    console.log(`URL: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
          Referer: "https://verification.fda.gov.ph/",
        },
      });

      clearTimeout(timeoutId);

      console.log(`Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        console.log(`❌ Error: HTTP ${response.status}\n`);
        continue;
      }

      const text = await response.text();
      console.log(`Response size: ${text.length} bytes`);

      if (!text || text.trim() === "") {
        console.log("⚠️ Empty response\n");
        continue;
      }

      try {
        const data = JSON.parse(text);
        const cdrrCount = data.cdrr?.length || 0;
        console.log(`CDRR records found: ${cdrrCount}`);

        if (cdrrCount > 0) {
          console.log("\nSample CDRR record:");
          const sample = data.cdrr[0];
          console.log(`  Reg#: ${sample.registration_number}`);
          console.log(`  Generic: ${sample.generic_name}`);
          console.log(`  Brand: ${sample.brand_name}`);
          console.log(`  Manufacturer: ${sample.manufacturer}`);
        }

        console.log("✅ Success\n");
      } catch (parseError) {
        console.log(`❌ Parse error: ${parseError}`);
        console.log(`Raw response (first 200 chars): ${text.substring(0, 200)}...\n`);
      }
    } catch (error) {
      console.log(`❌ Request failed: ${error}\n`);
    }

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

testAPI().catch(console.error);

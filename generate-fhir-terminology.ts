/**
 * FHIR Terminology Generator for Philippine FDA Drug Products
 * Generates CodeSystem and ValueSet resources from CSV
 *
 * Run with: bun run generate-fhir-terminology.ts
 * Run with upload: bun run generate-fhir-terminology.ts --upload
 */

import { parse } from "csv-parse/sync";
import { createInterface } from "readline";

// Configuration
const CONFIG = {
  csvPath: "./Combined_All_CPR.csv",
  outputDir: "./fhir-terminology",
  codeSystemUrl: "https://thomasreyes.vercel.app/ph-fda",
  codeSystemName: "TestPHFDACPRCS",
  codeSystemTitle: "Test PH FDA Certificate of Product Registration (CPR) CodeSystem",
  valueSetName: "TestPHFDACPRVS",
  valueSetTitle: "Test PH FDA Certificate of Product Registration (CPR) ValueSet",
  valueSetUrl: "https://thomasreyes.vercel.app/ph-fda/vs",
  terminologyServer: "https://tx.fhirlab.net/fhir",
};

/**
 * Generate version string in format YYYY.MM.DD.HHMM based on current date/time
 */
function generateVersion(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}.${month}.${day}.${hours}${minutes}`;
}

// CSV Column indices (0-based)
const COLUMNS = {
  productInfo: 0,
  registrationNumber: 1,
  genericName: 2,
  brandName: 3,
  dosageStrength: 4,
  dosageForm: 5,
  classification: 6,
  packaging: 7,
  pharmacologicCategory: 8,
  manufacturer: 9,
  countryOfOrigin: 10,
  trader: 11,
  importer: 12,
  distributor: 13,
  applicationType: 14,
  issuanceDate: 15,
  expiryDate: 16,
} as const;

// Property definitions for CodeSystem
const PROPERTY_DEFINITIONS = [
  { code: "productInfo", type: "string", description: "Product information document" },
  { code: "genericName", type: "string", description: "Generic/INN name of the drug" },
  { code: "dosageStrength", type: "string", description: "Dosage strength/concentration" },
  { code: "dosageForm", type: "string", description: "Dosage form (e.g., Tablet, Injection)" },
  { code: "classification", type: "string", description: "Drug classification (RX, OTC, etc.)" },
  { code: "packaging", type: "string", description: "Packaging description" },
  { code: "pharmacologicCategory", type: "string", description: "Pharmacologic/therapeutic category" },
  { code: "manufacturer", type: "string", description: "Drug manufacturer" },
  { code: "countryOfOrigin", type: "string", description: "Country where manufactured" },
  { code: "trader", type: "string", description: "Trading company" },
  { code: "importer", type: "string", description: "Importing company" },
  { code: "distributor", type: "string", description: "Distributing company" },
  { code: "applicationType", type: "string", description: "Type of FDA application" },
  { code: "issuanceDate", type: "string", description: "Registration issuance date" },
  { code: "expiryDate", type: "string", description: "Registration expiry date" },
];

interface DrugProduct {
  productInfo: string;
  registrationNumber: string;
  genericName: string;
  brandName: string;
  dosageStrength: string;
  dosageForm: string;
  classification: string;
  packaging: string;
  pharmacologicCategory: string;
  manufacturer: string;
  countryOfOrigin: string;
  trader: string;
  importer: string;
  distributor: string;
  applicationType: string;
  issuanceDate: string;
  expiryDate: string;
}

interface ConceptDefinition {
  code: string;
  display: string;
  definition?: string;
  property?: Array<{
    code: string;
    valueString: string;
  }>;
  concept?: ConceptDefinition[];
}

interface FHIRCodeSystem {
  resourceType: "CodeSystem";
  id: string;
  url: string;
  version: string;
  name: string;
  title: string;
  status: "active" | "draft" | "retired" | "unknown";
  experimental: boolean;
  date: string;
  publisher: string;
  description: string;
  caseSensitive: boolean;
  content: "complete" | "fragment" | "not-present" | "supplement";
  hierarchyMeaning?: "is-a" | "part-of" | "grouped-by" | "subsumed-by";
  count: number;
  property: Array<{
    code: string;
    type: string;
    description: string;
  }>;
  concept: ConceptDefinition[];
}

interface CodeSystemResult {
  codeSystem: FHIRCodeSystem;
  duplicates: Array<{ code: string; count: number }>;
  totalDuplicates: number;
}

interface FHIRValueSet {
  resourceType: "ValueSet";
  id: string;
  url: string;
  version: string;
  name: string;
  title: string;
  status: "active" | "draft" | "retired" | "unknown";
  experimental: boolean;
  date: string;
  publisher: string;
  description: string;
  compose: {
    include: Array<{
      system: string;
    }>;
  };
}

/**
 * Prompt user for confirmation
 */
function confirmUpload(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("🚀 Upload generated files to terminology server? (y/N): ", (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

/**
 * Upload a FHIR resource to the terminology server using PUT
 */
async function uploadResource(
  resourceType: string,
  resourceId: string,
  resourceData: object,
  serverUrl: string
): Promise<{ success: boolean; status: number; message: string }> {
  const url = `${serverUrl}/${resourceType}/${resourceId}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/fhir+json",
        Accept: "application/fhir+json",
      },
      body: JSON.stringify(resourceData),
    });

    const responseText = await response.text();

    if (response.ok) {
      return {
        success: true,
        status: response.status,
        message: `Successfully uploaded ${resourceType}/${resourceId}`,
      };
    } else {
      return {
        success: false,
        status: response.status,
        message: `Failed to upload ${resourceType}/${resourceId}: ${response.status} ${response.statusText}${responseText ? " - " + responseText : ""}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      status: 0,
      message: `Network error uploading ${resourceType}/${resourceId}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function readCSV(filePath: string): Promise<DrugProduct[]> {
  const file = Bun.file(filePath);
  const content = await file.text();

  const records = parse(content, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
  });

  // Skip header row
  const dataRows = records.slice(1);

  return dataRows.map((row: string[]) => ({
    productInfo: row[COLUMNS.productInfo] || "",
    registrationNumber: row[COLUMNS.registrationNumber] || "",
    genericName: row[COLUMNS.genericName] || "",
    brandName: row[COLUMNS.brandName] || "",
    dosageStrength: row[COLUMNS.dosageStrength] || "",
    dosageForm: row[COLUMNS.dosageForm] || "",
    classification: row[COLUMNS.classification] || "",
    packaging: row[COLUMNS.packaging] || "",
    pharmacologicCategory: row[COLUMNS.pharmacologicCategory] || "",
    manufacturer: row[COLUMNS.manufacturer] || "",
    countryOfOrigin: row[COLUMNS.countryOfOrigin] || "",
    trader: row[COLUMNS.trader] || "",
    importer: row[COLUMNS.importer] || "",
    distributor: row[COLUMNS.distributor] || "",
    applicationType: row[COLUMNS.applicationType] || "",
    issuanceDate: row[COLUMNS.issuanceDate] || "",
    expiryDate: row[COLUMNS.expiryDate] || "",
  }));
}

function createPropertyValue(code: string, value: string): { code: string; valueString: string } | null {
  // Only include non-empty properties
  if (!value || value.trim() === "" || value.trim().toUpperCase() === "N/A") {
    return null;
  }
  return { code, valueString: value.trim() };
}

function generateCodeSystem(products: DrugProduct[]): CodeSystemResult {
  const today = new Date().toISOString().split("T")[0];
  const version = generateVersion();

  // Track duplicates for reporting
  const seenCodes = new Set<string>();
  const duplicates: Array<{ code: string; count: number }> = [];

  const concepts = products
    .filter((p) => p.registrationNumber && p.registrationNumber.trim() !== "")
    .filter((product) => {
      const code = product.registrationNumber.trim();
      if (seenCodes.has(code)) {
        const existing = duplicates.find((d) => d.code === code);
        if (existing) {
          existing.count++;
        } else {
          duplicates.push({ code, count: 2 });
        }
        return false; // Skip duplicate
      }
      seenCodes.add(code);
      return true;
    })
    .map((product) => {
      const properties = [
        createPropertyValue("productInfo", product.productInfo),
        createPropertyValue("genericName", product.genericName),
        createPropertyValue("dosageStrength", product.dosageStrength),
        createPropertyValue("dosageForm", product.dosageForm),
        createPropertyValue("classification", product.classification),
        createPropertyValue("packaging", product.packaging),
        createPropertyValue("pharmacologicCategory", product.pharmacologicCategory),
        createPropertyValue("manufacturer", product.manufacturer),
        createPropertyValue("countryOfOrigin", product.countryOfOrigin),
        createPropertyValue("trader", product.trader),
        createPropertyValue("importer", product.importer),
        createPropertyValue("distributor", product.distributor),
        createPropertyValue("applicationType", product.applicationType),
        createPropertyValue("issuanceDate", product.issuanceDate),
        createPropertyValue("expiryDate", product.expiryDate),
      ].filter((p): p is { code: string; valueString: string } => p !== null);

      return {
        code: product.registrationNumber.trim(),
        display: product.brandName.trim() || product.genericName.trim() || product.registrationNumber.trim(),
        property: properties,
      };
    });

  const totalDuplicates = duplicates.reduce((sum, d) => sum + (d.count - 1), 0);

  // Create root parent concept with all drugs nested underneath
  const rootConcept: ConceptDefinition = {
    code: "PH-FDA-DRUGS",
    display: "Philippine FDA Registered Drug Products",
    definition: "Root concept for all FDA Certificate of Product Registration (CPR) registered medications in the Philippines",
    concept: concepts,
  };

  return {
    codeSystem: {
      resourceType: "CodeSystem",
      id: CONFIG.codeSystemName,
      url: CONFIG.codeSystemUrl,
      version,
      name: CONFIG.codeSystemName,
      title: CONFIG.codeSystemTitle,
      status: "active",
      experimental: false,
      date: today,
      publisher: "Thomas Reyes",
      description: "Registered drug products from the Philippine Food and Drug Administration (FDA)",
      caseSensitive: false,
      content: "complete",
      hierarchyMeaning: "is-a",
      count: concepts.length + 1, // +1 for root concept
      property: PROPERTY_DEFINITIONS,
      concept: [rootConcept],
    },
    duplicates,
    totalDuplicates,
  };
}

function generateValueSet(): FHIRValueSet {
  const today = new Date().toISOString().split("T")[0];
  const version = generateVersion();

  return {
    resourceType: "ValueSet",
    id: CONFIG.valueSetName,
    url: CONFIG.codeSystemUrl,  // Same as CodeSystem for implicit ValueSet pattern
    version: version,
    name: CONFIG.valueSetName,
    title: CONFIG.valueSetTitle,
    status: "active",
    experimental: false,
    date: today,
    publisher: "Thomas Reyes",
    description: "ValueSet containing all registered drug products from the Philippine FDA",
    compose: {
      include: [
        {
          system: CONFIG.codeSystemUrl,
        },
      ],
    },
  };
}

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const shouldUpload = args.includes("--upload") || args.includes("-u");

  console.log("📖 Reading CSV file...");
  const products = await readCSV(CONFIG.csvPath);
  console.log(`✅ Loaded ${products.length} drug products`);

  console.log("\n🔧 Generating FHIR CodeSystem...");
  const codeSystemResult = generateCodeSystem(products);
  const codeSystem = codeSystemResult.codeSystem;
  console.log(`✅ CodeSystem generated with ${codeSystem.count} concepts`);

  if (codeSystemResult.duplicates.length > 0) {
    console.log(`⚠️  Found ${codeSystemResult.duplicates.length} duplicate registration numbers:`);
    codeSystemResult.duplicates.forEach(d => {
      console.log(`   - ${d.code}: ${d.count} occurrences (kept first, skipped ${d.count - 1})`);
    });
  }

  console.log("\n🔧 Generating FHIR ValueSet...");
  const valueSet = generateValueSet();
  console.log("✅ ValueSet generated");

  // Create output directory
  const outputDir = CONFIG.outputDir;
  await Bun.write(`${outputDir}/.gitkeep`, "");

  // Write CodeSystem
  const codeSystemPath = `${outputDir}/ph-fda-codesystem.json`;
  await Bun.write(codeSystemPath, JSON.stringify(codeSystem, null, 2));
  console.log(`\n💾 CodeSystem saved to: ${codeSystemPath}`);

  // Write ValueSet
  const valueSetPath = `${outputDir}/ph-fda-valueset.json`;
  await Bun.write(valueSetPath, JSON.stringify(valueSet, null, 2));
  console.log(`💾 ValueSet saved to: ${valueSetPath}`);

  // Generate summary
  const summary = {
    generatedAt: new Date().toISOString(),
    version: codeSystem.version,
    terminologyServer: CONFIG.terminologyServer,
    totalProducts: products.length,
    uniqueRegistrationNumbers: codeSystem.count,
    duplicatesRemoved: {
      count: codeSystemResult.duplicates.length,
      totalInstances: codeSystemResult.totalDuplicates,
      codes: codeSystemResult.duplicates,
    },
    codeSystem: {
      url: codeSystem.url,
      version: codeSystem.version,
      conceptCount: codeSystem.count,
      path: codeSystemPath,
    },
    valueSet: {
      url: valueSet.url,
      version: valueSet.version,
      path: valueSetPath,
    },
    sampleConcepts: codeSystem.concept.slice(0, 3),
  };

  const summaryPath = `${outputDir}/summary.json`;
  await Bun.write(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`💾 Summary saved to: ${summaryPath}`);

  console.log("\n" + "=".repeat(60));
  console.log("✅ FHIR Terminology generation complete!");
  console.log("=".repeat(60));
  console.log(`\n📊 Statistics:`);
  console.log(`   Version: ${codeSystem.version}`);
  console.log(`   Total products: ${summary.totalProducts}`);
  console.log(`   Unique registration numbers: ${summary.uniqueRegistrationNumbers}`);
  console.log(`\n📁 Output files:`);
  console.log(`   CodeSystem: ${codeSystemPath}`);
  console.log(`   ValueSet:   ${valueSetPath}`);
  console.log(`\n🔗 CodeSystem URL: ${codeSystem.url}`);
  console.log(`🔗 ValueSet URL:   ${valueSet.url}`);
  // Upload to terminology server if requested
  if (shouldUpload) {
    console.log(`\n🚀 Upload to terminology server enabled`);
    console.log(`   Target server: ${CONFIG.terminologyServer}`);

    const confirmed = await confirmUpload();

    if (confirmed) {
      console.log("\n📤 Uploading to terminology server...");

      // Upload CodeSystem
      console.log(`   PUT ${CONFIG.terminologyServer}/CodeSystem/${CONFIG.codeSystemName}`);
      const codeSystemResult = await uploadResource(
        "CodeSystem",
        CONFIG.codeSystemName,
        codeSystem,
        CONFIG.terminologyServer
      );

      if (codeSystemResult.success) {
        console.log(`   ✅ ${codeSystemResult.message}`);
      } else {
        console.error(`   ❌ ${codeSystemResult.message}`);
      }

      // Upload ValueSet
      console.log(`   PUT ${CONFIG.terminologyServer}/ValueSet/${CONFIG.valueSetName}`);
      const valueSetResult = await uploadResource(
        "ValueSet",
        CONFIG.valueSetName,
        valueSet,
        CONFIG.terminologyServer
      );

      if (valueSetResult.success) {
        console.log(`   ✅ ${valueSetResult.message}`);
      } else {
        console.error(`   ❌ ${valueSetResult.message}`);
      }

      // Summary
      console.log("\n" + "=".repeat(60));
      if (codeSystemResult.success && valueSetResult.success) {
        console.log("✅ All resources uploaded successfully!");
      } else {
        console.log("⚠️  Upload completed with some errors");
      }
      console.log("=".repeat(60));
    } else {
      console.log("\n⏭️  Upload skipped by user");
      console.log(`\n💡 To upload manually, run: bun run generate-fhir-terminology.ts --upload`);
    }
  } else {
    console.log(`\n💡 To upload to the terminology server, run with --upload flag:`);
    console.log(`   bun run generate-fhir-terminology.ts --upload`);
    console.log(`\n   Target server: ${CONFIG.terminologyServer}`);
    console.log("   Or use cURL commands:");
    console.log(`   curl -X PUT ${CONFIG.terminologyServer}/CodeSystem/${CONFIG.codeSystemName} -H 'Content-Type: application/fhir+json' -d @${codeSystemPath}`);
    console.log(`   curl -X PUT ${CONFIG.terminologyServer}/ValueSet/${CONFIG.valueSetName} -H 'Content-Type: application/fhir+json' -d @${valueSetPath}`);
  }
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

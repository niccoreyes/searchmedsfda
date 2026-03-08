/**
 * FHIR Terminology Cleanup Script
 * Deletes all CodeSystem and ValueSet resources with specific URLs
 *
 * Run with: bun run cleanup-terminology.ts
 */

const CONFIG = {
  terminologyServer: "https://tx.fhirlab.net/fhir",
  codeSystemUrl: "https://thomasreyes.vercel.app/ph-fda",
  // Note: ValueSet uses same URL as CodeSystem (implicit ValueSet pattern)
  valueSetUrl: "https://thomasreyes.vercel.app/ph-fda",
};

interface FHIRBundle {
  resourceType: "Bundle";
  type: string;
  total?: number;
  entry?: Array<{
    resource: {
      resourceType: string;
      id: string;
      url: string;
      version?: string;
    };
  }>;
}

async function searchResources(resourceType: string, url: string): Promise<string[]> {
  const searchUrl = `${CONFIG.terminologyServer}/${resourceType}?url=${encodeURIComponent(url)}`;

  try {
    const response = await fetch(searchUrl, {
      headers: { Accept: "application/fhir+json" },
    });

    if (!response.ok) {
      console.log(`  Search failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as FHIRBundle;

    if (data.resourceType === "Bundle" && data.entry) {
      const ids = data.entry.map((entry) => entry.resource.id);
      return ids;
    }

    return [];
  } catch (error) {
    console.log(`  Error searching: ${error}`);
    return [];
  }
}

async function deleteResource(resourceType: string, id: string): Promise<boolean> {
  const deleteUrl = `${CONFIG.terminologyServer}/${resourceType}/${id}`;

  try {
    const response = await fetch(deleteUrl, {
      method: "DELETE",
    });

    if (response.status === 200 || response.status === 204) {
      console.log(`    Successfully deleted ${resourceType}/${id}`);
      return true;
    } else if (response.status === 404) {
      console.log(`    ${resourceType}/${id} not found (already deleted)`);
      return true;
    } else {
      console.log(`    Failed to delete ${resourceType}/${id} (HTTP ${response.status})`);
      return false;
    }
  } catch (error) {
    console.log(`    Error deleting ${resourceType}/${id}: ${error}`);
    return false;
  }
}

async function cleanupResourceType(resourceType: string, url: string) {
  console.log(`\n${resourceType} Cleanup:`);
  console.log(`  Searching by URL: ${url}`);

  // Search for resources
  const ids = await searchResources(resourceType, url);

  if (ids.length === 0) {
    console.log(`  No ${resourceType} resources found with this URL`);
  } else {
    console.log(`  Found ${ids.length} resource(s): ${ids.join(", ")}`);

    for (const id of ids) {
      await deleteResource(resourceType, id);
    }
  }

  // Also try known IDs
  const knownIds =
    resourceType === "CodeSystem"
      ? ["TestPHFDACPRCS", "PHFDARegisteredDrugProducts"]
      : ["TestPHFDACPRVS", "PHFDAAllDrugProducts"];

  console.log(`  Trying known IDs...`);
  for (const id of knownIds) {
    await deleteResource(resourceType, id);
  }
}

async function verifyCleanup() {
  console.log("\n========================================");
  console.log("Verification");
  console.log("========================================");

  // Check CodeSystem
  console.log("\nChecking CodeSystem...");
  const csResponse = await fetch(`${CONFIG.terminologyServer}/CodeSystem/TestPHFDACPRCS`);
  if (csResponse.status === 404) {
    console.log("  CodeSystem TestPHFDACPRCS: Not found (good!)");
  } else {
    console.log(`  CodeSystem TestPHFDACPRCS: Still exists (HTTP ${csResponse.status})`);
  }

  // Check ValueSet
  console.log("Checking ValueSet...");
  const vsResponse = await fetch(`${CONFIG.terminologyServer}/ValueSet/TestPHFDACPRVS`);
  if (vsResponse.status === 404) {
    console.log("  ValueSet TestPHFDACPRVS: Not found (good!)");
  } else {
    console.log(`  ValueSet TestPHFDACPRVS: Still exists (HTTP ${vsResponse.status})`);
  }
}

async function main() {
  console.log("========================================");
  console.log("FHIR Terminology Cleanup Script");
  console.log("========================================");
  console.log(`\nServer: ${CONFIG.terminologyServer}`);
  console.log(`CodeSystem URL: ${CONFIG.codeSystemUrl}`);
  console.log(`ValueSet URL: ${CONFIG.valueSetUrl}`);

  // Cleanup CodeSystems
  await cleanupResourceType("CodeSystem", CONFIG.codeSystemUrl);

  // Cleanup ValueSets
  await cleanupResourceType("ValueSet", CONFIG.valueSetUrl);

  // Verify
  await verifyCleanup();

  console.log("\n========================================");
  console.log("Cleanup Complete");
  console.log("========================================");
  console.log("\nYou can now re-upload the terminology files:");
  console.log("\n1. Upload CodeSystem:");
  console.log(`   curl -X POST ${CONFIG.terminologyServer}/CodeSystem \\`);
  console.log(`     -H 'Content-Type: application/fhir+json' \\`);
  console.log("     -d @./fhir-terminology/ph-fda-codesystem.json");
  console.log("\n2. Upload ValueSet:");
  console.log(`   curl -X POST ${CONFIG.terminologyServer}/ValueSet \\`);
  console.log("     -H 'Content-Type: application/fhir+json' \\");
  console.log("     -d @./fhir-terminology/ph-fda-valueset.json");
  console.log("\n3. Verify upload:");
  console.log(`   curl ${CONFIG.terminologyServer}/CodeSystem/TestPHFDACPRCS`);
  console.log(`   curl ${CONFIG.terminologyServer}/ValueSet/TestPHFDACPRVS`);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});

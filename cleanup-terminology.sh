#!/bin/bash
# Cleanup script for FHIR Terminology Server
# Deletes all CodeSystem and ValueSet resources with specific URLs

TERMINOLOGY_SERVER="https://tx.fhirlab.net/fhir"
CODE_SYSTEM_URL="https://thomasreyes.vercel.app/ph-fda"
VALUE_SET_URL="https://thomasreyes.vercel.app/ph-fda/valueset/all-drugs"

echo "=========================================="
echo "FHIR Terminology Cleanup Script"
echo "=========================================="
echo ""
echo "Server: $TERMINOLOGY_SERVER"
echo "CodeSystem URL: $CODE_SYSTEM_URL"
echo "ValueSet URL: $VALUE_SET_URL"
echo ""

# Function to delete resources by URL
delete_resources_by_url() {
    local resource_type=$1
    local url=$2

    echo "Searching for $resource_type with URL: $url"

    # Search for resources by URL
    response=$(curl -s "$TERMINOLOGY_SERVER/$resource_type?url=$url")

    # Extract IDs from the response (handles both single resource and Bundle)
    ids=$(echo "$response" | grep -o '"id":"[^"]*"' | grep -v '"id":"[^"]*",' | head -20)

    if [ -z "$ids" ]; then
        echo "  No $resource_type found with URL: $url"
        return
    fi

    echo "  Found resources, attempting deletion..."

    # Try to delete by ID directly using common naming patterns
    for id in "TestPHFDACPRCS" "TestPHFDACPRVS" "PHFDARegisteredDrugProducts" "PHFDAAllDrugProducts"; do
        echo "  Attempting to delete $resource_type/$id..."
        delete_response=$(curl -s -X DELETE "$TERMINOLOGY_SERVER/$resource_type/$id" -w "\n%{http_code}")
        http_code=$(echo "$delete_response" | tail -n1)

        if [ "$http_code" = "200" ] || [ "$http_code" = "204" ]; then
            echo "    Successfully deleted $resource_type/$id"
        elif [ "$http_code" = "404" ]; then
            echo "    $resource_type/$id not found (already deleted)"
        else
            echo "    Failed to delete $resource_type/$id (HTTP $http_code)"
        fi
    done
}

# Delete CodeSystems
echo "Step 1: Cleaning up CodeSystems..."
delete_resources_by_url "CodeSystem" "$CODE_SYSTEM_URL"
echo ""

# Delete ValueSets
echo "Step 2: Cleaning up ValueSets..."
delete_resources_by_url "ValueSet" "$VALUE_SET_URL"
echo ""

# Verify cleanup
echo "=========================================="
echo "Verification"
echo "=========================================="
echo ""

echo "Checking CodeSystem..."
cs_check=$(curl -s "$TERMINOLOGY_SERVER/CodeSystem/TestPHFDACPRCS" | grep -o '"severity":"error"' | head -1)
if [ -n "$cs_check" ]; then
    echo "  CodeSystem TestPHFDACPRCS: Not found (good!)"
else
    echo "  CodeSystem TestPHFDACPRCS: Still exists (may need manual cleanup)"
fi

echo "Checking ValueSet..."
vs_check=$(curl -s "$TERMINOLOGY_SERVER/ValueSet/TestPHFDACPRVS" | grep -o '"severity":"error"' | head -1)
if [ -n "$vs_check" ]; then
    echo "  ValueSet TestPHFDACPRVS: Not found (good!)"
else
    echo "  ValueSet TestPHFDACPRVS: Still exists (may need manual cleanup)"
fi

echo ""
echo "=========================================="
echo "Cleanup Complete"
echo "=========================================="
echo ""
echo "You can now re-upload the terminology files:"
echo ""
echo "1. Upload CodeSystem:"
echo "   curl -X POST $TERMINOLOGY_SERVER/CodeSystem \\"
echo "     -H 'Content-Type: application/fhir+json' \\"
echo "     -d @./fhir-terminology/ph-fda-codesystem.json"
echo ""
echo "2. Upload ValueSet:"
echo "   curl -X POST $TERMINOLOGY_SERVER/ValueSet \\"
echo "     -H 'Content-Type: application/fhir+json' \\"
echo "     -d @./fhir-terminology/ph-fda-valueset.json"

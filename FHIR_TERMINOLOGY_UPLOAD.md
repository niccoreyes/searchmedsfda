# FHIR Terminology Upload Guide

This guide explains how to upload the generated FHIR CodeSystem and ValueSet to a terminology server.

## Generated Files

| File | Size | Description |
|------|------|-------------|
| `fhir-terminology/ph-fda-codesystem.json` | ~48 MB | FHIR CodeSystem (TestPHFDACPRCS) |
| `fhir-terminology/ph-fda-valueset.json` | ~500 B | FHIR ValueSet (TestPHFDACPRVS) |
| `fhir-terminology/summary.json` | ~5 KB | Statistics and sample concepts |

## Terminology Server Endpoint

**Base URL:** `https://tx.fhirlab.net/fhir`

## Upload Instructions

### 1. Upload CodeSystem

The CodeSystem must be uploaded first as it contains all the drug product definitions.

**Using cURL:**
```bash
curl -X POST https://tx.fhirlab.net/fhir/CodeSystem \
  -H 'Content-Type: application/fhir+json' \
  -d @./fhir-terminology/ph-fda-codesystem.json
```

**Using HAPI FHIR CLI:**
```bash
hapi-fhir-cli upload-definitions \
  -t https://tx.fhirlab.net/fhir \
  -f ./fhir-terminology/ph-fda-codesystem.json
```

### 2. Upload ValueSet

After the CodeSystem is uploaded, upload the ValueSet.

**Using cURL:**
```bash
curl -X POST https://tx.fhirlab.net/fhir/ValueSet \
  -H 'Content-Type: application/fhir+json' \
  -d @./fhir-terminology/ph-fda-valueset.json
```

### 3. Verify Upload

**Check CodeSystem:**
```bash
curl https://tx.fhirlab.net/fhir/CodeSystem/TestPHFDACPRCS
```

**Check ValueSet:**
```bash
curl https://tx.fhirlab.net/fhir/ValueSet/TestPHFDACPRVS
```

**Expand ValueSet (test if codes are accessible):**
```bash
curl "https://tx.fhirlab.net/fhir/ValueSet/TestPHFDACPRVS/\$expand"
```

**Lookup a specific code:**
```bash
curl "https://tx.fhirlab.net/fhir/CodeSystem/\$lookup?system=https://thomasreyes.vercel.app/ph-fda&code=BR-1004"
```

## FHIR Resource URLs

| Resource | URL |
|----------|-----|
| CodeSystem | `https://thomasreyes.vercel.app/ph-fda` |
| ValueSet | `https://thomasreyes.vercel.app/ph-fda` (same as CodeSystem - implicit ValueSet) |

## Using in FHIR Resources

### Medication Resource Example

```json
{
  "resourceType": "Medication",
  "id": "example-medication",
  "code": {
    "coding": [{
      "system": "https://thomasreyes.vercel.app/ph-fda",
      "code": "BR-1004",
      "display": "Heparin Leo"
    }]
  },
  "form": {
    "coding": [{
      "system": "http://snomed.info/sct",
      "code": "385219001",
      "display": "Solution for injection"
    }]
  }
}
```

### MedicationRequest with ValueSet Binding

```json
{
  "resourceType": "MedicationRequest",
  "medicationCodeableConcept": {
    "coding": [{
      "system": "https://thomasreyes.vercel.app/ph-fda",
      "code": "BR-1004",
      "display": "Heparin Leo"
    }]
  }
}
```

## StructureDefinition Binding Example

If creating a profile that binds to this ValueSet:

```json
{
  "resourceType": "StructureDefinition",
  "id": "PhMedication",
  "name": "PHMedication",
  "type": "Medication",
  "differential": {
    "element": [{
      "id": "Medication.code",
      "path": "Medication.code",
      "binding": {
        "strength": "required",
        "valueSet": "https://thomasreyes.vercel.app/ph-fda"
      }
    }]
  }
}
```

## Regenerating with Updates

To regenerate the terminology files with new CSV data or updated version:

```bash
bun run generate-fhir-terminology.ts
```

The version number is automatically generated with format: `YYYY.MM.DD.HHMM` based on the current date and time.

## Troubleshooting

### Large File Upload Issues

If the 48MB CodeSystem fails to upload due to size limits:

1. **Split into batches** - Modify the generator to create multiple smaller CodeSystems
2. **Use transaction bundle** - Wrap resources in a Bundle with transaction type
3. **Increase server limits** - Configure HAPI FHIR with larger payload limits:
   ```yaml
   hapi:
     fhir:
       server:
         max_binary_size: 104857600  # 100MB
         max_page_size: 50000
   ```

### Duplicate CodeSystem

If you get a duplicate error, use PUT to update instead of POST:

```bash
curl -X PUT https://tx.fhirlab.net/fhir/CodeSystem/TestPHFDACPRCS \
  -H 'Content-Type: application/fhir+json' \
  -d @./fhir-terminology/ph-fda-codesystem.json
```

### Cleanup After Failed Upload (Multiple Resources Error)

If you get an error like `Found more than one Resource with the same URL`, you need to clean up all existing resources before re-uploading.

**Option 1: Using the TypeScript cleanup script (Recommended)**

```bash
bun run cleanup-terminology.ts
```

This script will:
- Search for all CodeSystems with URL `https://thomasreyes.vercel.app/ph-fda`
- Search for all ValueSets with URL `https://thomasreyes.vercel.app/ph-fda` (same as CodeSystem)
- Delete all matching resources
- Verify cleanup was successful

**Option 2: Using the Bash cleanup script**

```bash
chmod +x cleanup-terminology.sh
./cleanup-terminology.sh
```

**Option 3: Manual cleanup**

If the scripts fail, manually delete by ID:

```bash
# Delete CodeSystems
curl -X DELETE https://tx.fhirlab.net/fhir/CodeSystem/TestPHFDACPRCS

# Delete ValueSets
curl -X DELETE https://tx.fhirlab.net/fhir/ValueSet/TestPHFDACPRVS

# If you get "multiple resources" error, search and delete by URL:
curl "https://tx.fhirlab.net/fhir/CodeSystem?url=https://thomasreyes.vercel.app/ph-fda"
curl "https://tx.fhirlab.net/fhir/ValueSet?url=https://thomasreyes.vercel.app/ph-fda"
```

**Verify cleanup:**
```bash
curl https://tx.fhirlab.net/fhir/CodeSystem/TestPHFDACPRCS
# Should return 404 Not Found

curl https://tx.fhirlab.net/fhir/ValueSet/TestPHFDACPRVS
# Should return 404 Not Found
```

**Then re-upload:**
```bash
# Upload CodeSystem first
curl -X POST https://tx.fhirlab.net/fhir/CodeSystem \
  -H 'Content-Type: application/fhir+json' \
  -d @./fhir-terminology/ph-fda-codesystem.json

# Then upload ValueSet
curl -X POST https://tx.fhirlab.net/fhir/ValueSet \
  -H 'Content-Type: application/fhir+json' \
  -d @./fhir-terminology/ph-fda-valueset.json
```

### Duplicate Codes in CSV

The generator script now automatically handles duplicate registration numbers in the source CSV. It will:
- Keep only the first occurrence of each registration number
- Report all duplicates found (see `summary.json`)
- Generate an accurate concept count

**Known Duplicates (as of latest run):**
- DRP-10870 (2 occurrences)
- DRP-11267 (2 occurrences)
- DRP-10144 (2 occurrences)
- DRP-10987 (2 occurrences)

Check `fhir-terminology/summary.json` for the complete list of duplicates in your current generation.

### Version Conflicts

Each generation creates a new version timestamp. If you need to maintain specific versions, rename the output files before uploading.

## Contact

For issues with the terminology server (tx.fhirlab.net), contact the server administrator.
For issues with the generator script, check the summary.json output file for details.

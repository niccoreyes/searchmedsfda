# Rx Builder Architecture

Detailed technical documentation of the application architecture, data flows, and module relationships.

## Table of Contents

- [High-Level Data Flow](#high-level-data-flow)
- [FHIR Integration Flow](#fhir-integration-flow)
- [Prescription Builder State Machine](#prescription-builder-state-machine)
- [Search & Filter Pipeline](#search--filter-pipeline)
- [State Object Reference](#state-object-reference)
- [Key Functions](#key-functions)

---

## High-Level Data Flow

```
┌───────────────────────────────────────────────────────────────────────┐
│                              DATA SOURCES                             │
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│   ┌──────────────────────┐        ┌──────────────────────┐            │
│   │  FHIR Terminology    │        │   Local CSV File     │            │
│   │  Server (Online)     │        │   (Offline Mode)     │            │
│   │                      │        │                      │            │
│   │  • tx.fhirlab.net    │        │  • ALL_DrugProducts  │            │
│   │  • CodeSystem        │        │    .csv              │            │
│   │  • ValueSet          │        │  • User-uploaded     │            │
│   └──────────┬───────────┘        └──────────┬───────────┘            │
│              │                               │                        │
│              │ HTTP GET                      │ FileReader API         │
│              │ (CORS)                        │ (drag-drop or picker)  │
│              ▼                               ▼                        │
│   ┌──────────────────────────────────────────────────────┐            │
│   │              DATA LOADER MODULE (main.js)            │            │
│   │                                                      │            │
│   │  ┌──────────────────┐    ┌──────────────────────┐    │            │
│   │  │ tryFHIRLoad()    │    │ parseAndLoadCSV()    │    │            │
│   │  │                  │    │                      │    │            │
│   │  │ fetch CodeSystem │    │ CSVToArray() parser  │    │            │
│   │  │ convertFHIR      │◄──►│ Build state.data[]   │    │            │
│   │  │ ConceptsToData() │    │                      │    │            │
│   │  └──────────────────┘    └──────────────────────┘    │            │
│   └──────────────────────────┬───────────────────────────┘            │
│                              │                                        │
│                              ▼                                        │
│   ┌──────────────────────────────────────────────────────┐            │
│   │           STATE MANAGEMENT (Singleton)               │            │
│   │                                                      │            │
│   │   state {                                            │            │
│   │     data: [],           // All drug records          │            │
│   │     filtered: [],       // Search results            │            │
│   │     quickIndex: [],     // Search index              │            │
│   │     page, perPage,      // Pagination                │            │
│   │     isDataLoaded,       // Boolean flag              │            │
│   │     dataSource,         // 'fhir' | 'csv'            │            │
│   │     viewMode,           // 'cards' | 'table'         │            │
│   │     ...filters                                       │            │
│   │   }                                                  │            │
│   └──────────────────────────┬───────────────────────────┘            │
│                              │                                        │
│           ┌──────────────────┼──────────────────┐                     │
│           │                  │                  │                     │
│           ▼                  ▼                  ▼                     │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐              │
│   │ SEARCH &     │   │ RX BUILDER   │   │ UI LAYER     │              │
│   │ FILTER       │   │              │   │              │              │
│   │              │   │              │   │              │              │
│   │ filterAnd    │   │ addRxItem()  │   │ Tab Switching│              │
│   │ Render()     │   │ removeItem() │   │ View Toggles │              │
│   │ buildQuick   │   │ updateItem() │   │ Pagination   │              │
│   │ Index()      │   │ saveDraft()  │   │ Toast Notifs │              │
│   │              │   │ loadDraft()  │   │ Print/PDF    │              │
│   └──────┬───────┘   └──────┬───────┘   └──────────────┘              │
│          │                  │                                         │
│          ▼                  ▼                                         │
│   ┌──────────────────────────────────────┐                            │
│   │         DOM RENDERING                │                            │
│   │                                      │                            │
│   │  ┌─────────────┐  ┌────────────────┐ │                            │
│   │  │ Card View   │  │ Prescription   │ │                            │
│   │  │ (Mobile)    │  │ Print Template │ │                            │
│   │  └─────────────┘  └────────────────┘ │                            │
│   │  ┌─────────────┐  ┌────────────────┐ │                            │
│   │  │ Table View  │  │ Live Preview   │ │                            │
│   │  │ (Desktop)   │  │ Panel          │ │                            │
│   │  └─────────────┘  └────────────────┘ │                            │
│   └──────────────────────────────────────┘                            │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## FHIR Integration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FHIR DATA INTEGRATION                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │              FHIR TERMINOLOGY SERVER                        │    │
│  │                   tx.fhirlab.net                            │    │
│  │                                                             │    │
│  │  ┌─────────────────────┐    ┌─────────────────────┐         │    │
│  │  │   CodeSystem        │    │     ValueSet        │         │    │
│  │  │   TestPHFDACPRCS    │    │   TestPHFDACPRVS    │         │    │
│  │  │                     │    │                     │         │    │
│  │  │ • 34,000+ concepts  │    │ • References CS     │         │    │
│  │  │ • All drug props    │◄───┤ • Expansion ready   │         │    │
│  │  │ • versioned         │    │                     │         │    │
│  │  └─────────────────────┘    └─────────────────────┘         │    │
│  └───────────────────────────┬─────────────────────────────────┘    │
│                              │                                      │
│                              │ GET /CodeSystem/{id}                 │
│                              │ (28MB payload, ~34K concepts)        │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │              CLIENT-SIDE FHIR PROCESSOR                      │   │
│  │                                                              │   │
│  │  fetchAllValueSetConcepts()                                  │   │
│  │       │                                                      │   │
│  │       ▼                                                      │   │
│  │  ┌────────────────────────────────────────────────────┐      │   │
│  │  │ Concept Array                                      │      │   │
│  │  │ [{                                                 │      │   │
│  │  │   code: "BR-...",     ← Registration Number        │      │   │
│  │  │   display: "...",     ← Brand Name                 │      │   │
│  │  │   property: [                                      │      │   │
│  │  │     {code:"genericName", valueString:"Amlodipine"},│      │   │
│  │  │     {code:"dosageStrength", valueString:"5mg"},    │      │   │
│  │  │     ...                                            │      │   │
│  │  │   ]                                                │      │   │
│  │  │ }]                                                 │      │   │
│  │  └────────┬───────────────────────────────────────────┘      │   │
│  │           │                                                  │   │
│  │           ▼                                                  │   │
│  │  convertFHIRConceptsToData()                                 │   │
│  │       │                                                      │   │
│  │       ▼                                                      │   │
│  │  ┌──────────────────────────────┐                            │   │
│  │  │ App Data Format   ← Normalized to CSV structure           │   │
│  │  │ {                            │                            │   │
│  │  │   "Generic Name": "...",     │                            │   │
│  │  │   "Brand Name": "...",       │                            │   │
│  │  │   "Dosage Strength": "...",  │                            │   │
│  │  │   ...                        │                            │   │
│  │  │ }                            │                            │   │
│  │  └──────────────────────────────┘                            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Prescription Builder State Machine

```
┌────────────────────────────────────────────────────────────────────┐
│                  PRESCRIPTION BUILDER FLOW                         │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│   ┌──────────────┐                                                 │
│   │   EMPTY RX   │                                                 │
│   │  (no items)  │◄──────────────────────────────────────┐         │
│   └──────┬───────┘                                       │         │
│          │                                               │         │
│          │ addRxItem()                                   │         │
│          │ (from search or custom)                       │         │
│          ▼                                               │         │
│   ┌──────────────┐     updateQty()     ┌──────────────┐  │         │
│   │  ACTIVE RX   │────────────────────►│  MODIFIED    │  │         │
│   │  (has items) │◄────────────────────│   ITEM       │  │         │
│   └──────┬───────┘     updateDir()     └──────────────┘  │         │
│          │                                               │         │
│          │ removeItem()                                  │         │
│          │ (last item)                                   │         │
│          │                                               │         │
│          ▼                                               │         │
│   ┌──────────────┐     saveDraft()    ┌──────────────┐   │         │
│   │   SAVED      │───────────────────►│ LOCALSTORAGE │   │         │
│   │   DRAFT      │                    │  (persisted) │   │         │
│   └──────────────┘                    └──────────────┘   │         │
│          ▲                                               │         │
│          │ loadDraft()                                   │         │
│          └───────────────────────────────────────────────┘         │
│                                                                    │
│   COMMANDS:                                                        │
│   ├── doPrint() → Print dialog with #rxPrint template              │
│   ├── copyRx() → Clipboard formatted prescription                  │
│   └── clearItems() → Reset to EMPTY RX state                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Search & Filter Pipeline

```
User Input
    │
    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. INPUT NORMALIZATION                                              │
│    state.searchQ = normalizeSpaces(input)                           │
│    state.searchField = 'all' | specific field                       │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. TOKENIZATION (Cross-field Search)                                │
│                                                                     │
│    "Amlo Exfo" → tokens = ["amlo", "exfo"]                          │
│                                                                     │
│    Each token must match ANY field:                                 │
│    • Generic Name      → "amlodipine" ✓                             │
│    • Brand Name        → "exforge" ✓                                │
│    • Classification    → "..."                                      │
│    • Pharmacologic Cat → "..."                                      │
│    • Manufacturer      → "..."                                      │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. FILTER APPLICATION                                               │
│                                                                     │
│    Filter Chain:                                                    │
│    ├── onlyRX → Classification === 'RX'                             │
│    ├── onlyHuman → Generic Name contains '/human'                   │
│    └── perPage → Pagination slice                                   │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. SORTING                                                          │
│                                                                     │
│    sortKey: 'Generic Name' | 'Brand Name' | ...                     │
│    sortDir: 'asc' | 'desc'                                          │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. RENDERING                                                        │
│                                                                     │
│    View Mode:                                                       │
│    ├── 'cards' → renderCards() → Drug cards grid                    │
│    └── 'table' → renderTable() → Sortable HTML table                │
└─────────────────────────────────────────────────────────────────────┘
```

---

## State Object Reference

The entire application state is contained in a single `state` object:

```javascript
const state = {
  // Data
  data: [],           // All drug records (array of objects)
  filtered: [],       // Filtered results for current search
  pageRows: [],       // Current page of results
  quickIndex: [],     // Pre-built search index for performance

  // Pagination
  page: 1,            // Current page number
  perPage: 50,        // Items per page (25, 50, 100, 200)

  // Search
  searchQ: '',        // Current search query
  searchField: 'all', // Field to search ('all' or specific)
  onlyRX: false,      // Filter: Rx only
  onlyHuman: false,   // Filter: Human drugs only

  // Sorting
  sortKey: 'Generic Name',   // Sort column
  sortDir: 'asc',            // Sort direction

  // UI State
  viewMode: 'cards',  // 'cards' or 'table'
  isDataLoaded: false,
  dataSource: null,   // 'fhir' or 'csv'
  lastUpdatedText: '—',

  // Rx Builder
  rxItemCount: 0      // Number of items in prescription
};
```

---

## Key Functions

| Function | Purpose |
|----------|---------|
| `tryFHIRLoad()` | Attempts to load from FHIR server, falls back to CSV |
| `fetchAllValueSetConcepts()` | Fetches complete CodeSystem from FHIR |
| `convertFHIRConceptsToData()` | Normalizes FHIR concepts to app format |
| `parseAndLoadCSV()` | Parses CSV and populates state.data |
| `buildQuickIndex()` | Builds searchable index for fast filtering |
| `filterAndRender()` | Applies filters and renders results |
| `addRxItem()` | Adds medication to prescription |
| `saveDraft()` / `loadDraft()` | Persists/loads Rx to localStorage |
| `doPrint()` / `copyRx()` | Output prescription |

---

## Data Sources

### FHIR Terminology Server (Online)

The app connects to `tx.fhirlab.net/fhir` (powered by Ontoserver on FHIRLab) to fetch the complete Philippine FDA drug database using FHIR R4 terminology resources.

**Resources:**
- **CodeSystem** (`TestPHFDACPRCS`): Contains all 34,000+ drug products with properties
- **ValueSet** (`TestPHFDACPRVS`): Defines the complete set of valid codes

**Properties per Concept:**
- `genericName` - Generic/INN name
- `brandName` - Brand name
- `dosageStrength` - Strength/concentration
- `dosageForm` - Tablet, Injection, etc.
- `classification` - RX, OTC, etc.
- `manufacturer` - Drug manufacturer
- `expiryDate` - Registration expiry

### CSV File (Offline)

Load the `ALL_DrugProducts.csv` file locally for complete offline operation. The CSV parser handles:
- Quoted fields with embedded commas
- Header mapping
- Automatic type conversion
- Drag-and-drop file loading

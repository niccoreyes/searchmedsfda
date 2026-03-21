/**
 * Rx Builder + FDA Drug Search
 * Modern, mobile-first prescription builder with offline drug search
 */
(function () {
  'use strict';

  // State management
  const state = {
    data: [],
    filtered: [],
    page: 1,
    perPage: 50,
    sortKey: 'Generic Name',
    sortDir: 'asc',
    lastUpdatedText: '—',
    searchQ: '',
    searchField: 'all',
    onlyRX: false,
    onlyOTC: false,
    onlyHuman: true,
    pageRows: [],
    quickIndex: [],
    isDataLoaded: false,
    rxItemCount: 0,
    viewMode: 'cards', // 'cards' or 'table'
    dataSource: null // 'fhir' or 'csv'
  };

  // DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ==================== Toast Notifications ====================

  function clearToasts() {
    const container = $('#toastContainer');
    if (!container) return;
    container.innerHTML = '';
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = $('#toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
        ${type === 'success'
          ? '<polyline points="20,6 9,17 4,12"/>'
          : type === 'error'
            ? '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
            : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'
        }
      </svg>
      <span>${escapeHTML(message)}</span>
    `;

    container.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Remove after timeout
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ==================== Navigation ====================

  function initNavigation() {
    // Bottom nav
    $$('.nav-item').forEach((item) => {
      item.addEventListener('click', () => {
        const target = item.dataset.tab;
        switchTab(target);
      });
    });
  }

  function switchTab(tabName) {
    // Update nav items
    $$('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.tab === tabName);
    });

    // Update views
    $$('.view').forEach((view) => {
      view.classList.toggle('active', view.id === `view-${tabName}`);
    });

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ==================== FHIR Configuration ====================

  const FHIR_CONFIG = {
    baseUrl: 'https://tx.fhirlab.net/fhir',
    codeSystemId: 'TestPHFDACPRCS', // CodeSystem has all the properties
    valueSetId: 'TestPHFDACPRVS',
    // Use large count to get more results per request
    count: 1000,
    // Maximum total entries to load (safety limit)
    maxTotal: 50000
  };

  // ==================== CSV Loading ====================

  function initCSVLoading() {
    const fileInput = $('#fileInput');
    const btnPick = $('#btnPick');
    const btnReload = $('#btnReload');
    const dropOverlay = $('#dropOverlay');

    // Button click handlers
    btnPick?.addEventListener('click', () => fileInput?.click());
    btnReload?.addEventListener('click', tryFHIRLoad);

    // CSV fallback button
    const btnLoadCSV = $('#btnLoadCSV');
    btnLoadCSV?.addEventListener('click', tryAutoLoad);

    // File input change
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) readFile(file);
    });

    // Drag and drop
    ['dragenter', 'dragover'].forEach((evt) => {
      document.addEventListener(evt, (e) => {
        e.preventDefault();
        dropOverlay?.classList.add('active');
      });
    });

    ['dragleave', 'drop'].forEach((evt) => {
      document.addEventListener(evt, (e) => {
        if (evt === 'dragleave' && e.relatedTarget) return;
        e.preventDefault();
        dropOverlay?.classList.remove('active');
      });
    });

    document.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) {
        readFile(file);
      } else {
        showToast('Please drop a CSV file', 'error');
      }
    });

    // Try auto-load on init - use FHIR first, fallback to CSV
    setTimeout(tryFHIRLoad, 500);
  }

  function setStatus(text, type = 'loading') {
    const statusEl = $('#loadStatus');
    if (!statusEl) return;

    statusEl.textContent = text;
    statusEl.className = `status-badge ${type}`;
  }

  function updateDataSourceBadge() {
    const badgeEl = $('#dataSourceBadge');
    if (!badgeEl) return;

    const source = state.dataSource;
    if (source === 'fhir') {
      badgeEl.textContent = 'FHIR Online';
      badgeEl.className = 'status-badge online';
    } else if (source === 'csv') {
      badgeEl.textContent = 'CSV Offline';
      badgeEl.className = 'status-badge offline';
    } else {
      badgeEl.textContent = 'Offline';
      badgeEl.className = 'status-badge offline';
    }
  }

  // ==================== FHIR ValueSet Loading ====================

  async function tryFHIRLoad() {
    setStatus('Loading from FHIR...', 'loading');
    showToast('Connecting to FHIR terminology server...', 'info');

    try {
      const { concepts: allConcepts, meta } = await fetchAllValueSetConcepts();

      if (allConcepts.length === 0) {
        throw new Error('No concepts returned from FHIR server');
      }

      // Convert FHIR concepts to the same format as CSV data
      const data = convertFHIRConceptsToData(allConcepts);

      state.data = data;
      state.page = 1;
      state.isDataLoaded = true;
      state.dataSource = 'fhir';
      updateDataSourceBadge();

      setStatus(`${data.length.toLocaleString()} records (FHIR)`, 'loaded');
      $('#summary').textContent = `${data.length.toLocaleString()} drugs`;

      // Use FHIR CodeSystem meta.lastUpdated for the badge
      const lastUpdated = meta?.lastUpdated;
      if (lastUpdated) {
        // Parse ISO date and format as locale date
        const date = new Date(lastUpdated);
        state.lastUpdatedText = date.toLocaleDateString();
      } else {
        state.lastUpdatedText = new Date().toLocaleDateString();
      }
      $('#updateBadge').textContent = `Updated: ${state.lastUpdatedText}`;

      // Show search UI
      showSearchUI();

      // Build index and render
      buildQuickIndex();
      filterAndRender();

      clearToasts();
      showToast(`Loaded ${data.length.toLocaleString()} drugs from FHIR server`, 'success');
    } catch (error) {
      console.error('FHIR load failed:', error);
      setStatus('FHIR failed, trying CSV...', 'loading');
      showToast('FHIR server unavailable, falling back to CSV', 'error');

      // Fall back to CSV
      setTimeout(tryAutoLoad, 500);
    }
  }

  /**
   * Fetch all concepts from FHIR CodeSystem
   * CodeSystem contains all concept properties (generic name, strength, etc.)
   * The server returns all ~34,000 concepts at once (~28MB)
   * @returns {{concepts: Array, meta: Object|null}} Concepts and metadata from CodeSystem
   */
  async function fetchAllValueSetConcepts() {
    // Create abort controller for timeout - 2 minutes for large data
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      showToast('Downloading drug database (this may take a moment)...', 'info', 10000);

      // Fetch the entire CodeSystem - it contains all properties
      const url = `${FHIR_CONFIG.baseUrl}/CodeSystem/${FHIR_CONFIG.codeSystemId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/fhir+json'
        },
        signal: controller.signal,
        mode: 'cors'
      });

      if (!response.ok) {
        throw new Error(`FHIR request failed: HTTP ${response.status}`);
      }

      const codeSystem = await response.json();

      if (codeSystem.resourceType !== 'CodeSystem') {
        throw new Error('Invalid FHIR response: expected CodeSystem');
      }

      // Get total count from CodeSystem
      const total = codeSystem.count || 0;
      console.log(`FHIR CodeSystem total concepts: ${total}`);

      // Extract concepts and metadata from CodeSystem
      // Handle hierarchical CodeSystem with nested concepts (root -> children)
      let concepts = codeSystem.concept || [];
      const meta = codeSystem.meta || null;

      // Flatten hierarchy: if there's a root concept with nested children, extract them
      if (concepts.length === 1 && concepts[0].concept && Array.isArray(concepts[0].concept)) {
        console.log(`Found hierarchical CodeSystem with root concept: ${concepts[0].code}`);
        concepts = concepts[0].concept;
      }

      console.log(`Total FHIR concepts loaded: ${concepts.length}`);
      return { concepts, meta };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Convert FHIR ValueSet concepts to the application's data format
   * FHIR CodeSystem/ValueSet structure:
   * - code: Registration Number
   * - display: Brand Name
   * - property[]: Array of {code, valueString} objects
   */
  function convertFHIRConceptsToData(concepts) {
    return concepts.map((concept) => {
      // code = Registration Number, display = Brand Name
      const regNo = concept.code || '';
      const brandName = concept.display || '';

      // Extract properties from the concept.property array
      // Each property has {code: 'propertyName', valueString: 'value'}
      const properties = {};
      const propArray = concept.property || [];

      propArray.forEach(prop => {
        if (prop.code && prop.valueString !== undefined) {
          properties[prop.code] = prop.valueString;
        }
      });

      // Map FHIR properties to app field names
      const genericName = properties.genericName || '';
      const strength = properties.dosageStrength || '';
      const form = properties.dosageForm || '';
      const classification = properties.classification || '';
      const manufacturer = properties.manufacturer || '';
      const category = properties.pharmacologicCategory || '';
      const expiryDate = properties.expiryDate || '';

      // Skip entries without required fields
      if (!genericName && !brandName) {
        return null;
      }

      return {
        'Generic Name': genericName || brandName, // Fallback to brand if no generic
        'Brand Name': brandName,
        'Dosage Strength': strength,
        'Dosage Form': form,
        'Classification': classification,
        'Pharmacologic Category': category,
        'Manufacturer': manufacturer,
        'Registration Number': regNo,
        'Expiry Date': expiryDate,
        // Store original FHIR data for reference
        _fhirConcept: concept
      };
    }).filter(item => item !== null); // Remove null entries
  }

  async function tryAutoLoad() {
    setStatus('Loading CSV...', 'loading');

    // Fetch GitHub last commit date for the CSV file
    let githubDate = null;
    try {
      githubDate = await fetchGitHubCSVLastUpdated();
    } catch (e) {
      console.log('Could not fetch GitHub date:', e);
    }

    fetch('Combined_All_CPR.csv')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        parseAndLoadCSV(text, null, githubDate);
      })
      .catch(() => {
        setStatus('Load failed', 'error');
        showUploadUI();
      });
  }

  /**
   * Fetch the last commit date for the CSV file from GitHub API
   * @returns {Promise<string|null>} ISO date string or null
   */
  async function fetchGitHubCSVLastUpdated() {
    try {
      // GitHub API endpoint for commits affecting the CSV file
      const url = 'https://api.github.com/repos/niccoreyes/searchmedsfda/commits?path=Combined_All_CPR.csv&per_page=1';

      const response = await fetch(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API failed: HTTP ${response.status}`);
      }

      const commits = await response.json();
      if (commits && commits.length > 0 && commits[0].commit) {
        return commits[0].commit.committer?.date || commits[0].commit.author?.date || null;
      }
      return null;
    } catch (error) {
      console.error('Failed to fetch GitHub last updated date:', error);
      return null;
    }
  }

  function readFile(file) {
    setStatus('Reading...', 'loading');

    const reader = new FileReader();
    reader.onload = () => {
      parseAndLoadCSV(reader.result, file.name, null);
      showToast(`Loaded ${file.name}`, 'success');
    };
    reader.onerror = () => {
      setStatus('Read failed', 'error');
      showToast('Failed to read file', 'error');
    };
    reader.readAsText(file);
  }

  /**
   * Parse and load CSV data
   * @param {string} text - CSV content
   * @param {string|null} filename - Name of the file (if loaded from file input)
   * @param {string|null} githubDate - ISO date string from GitHub API (if available)
   */
  function parseAndLoadCSV(text, _filename = null, githubDate = null) {
    const rows = CSVToArray(text);

    if (!rows.length) {
      setStatus('Empty CSV', 'error');
      return;
    }

    // Parse headers
    const headers = rows[0].map((h) => h.trim());
    const data = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const obj = {};
      headers.forEach((h, j) => {
        obj[h] = (r[j] ?? '').trim();
      });
      data.push(obj);
    }

    state.data = data;
    state.page = 1;
    state.isDataLoaded = true;
    state.dataSource = 'csv';
    updateDataSourceBadge();

    setStatus(`${data.length.toLocaleString()} records (CSV)`, 'loaded');
    $('#summary').textContent = `${data.length.toLocaleString()} drugs`;

    // Determine last updated date for the badge
    // Priority: 1. CSV header date, 2. GitHub API date, 3. Fallback message
    const csvHeaderMatch = text.match(/Updated\s+as\s+of\s+([^\r\n]+)/i);
    let lastUpdatedText = '—';

    if (csvHeaderMatch) {
      // Use date from CSV header if available
      lastUpdatedText = csvHeaderMatch[1].trim();
    } else if (githubDate) {
      // Use GitHub commit date if available
      const date = new Date(githubDate);
      lastUpdatedText = date.toLocaleDateString();
    }

    state.lastUpdatedText = lastUpdatedText;
    $('#updateBadge').textContent = `Updated: ${state.lastUpdatedText}`;

    // Show search UI
    showSearchUI();

    // Build index and render
    buildQuickIndex();
    filterAndRender();
  }

  function showUploadUI() {
    $('#uploadArea').style.display = 'block';
    $('#searchInterface').style.display = 'none';
  }

  function showSearchUI() {
    $('#uploadArea').style.display = 'none';
    $('#searchInterface').style.display = 'block';
  }

  // Simple CSV parser (handles quoted fields)
  function CSVToArray(strData, strDelimiter = ',') {
    const objPattern = new RegExp(
      `(\\${strDelimiter}|\\r?\\n|\\r|^)(?:"([^"]*(?:""[^"]*)*)"|([^"\\${strDelimiter}\\r\\n]*))`,
      'gi'
    );

    const arrData = [[]];
    let arrMatches = null;

    while ((arrMatches = objPattern.exec(strData))) {
      const strMatchedDelimiter = arrMatches[1];

      if (strMatchedDelimiter.length && strMatchedDelimiter !== strDelimiter) {
        arrData.push([]);
      }

      let strMatchedValue;
      if (arrMatches[2]) {
        strMatchedValue = arrMatches[2].replace(/""/g, '"');
      } else {
        strMatchedValue = arrMatches[3];
      }

      arrData[arrData.length - 1].push(strMatchedValue);
    }

    // Remove empty trailing row
    if (
      arrData.length &&
      arrData[arrData.length - 1].length === 1 &&
      arrData[arrData.length - 1][0] === ''
    ) {
      arrData.pop();
    }

    return arrData;
  }

  // ==================== Search & Filter ====================

  function initSearch() {
    const q = $('#q');
    const fieldSelect = $('#fieldSelect');
    const perPage = $('#perPage');
    const onlyRX = $('#onlyRX');
    const onlyOTC = $('#onlyOTC');
    const onlyHuman = $('#onlyHuman');
    const clearSearch = $('#clearSearch');
    const clearFilters = $('#clearFilters');

    // Search input with debounce
    let debounceTimer;
    q?.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        state.searchQ = q.value.trim();
        state.page = 1;
        filterAndRender();
      }, 150);
    });

    // Clear search button
    clearSearch?.addEventListener('click', () => {
      q.value = '';
      state.searchQ = '';
      state.page = 1;
      filterAndRender();
    });

    // Clear filters button (empty state)
    clearFilters?.addEventListener('click', () => {
      q.value = '';
      state.searchQ = '';
      state.onlyRX = false;
      state.onlyOTC = false;
      state.onlyHuman = false;
      onlyRX.checked = false;
      onlyOTC.checked = false;
      onlyHuman.checked = false;
      state.page = 1;
      filterAndRender();
    });

    // Field select
    fieldSelect?.addEventListener('change', () => {
      state.searchField = fieldSelect.value;
      state.page = 1;
      filterAndRender();
    });

    // Per page
    perPage?.addEventListener('change', () => {
      state.perPage = +perPage.value;
      state.page = 1;
      renderResults();
    });

    // Filters
    onlyRX?.addEventListener('change', () => {
      state.onlyRX = onlyRX.checked;
      if (state.onlyRX) state.onlyOTC = false;
      onlyOTC.checked = false;
      state.page = 1;
      filterAndRender();
    });

    onlyOTC?.addEventListener('change', () => {
      state.onlyOTC = onlyOTC.checked;
      if (state.onlyOTC) state.onlyRX = false;
      onlyRX.checked = false;
      state.page = 1;
      filterAndRender();
    });

    onlyHuman?.addEventListener('change', () => {
      state.onlyHuman = onlyHuman.checked;
      state.page = 1;
      filterAndRender();
    });

    // Pagination
    $('#prev')?.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        renderResults();
        scrollToResults();
      }
    });

    $('#next')?.addEventListener('click', () => {
      const pages = Math.max(1, Math.ceil(state.filtered.length / state.perPage));
      if (state.page < pages) {
        state.page++;
        renderResults();
        scrollToResults();
      }
    });

    // View toggle (cards vs table)
    $$('.view-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        if (view === state.viewMode) return;

        state.viewMode = view;

        // Update active state on buttons
        $$('.view-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));

        // Toggle visibility
        const listEl = $('#resultsList');
        const tableContainer = $('#tableContainer');

        if (view === 'cards') {
          listEl.style.display = '';
          tableContainer.style.display = 'none';
        } else {
          listEl.style.display = 'none';
          tableContainer.style.display = '';
        }

        renderResults();
      });
    });

    // Table column sorting
    $$('#resultsTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'asc';
        }

        // Update sort indicators
        $$('#resultsTable th').forEach((header) => {
          header.classList.remove('sort-asc', 'sort-desc');
          if (header.dataset.sort === state.sortKey) {
            header.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
          }
        });

        renderResults();
      });
    });

    // Set initial sort indicator
    const initialSortHeader = $(`#resultsTable th[data-sort="${state.sortKey}"]`);
    if (initialSortHeader) {
      initialSortHeader.classList.add(state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }

    // Set initial view visibility
    const listEl = $('#resultsList');
    const tableContainer = $('#tableContainer');
    if (state.viewMode === 'cards') {
      listEl.style.display = '';
      tableContainer.style.display = 'none';
    } else {
      listEl.style.display = 'none';
      tableContainer.style.display = '';
    }
  }

  function scrollToResults() {
    const results = $('.results-container');
    if (results) {
      results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function filterAndRender() {
    const q = state.searchQ.toLowerCase().trim();
    const f = state.searchField;
    const terms = q ? q.split(/\s+/).filter((t) => t.length > 0) : [];

    const isHuman = (row) => {
      const gen = (row['Pharmacologic Category'] || '').toLowerCase();
      const cls = (row['Classification'] || '').toLowerCase();
      const brand = (row['Brand Name'] || '').toLowerCase();
      const generic = (row['Generic Name'] || '').toLowerCase();

      if (gen.includes('veterinary') || cls.includes('veterinary') || brand.includes('(vet.)') || brand.includes('vet') || generic.includes('(vet.)') || generic.includes('veterinary')) {
        return false;
      }
      return true;
    };

    const searchableFields = [
      'Generic Name',
      'Brand Name',
      'Pharmacologic Category',
      'Manufacturer',
      'Dosage Form',
      'Dosage Strength'
    ];

    state.filtered = state.data.filter((row) => {
      if (state.onlyRX) {
        const cls = String(row['Classification'] || '').toLowerCase();
        if (!cls.includes('prescription')) return false;
      }

      if (state.onlyOTC) {
        const cls = String(row['Classification'] || '').toLowerCase();
        if (!cls.includes('over-the-counter') && !cls.includes('otc')) return false;
      }

      if (state.onlyHuman) {
        if (!isHuman(row)) return false;
      }

      if (!q) return true;

      if (f === 'all') {
        const rowText = searchableFields
          .map((k) => String(row[k] || '').toLowerCase())
          .join(' ');
        return terms.every((term) => rowText.includes(term));
      } else {
        const fieldValue = String(row[f] || '').toLowerCase();
        return terms.every((term) => fieldValue.includes(term));
      }
    });

    state.page = 1;
    renderResults();
  }

  function renderResults() {
    // Sort
    const k = state.sortKey;
    const dir = state.sortDir;

    const sorted = state.filtered.slice().sort((a, b) => {
      const av = (a[k] || '').toString().toLowerCase();
      const bv = (b[k] || '').toString().toLowerCase();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });

    // Paging
    const total = sorted.length;
    const pages = Math.max(1, Math.ceil(total / state.perPage));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.perPage;
    state.pageRows = sorted.slice(start, start + state.perPage);

    // Update UI based on view mode
    const listEl = $('#resultsList');
    const tableBody = $('#tableBody');
    const tableContainer = $('#tableContainer');
    const emptyEl = $('#emptyState');

    if (state.pageRows.length === 0) {
      listEl.innerHTML = '';
      if (tableBody) tableBody.innerHTML = '';
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';

      if (state.viewMode === 'cards') {
        // Card view
        listEl.style.display = '';
        tableContainer.style.display = 'none';
        listEl.innerHTML = state.pageRows.map((r, idx) => drugCardHTML(r, idx)).join('');

        // Wire up card clicks
        $$('.drug-card').forEach((card) => {
          card.addEventListener('click', (e) => {
            if (e.target.closest('.add-rx-btn')) return;
            const idx = +card.dataset.idx;
            const record = state.pageRows[idx];
            addRxFromRecord(record);
            showToast('Added to prescription', 'success');
          });
        });

        $$('.add-rx-btn').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = +btn.dataset.idx;
            const record = state.pageRows[idx];
            addRxFromRecord(record);
            showToast('Added to prescription', 'success');
          });
        });
      } else {
        // Table view
        listEl.style.display = 'none';
        tableContainer.style.display = '';
        tableBody.innerHTML = state.pageRows.map((r, idx) => drugTableRowHTML(r, idx)).join('');

        // Wire up table add buttons
        $$('.add-table-btn').forEach((btn) => {
          btn.addEventListener('click', () => {
            const idx = +btn.dataset.idx;
            const record = state.pageRows[idx];
            addRxFromRecord(record);
            showToast('Added to prescription', 'success');
          });
        });
      }
    }

    // Update pagination
    $('#pageInfo').textContent = `Page ${state.page} of ${pages}`;
    $('#prev').disabled = state.page <= 1;
    $('#next').disabled = state.page >= pages;
    $('#filterSummary').textContent = `${total.toLocaleString()} shown`;
  }

  function drugCardHTML(r, idx) {
    const textQ = state.searchQ.trim().toLowerCase();
    const h = (s) => highlight(String(s || ''), textQ);

    const generic = r['Generic Name'] || '';
    const brand = r['Brand Name'] || '';
    const strength = r['Dosage Strength'] || '';
    const form = r['Dosage Form'] || '';
    const classification = r['Classification'] || '';
    const manufacturer = r['Manufacturer'] || '';
    const regNo = r['Registration Number'] || '';
    const expiry = r['Expiry Date'] || '';

    const isRx = classification.toLowerCase().includes('prescription');
    const expiryStatus = getExpiryStatus(r['Expiry Date']);

    return `
      <div class="drug-card" data-idx="${idx}">
        <div class="drug-header">
          <div class="drug-name">
            <div class="drug-generic">${h(generic)}</div>
            <div class="drug-brand">${h(brand)}</div>
          </div>
          <span class="drug-class ${isRx ? 'rx' : ''}">${isRx ? 'Rx' : escapeHTML(classification.slice(0, 15))}</span>
        </div>
        <div class="drug-details">
          <div class="drug-detail">
            <strong>${h(strength)}</strong>
          </div>
          <div class="drug-detail">${h(form)}</div>
          <div class="drug-detail">${h(manufacturer.slice(0, 30))}</div>
        </div>
        <div class="drug-footer">
          <div class="drug-meta">
            <span>Reg: ${h(regNo)}</span>
            <span class="drug-expiry ${expiryStatus.class}">Exp: ${h(expiry) || 'N/A'}</span>
          </div>
          <button class="btn btn-primary btn-sm add-rx-btn" data-idx="${idx}">
            Add to Rx
          </button>
        </div>
      </div>
    `;
  }

  function drugTableRowHTML(r, idx) {
    const textQ = state.searchQ.trim().toLowerCase();
    const h = (s) => highlight(String(s || ''), textQ);

    const generic = r['Generic Name'] || '';
    const brand = r['Brand Name'] || '';
    const strength = r['Dosage Strength'] || '';
    const form = r['Dosage Form'] || '';
    const classification = r['Classification'] || '';
    const manufacturer = r['Manufacturer'] || '';
    const regNo = r['Registration Number'] || '';
    const expiry = r['Expiry Date'] || '';

    const isRx = classification.toLowerCase().includes('prescription');
    const expiryStatus = getExpiryStatus(r['Expiry Date']);

    return `
      <tr data-idx="${idx}">
        <td class="truncate" title="${escapeHTML(generic)}">${h(generic)}</td>
        <td class="truncate" title="${escapeHTML(brand)}">${h(brand)}</td>
        <td>${h(strength)}</td>
        <td>${h(form)}</td>
        <td>
          ${isRx
            ? '<span class="rx-badge">Rx</span>'
            : escapeHTML(classification.slice(0, 20))
          }
        </td>
        <td class="truncate" title="${escapeHTML(manufacturer)}">${h(manufacturer)}</td>
        <td>${h(regNo)}</td>
        <td class="${expiryStatus.class}">${h(expiry) || '—'}</td>
        <td class="actions">
          <button class="btn btn-primary btn-sm add-table-btn" data-idx="${idx}">Add</button>
        </td>
      </tr>
    `;
  }

  function getExpiryStatus(expiryDate) {
    if (!expiryDate) return { class: '' };

    const expiry = new Date(expiryDate);
    const now = new Date();
    const monthsDiff = (expiry - now) / (1000 * 60 * 60 * 24 * 30);

    if (monthsDiff < 0) return { class: 'expired' };
    if (monthsDiff < 6) return { class: 'expiring-soon' };
    return { class: '' };
  }

  function highlight(text, q) {
    if (!q) return escapeHTML(text);

    const terms = q.toLowerCase().trim().split(/\s+/).filter((t) => t.length > 0);
    if (terms.length === 0) return escapeHTML(text);

    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

    let result = text;
    const highlights = [];

    sortedTerms.forEach((term) => {
      let idx = result.toLowerCase().indexOf(term);
      while (idx >= 0) {
        const isAlreadyHighlighted = highlights.some(
          (h) =>
            (idx >= h.start && idx < h.end) ||
            (idx + term.length > h.start && idx + term.length <= h.end)
        );

        if (!isAlreadyHighlighted) {
          highlights.push({
            start: idx,
            end: idx + term.length,
            term: result.slice(idx, idx + term.length)
          });
        }

        idx = result.toLowerCase().indexOf(term, idx + 1);
      }
    });

    if (highlights.length === 0) return escapeHTML(text);

    highlights.sort((a, b) => a.start - b.start);

    let output = '';
    let lastEnd = 0;
    highlights.forEach((h) => {
      output += escapeHTML(result.slice(lastEnd, h.start));
      output += '<span class="hl">' + escapeHTML(h.term) + '</span>';
      lastEnd = h.end;
    });
    output += escapeHTML(result.slice(lastEnd));

    return output;
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (m) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])
    );
  }

  // ==================== Quick Index for Side Search ====================

  function buildQuickIndex() {
    state.quickIndex = state.data.map((r, i) => ({
      i,
      t: [
        r['Generic Name'],
        r['Brand Name'],
        r['Pharmacologic Category'],
        r['Manufacturer'],
        r['Dosage Form'],
        r['Dosage Strength']
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' | ')
    }));
  }

  // ==================== Prescription Builder ====================

  function initPrescription() {
    const drugQuick = $('#drugQuick');
    const addBlank = $('#addBlank');
    const clearItems = $('#clearItems');
    const sideResults = $('#sideResults');

    // Set default date
    const rxDate = $('#rxDate');
    if (rxDate && !rxDate.value) {
      rxDate.valueAsDate = new Date();
    }

    // Quick add search
    let searchDebounce;
    drugQuick?.addEventListener('input', () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        const q = drugQuick.value.trim().toLowerCase();
        if (!q) {
          sideResults.innerHTML = '';
          return;
        }

        const terms = q.split(/\s+/).filter((t) => t.length > 0);
        const hits = state.quickIndex
          .filter((x) => terms.every((term) => x.t.includes(term)))
          .slice(0, 10);

        if (hits.length === 0) {
          sideResults.innerHTML = `
            <div class="side-card">
              <div class="side-card-title">No matches found</div>
              <div class="side-card-subtitle">Press Enter to add as custom item</div>
            </div>
          `;
        } else {
          sideResults.innerHTML = hits
            .map((h) => {
              const r = state.data[h.i];
              return sideCardHTML(r, q, h.i);
            })
            .join('');

          // Wire up add buttons
          $$('.add-side-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              const idx = +btn.dataset.i;
              addRxFromRecord(state.data[idx]);
              drugQuick.value = '';
              sideResults.innerHTML = '';
            });
          });
        }
      }, 150);
    });

    // Enter key handling
    drugQuick?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = drugQuick.value.trim();
        if (!q) return;

        const lowerQ = q.toLowerCase();
        const terms = lowerQ.split(/\s+/).filter((t) => t.length > 0);
        const match = state.quickIndex.find((x) =>
          terms.every((term) => x.t.includes(term))
        );

        if (match && state.data[match.i]) {
          addRxFromRecord(state.data[match.i]);
        } else {
          addRxItem({ genericName: q });
        }

        drugQuick.value = '';
        sideResults.innerHTML = '';
      }
    });

    // Add blank item
    addBlank?.addEventListener('click', () => {
      addRxItem({});
      showToast('Added custom item', 'info');
    });

    // Clear all items
    clearItems?.addEventListener('click', () => {
      const rxItems = $('#rxItems');
      if (rxItems.children.length > 1) {
        // > 1 because of empty state
        if (confirm('Remove all prescription items?')) {
          rxItems.innerHTML = `
            <div class="empty-rx">
              <div class="empty-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/>
                  <path d="M12 11v6M9 14h6"/>
                </svg>
              </div>
              <p>No medications added yet</p>
              <p class="text-muted">Search above or add a custom item</p>
            </div>
          `;
          state.rxItemCount = 0;
          updateRxBadge();
          updateRxPreview();
          showToast('All items cleared', 'info');
        }
      }
    });

    // Save/Load local
    $('#saveLocal')?.addEventListener('click', saveLocal);
    $('#loadLocal')?.addEventListener('click', loadLocal);

    // Copy
    $('#copyRx')?.addEventListener('click', copyRx);

    // Print
    $('#printRx')?.addEventListener('click', printRx);
  }

  function sideCardHTML(r, q, idx) {
    const h = (s) => highlight(String(s || ''), q);
    const expiry = r['Expiry Date'] || '';

    return `
      <div class="side-card">
        <div class="side-card-title">${h(r['Generic Name'])}</div>
        <div class="side-card-subtitle">${h(r['Brand Name'])} • ${h(r['Dosage Strength'])}</div>
        <div class="side-card-meta">${h(r['Dosage Form'])} • Exp: ${h(expiry) || 'N/A'}</div>
        <button class="btn btn-primary btn-sm add-side-btn" data-i="${idx}">Add to Rx</button>
      </div>
    `;
  }

  function addRxFromRecord(r) {
    addRxItem({
      genericName: r['Generic Name'] || '',
      brandName: r['Brand Name'] || '',
      strength: r['Dosage Strength'] || '',
      form: r['Dosage Form'] || ''
    });
  }

  function addRxItem({ genericName = '', brandName = '', strength = '', form = '' }) {
    const rxItems = $('#rxItems');

    // Remove empty state if present
    const emptyState = rxItems.querySelector('.empty-rx');
    if (emptyState) {
      emptyState.remove();
    }

    state.rxItemCount++;
    updateRxBadge();

    const div = document.createElement('div');
    div.className = 'rx-item with-number';
    div.innerHTML = `
      <div class="rx-item-number">${state.rxItemCount}</div>
      <div class="rx-item-header">
        <input class="rx-generic" value="${escapeHTML(genericName)}" placeholder="Generic Name">
        <input class="rx-brand" value="${escapeHTML(brandName)}" placeholder="Brand Name">
        <input class="rx-strength small" value="${escapeHTML(strength)}" placeholder="Strength">
        <input class="rx-form small" value="${escapeHTML(form)}" placeholder="Form">
        <input class="rx-qty small" placeholder="Qty">
      </div>
      <div class="rx-item-body">
        <input class="rx-sig" placeholder="Sig (e.g., 1 tab PO BID)">
      </div>
      <div class="rx-item-actions">
        <button class="btn btn-ghost btn-sm move-up">↑</button>
        <button class="btn btn-ghost btn-sm move-down">↓</button>
        <button class="btn btn-secondary btn-sm duplicate">Duplicate</button>
        <button class="btn btn-danger-ghost btn-sm remove">Remove</button>
      </div>
    `;

    rxItems.appendChild(div);

    // Wire up actions
    div.querySelector('.remove').addEventListener('click', () => {
      div.remove();
      renumberItems();
      if (rxItems.children.length === 0) {
        rxItems.innerHTML = `
          <div class="empty-rx">
            <div class="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M8 21h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z"/>
                <path d="M12 11v6M9 14h6"/>
              </svg>
            </div>
            <p>No medications added yet</p>
            <p class="text-muted">Search above or add a custom item</p>
          </div>
        `;
        state.rxItemCount = 0;
        updateRxBadge();
      }
      updateRxPreview();
    });

    div.querySelector('.duplicate').addEventListener('click', () => {
      const vals = collectItem(div);
      addRxItem(vals);
    });

    div.querySelector('.move-up').addEventListener('click', () => {
      if (div.previousElementSibling) {
        div.parentNode.insertBefore(div, div.previousElementSibling);
        renumberItems();
        updateRxPreview();
      }
    });

    div.querySelector('.move-down').addEventListener('click', () => {
      if (div.nextElementSibling) {
        div.parentNode.insertBefore(div.nextElementSibling, div);
        renumberItems();
        updateRxPreview();
      }
    });

    // Wire up live preview updates for all inputs in this item
    const inputs = div.querySelectorAll('input');
    inputs.forEach((input) => {
      input.addEventListener('input', updateRxPreview);
    });

    // Focus first field
    div.querySelector('.rx-generic').focus();

    // Scroll to item on mobile
    if (window.innerWidth < 640) {
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Update the live preview
    updateRxPreview();
  }

  function renumberItems() {
    const items = $$('.rx-item');
    items.forEach((item, idx) => {
      const num = item.querySelector('.rx-item-number');
      if (num) {
        num.textContent = idx + 1;
      }
    });
    state.rxItemCount = items.length;
    updateRxBadge();
  }

  function updateRxBadge() {
    const badge = $('#rxBadge');
    if (badge) {
      badge.textContent = state.rxItemCount;
      badge.style.display = state.rxItemCount > 0 ? 'flex' : 'none';
    }
  }

  function collectItem(div) {
    return {
      genericName: div.querySelector('.rx-generic')?.value.trim() || '',
      brandName: div.querySelector('.rx-brand')?.value.trim() || '',
      strength: div.querySelector('.rx-strength')?.value.trim() || '',
      form: div.querySelector('.rx-form')?.value.trim() || '',
      qty: div.querySelector('.rx-qty')?.value.trim() || '',
      sig: div.querySelector('.rx-sig')?.value.trim() || ''
    };
  }

  function saveLocal() {
    const fields = {
      clinic: $('#clinic'),
      clinicAddr: $('#clinicAddr'),
      docName: $('#docName'),
      prc: $('#prc'),
      ptr: $('#ptr'),
      s2: $('#s2'),
      ptName: $('#ptName'),
      ptAge: $('#ptAge'),
      ptSex: $('#ptSex'),
      ptAddr: $('#ptAddr'),
      rxDate: $('#rxDate'),
      rxNotes: $('#rxNotes')
    };

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    const payload = {
      meta: Object.fromEntries(
        Object.entries(fields).map(([k, el]) => [k, el?.value || ''])
      ),
      items
    };

    localStorage.setItem('rxBuilderSave_v2', JSON.stringify(payload));
    showToast('Draft saved locally', 'success');
  }

  function loadLocal() {
    const saved = localStorage.getItem('rxBuilderSave_v2');
    if (!saved) {
      showToast('No saved draft found', 'info');
      return;
    }

    try {
      const data = JSON.parse(saved);
      const fields = {
        clinic: $('#clinic'),
        clinicAddr: $('#clinicAddr'),
        docName: $('#docName'),
        prc: $('#prc'),
        ptr: $('#ptr'),
        s2: $('#s2'),
        ptName: $('#ptName'),
        ptAge: $('#ptAge'),
        ptSex: $('#ptSex'),
        ptAddr: $('#ptAddr'),
        rxDate: $('#rxDate'),
        rxNotes: $('#rxNotes')
      };

      Object.entries(data.meta || {}).forEach(([k, v]) => {
        if (fields[k]) fields[k].value = v;
      });

      const rxItems = $('#rxItems');
      rxItems.innerHTML = '';
      state.rxItemCount = 0;

      (data.items || []).forEach((item) => addRxItem(item));

      updateRxPreview();
      showToast('Draft restored', 'success');
    } catch (e) {
      showToast('Failed to restore draft', 'error');
    }
  }

  function copyRx() {
    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    if (items.length === 0) {
      showToast('No items to copy', 'error');
      return;
    }

    const lines = items.map((it, i) => {
      const namePart = it.brandName
        ? `${it.genericName} (${it.brandName})`
        : it.genericName;
      const strengthPart = it.strength || '';
      const formPart = it.form || '';
      const qtyPart = it.qty ? ` #${it.qty}` : '';
      const line1 = `${i + 1}. ${namePart} ${strengthPart} ${formPart}${qtyPart}`.trim();
      const line2 = it.sig ? `Sig. ${it.sig}` : '';
      return [line1, line2].filter(Boolean).join('\n');
    });

    const text = lines.join('\n\n');

    navigator.clipboard
      .writeText(text)
      .then(() => showToast('Copied to clipboard', 'success'))
      .catch(() => showToast('Copy failed', 'error'));
  }

  function updateRxPreview() {
    const previewEl = $('#rxPreview');
    if (!previewEl) return;

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    if (items.length === 0) {
      previewEl.innerHTML = '<div class="rx-preview-empty">No medications added yet</div>';
      return;
    }

    const html = items.map((it, i) => {
      const namePart = it.brandName
        ? `${it.genericName} (${it.brandName})`
        : it.genericName;
      const strengthPart = it.strength || '';
      const formPart = it.form || '';
      const qtyPart = it.qty ? ` #${it.qty}` : '';
      const sigLine = it.sig ? `<div class="rx-preview-sig">Sig. ${escapeHTML(it.sig)}</div>` : '';
      return `<div class="rx-preview-item"><span class="rx-preview-number">${i + 1}.</span> ${escapeHTML(namePart)} ${escapeHTML(strengthPart)} ${escapeHTML(formPart)}${qtyPart}${sigLine}</div>`;
    }).join('');

    previewEl.innerHTML = html;
  }

  function printRx() {
    const fields = {
      clinic: $('#clinic'),
      clinicAddr: $('#clinicAddr'),
      docName: $('#docName'),
      prc: $('#prc'),
      ptr: $('#ptr'),
      s2: $('#s2'),
      ptName: $('#ptName'),
      ptAge: $('#ptAge'),
      ptSex: $('#ptSex'),
      ptAddr: $('#ptAddr'),
      rxDate: $('#rxDate'),
      rxNotes: $('#rxNotes')
    };

    // Fill print template
    $('#pClinic').textContent = fields.clinic?.value || 'Clinic Name';
    $('#pClinicAddr').textContent = fields.clinicAddr?.value || '';
    $('#pPtName').textContent = fields.ptName?.value || '';

    const ageSex = [fields.ptAge?.value, fields.ptSex?.value]
      .filter(Boolean)
      .join(' / ');
    $('#pPtAgeSex').textContent = ageSex;

    $('#pPtAddr').textContent = fields.ptAddr?.value || '';
    $('#pDate').textContent =
      fields.rxDate?.value || new Date().toISOString().slice(0, 10);
    $('#pDoc2').textContent = fields.docName?.value || '';

    // Populate signature block licenses (stacked)
    const prcVal = fields.prc?.value?.trim();
    const ptrVal = fields.ptr?.value?.trim();
    const s2Val = fields.s2?.value?.trim();
    $('#pPRC2Wrap').textContent = prcVal ? `PRC: ${prcVal}` : '';
    $('#pPTR2Wrap').textContent = ptrVal ? `PTR: ${ptrVal}` : '';
    $('#pS22Wrap').textContent = s2Val ? `S2: ${s2Val}` : '';

    // Show/hide signature label based on whether licenses are present
    const hasAnyLicense = prcVal || ptrVal || s2Val;
    $('#signatureLabel').style.display = hasAnyLicense ? 'none' : 'block';

    const ol = $('#pItems');
    ol.innerHTML = '';

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    for (const it of items) {
      const namePart = it.genericName && it.brandName
        ? `${it.genericName} (${it.brandName})`
        : it.genericName;
      const strengthPart = it.strength || '';
      const formPart = it.form || '';
      const qtyPart = it.qty ? ` #${it.qty}` : '';
      const line1Left = `${namePart} ${strengthPart} ${formPart}`.trim();
      const line1Right = qtyPart ? `<span class="qty-right">${qtyPart}</span>` : '';
      const line1 = line1Right
        ? `<div class="rx-line"><span>${line1Left}</span>${line1Right}</div>`
        : line1Left;
      const line2 = it.sig ? `Sig. ${it.sig}` : '';

      const li = document.createElement('li');
      const sigDiv = line2 ? `<div class="rx-sig">${line2}</div>` : '';
      li.innerHTML = line1 + sigDiv;
      ol.appendChild(li);
    }

    const notes = fields.rxNotes?.value?.trim();
    $('#pNotes').textContent = notes ? `Notes: ${notes}` : '';

    window.print();
  }

  // ==================== Initialization ====================

  function init() {
    initNavigation();
    initCSVLoading();
    initSearch();
    initPrescription();

    // Load saved data on startup
    const saved = localStorage.getItem('rxBuilderSave_v2');
    if (saved) {
      // Don't auto-load, let user decide
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

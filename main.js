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
    onlyGeneric: false,
    showVet: false,
    showSupplement: false,
    showMedicalDevice: false,
    pageRows: [],
    quickIndex: [],
    isDataLoaded: false,
    rxItemCount: 0,
    viewMode: 'cards', // 'cards' or 'table'
    dataSource: null // 'fhir' or 'csv'
  };

  // DOM element cache
  const domCache = new Map();
  function getCached(selector) {
    if (!domCache.has(selector)) {
      domCache.set(selector, document.querySelector(selector));
    }
    return domCache.get(selector);
  }
  function clearDomCache() {
    domCache.clear();
  }

  // DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ==================== Utility Functions ====================

  /**
   * Debounce function execution
   * @param {Function} fn - Function to debounce
   * @param {number} delay - Delay in milliseconds
   * @returns {Function} Debounced function
   */
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  /**
   * Normalize text for case-insensitive comparison
   * @param {string} text - Text to normalize
   * @returns {string} Lowercase trimmed text
   */
  function normalizeText(text) {
    return String(text || '').toLowerCase().trim();
  }

  // ==================== Template System ====================

  const templateCache = new Map();

  function getTemplate(id) {
    if (templateCache.has(id)) return templateCache.get(id);
    const el = document.getElementById(id);
    if (!el) throw new Error(`Template ${id} not found`);
    templateCache.set(id, el);
    return el;
  }

  function cloneTemplate(id) {
    const tpl = getTemplate(id);
    return tpl.content.cloneNode(true).firstElementChild;
  }

  // ==================== Toast Notifications ====================

  function clearToasts() {
    const container = $('#toastContainer');
    if (!container) return;
    container.innerHTML = '';
  }

  // Icon mapping for toast types
  const TOAST_ICONS = {
    info: '#icon-toast-info',
    success: '#icon-toast-success',
    error: '#icon-toast-error',
    confirm: '#icon-toast-confirm'
  };

  function showConfirmToast(message, onConfirm, onCancel) {
    const container = $('#toastContainer');
    if (!container) return;

    // Clear existing toasts
    container.innerHTML = '';

    const toast = cloneTemplate('tpl-toast');
    toast.classList.add('confirm');
    toast.querySelector('.toast-message').textContent = message;
    toast.querySelector('.toast-icon use').setAttribute('href', TOAST_ICONS.confirm);
    toast.querySelector('.toast-actions').hidden = false;

    container.appendChild(toast);

    // Wire up buttons
    toast.querySelector('.toast-confirm').addEventListener('click', () => {
      toast.remove();
      onConfirm();
    });
    toast.querySelector('.toast-cancel').addEventListener('click', () => {
      toast.remove();
      if (onCancel) onCancel();
    });

    // Trigger animation
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    return toast;
  }

  function showToast(message, type = 'info', duration = 3000) {
    const container = $('#toastContainer');
    if (!container) return;

    const toast = cloneTemplate('tpl-toast');
    toast.classList.add(type);
    toast.querySelector('.toast-message').textContent = message;
    toast.querySelector('.toast-icon use').setAttribute('href', TOAST_ICONS[type] || TOAST_ICONS.info);

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

  // ==================== Data Cache (IndexedDB) ====================

  const DB_NAME = 'rxBuilderDB';
  const DB_VERSION = 1;
  const STORE_DATA = 'drugData';
  const STORE_META = 'drugMeta';

  let dbPromise = null;

  /**
   * Open IndexedDB connection
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_DATA)) {
          db.createObjectStore(STORE_DATA, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
    });

    return dbPromise;
  }

  /**
   * Save drug data to IndexedDB with version metadata
   * @param {Array} data - The drug data array
   * @param {Object} meta - Version metadata {source, versionId, lastUpdated, timestamp}
   */
  async function saveCachedData(data, meta) {
    try {
      const db = await openDB();

      // Store data (compressed by removing _fhirConcept which can be huge)
      const dataToStore = data.map((item, index) => {
        const { _fhirConcept, ...rest } = item;
        return { id: index, ...rest };
      });

      // Clear old data and store new data
      const transaction = db.transaction([STORE_DATA, STORE_META], 'readwrite');
      const dataStore = transaction.objectStore(STORE_DATA);
      const metaStore = transaction.objectStore(STORE_META);

      // Clear existing data
      await new Promise((resolve, reject) => {
        const clearReq = dataStore.clear();
        clearReq.onsuccess = resolve;
        clearReq.onerror = () => reject(clearReq.error);
      });

      // Store each record
      for (const record of dataToStore) {
        dataStore.put(record);
      }

      // Store metadata
      metaStore.put({
        key: 'meta',
        ...meta,
        timestamp: Date.now(),
        recordCount: data.length
      });

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });

      console.log(`Cached ${data.length} records to IndexedDB`);
      return true;
    } catch (error) {
      console.error('Failed to cache data:', error);
      return false;
    }
  }

  /**
   * Load cached drug data from IndexedDB
   * @returns {{data: Array|null, meta: Object|null}}
   */
  async function loadCachedData() {
    try {
      const db = await openDB();

      const transaction = db.transaction([STORE_DATA, STORE_META], 'readonly');
      const dataStore = transaction.objectStore(STORE_DATA);
      const metaStore = transaction.objectStore(STORE_META);

      // Load metadata
      const meta = await new Promise((resolve, reject) => {
        const request = metaStore.get('meta');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!meta) {
        return { data: null, meta: null };
      }

      // Load all data records
      const data = await new Promise((resolve, reject) => {
        const request = dataStore.getAll();
        request.onsuccess = () => {
          // Sort by id to maintain order, then remove id field
          const records = request.result
            .sort((a, b) => a.id - b.id)
            .map(({ id, ...rest }) => rest);
          resolve(records);
        };
        request.onerror = () => reject(request.error);
      });

      console.log(`Loaded ${data.length} records from cache (saved ${new Date(meta.timestamp).toLocaleString()})`);
      return { data, meta };
    } catch (error) {
      console.error('Failed to load cached data:', error);
      await clearCachedData();
      return { data: null, meta: null };
    }
  }

  /**
   * Clear cached data from IndexedDB
   */
  async function clearCachedData() {
    try {
      const db = await openDB();
      const transaction = db.transaction([STORE_DATA, STORE_META], 'readwrite');
      transaction.objectStore(STORE_DATA).clear();
      transaction.objectStore(STORE_META).clear();
      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      console.log('Cleared drug cache from IndexedDB');
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  }

  /**
   * Check if cached data needs updating by comparing versions
   * @param {Object} cachedMeta - The cached metadata
   * @param {string} remoteVersionId - FHIR versionId or CSV date
   * @param {string} source - 'fhir' or 'csv'
   * @returns {boolean} true if update needed
   */
  function isCacheStale(cachedMeta, remoteVersionId, source) {
    if (!cachedMeta) return true;
    if (cachedMeta.source !== source) return true;
    if (!remoteVersionId) return true;

    // For FHIR: compare versionId
    // For CSV: compare lastUpdated (commit date)
    return cachedMeta.versionId !== remoteVersionId;
  }

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
  }

  function setStatus(text, type = 'loading') {
    const statusEl = $('#loadStatus');
    if (!statusEl) return;

    statusEl.textContent = text;
    statusEl.className = `status-badge ${type}`;
  }

  // Precomputed field keys for filtering
  const FILTER_PREDICATE_KEYS = [
    'Generic Name',
    'Brand Name',
    'Pharmacologic Category',
    'Classification',
    'Manufacturer',
    'Dosage Form',
    'Dosage Strength'
  ];

  /**
   * Normalize row data for faster filtering
   * Pre-computes lowercase values and flags
   * @param {Array} data - Raw drug data
   * @returns {Array} Normalized data with _norm property
   */
  function normalizeData(data) {
    return data.map(row => {
      const classification = normalizeText(row['Classification']);
      const category = normalizeText(row['Pharmacologic Category']);
      const brand = normalizeText(row['Brand Name']);
      const generic = normalizeText(row['Generic Name']);

      return {
        ...row,
        _norm: {
          classification,
          category,
          brand,
          generic,
          isRx: classification.includes('prescription') || classification === 'rx',
          isOtc: classification.includes('over-the-counter') || classification.includes('otc'),
          isGeneric: brand === 'none' || brand === '',
          isVet: category.includes('veterinary') || classification.includes('veterinary') ||
                 brand.includes('(vet.)') || brand.includes('vet') || generic.includes('(vet.)') || generic.includes('veterinary'),
          isSupplement: classification.includes('supplement'),
          isMedicalDevice: classification.includes('medical device') || classification.includes('medicaldevice'),
          searchableText: FILTER_PREDICATE_KEYS.map(k => normalizeText(row[k])).join(' ')
        }
      };
    });
  }

  /**
   * Centralized function to finalize data loading
   * Updates state, UI badges, summary, and triggers rendering
   * @param {Array} data - The drug data array
   * @param {string} source - Data source identifier ('fhir-fresh', 'fhir', 'csv-fresh', 'csv', 'cached')
   * @param {string} statusLabel - Label for the status bar (e.g., 'FHIR', 'CSV', 'Cache')
   * @param {string} lastUpdated - Date string for the update badge
   */
  function finalizeDataLoad(data, source, statusLabel, lastUpdated) {
    // Normalize data for faster filtering
    const normalizedData = normalizeData(data);

    state.data = normalizedData;
    state.page = 1;
    state.isDataLoaded = true;
    state.dataSource = source;
    state.lastUpdatedText = lastUpdated;

    updateDataSourceBadge();
    setStatus(`${data.length.toLocaleString()} records | ${statusLabel}`, 'loaded');
    $('#summary').textContent = `${data.length.toLocaleString()} records`;
    $('#updateBadge').textContent = `Updated: ${lastUpdated}`;

    showSearchUI();
    buildQuickIndex();
    filterAndRender();
  }

  function updateDataSourceBadge() {
    const badgeEl = $('#dataSourceBadge');
    if (!badgeEl) return;

    const source = state.dataSource;
    if (source === 'fhir-fresh') {
      badgeEl.textContent = 'FHIR';
      badgeEl.className = 'status-badge online';
    } else if (source === 'fhir') {
      badgeEl.textContent = 'FHIR';
      badgeEl.className = 'status-badge online';
    } else if (source === 'csv-fresh') {
      badgeEl.textContent = 'CSV';
      badgeEl.className = 'status-badge offline';
    } else if (source === 'csv') {
      badgeEl.textContent = 'CSV';
      badgeEl.className = 'status-badge offline';
    } else if (source === 'cached') {
      badgeEl.textContent = 'Cache';
      badgeEl.className = 'status-badge offline';
    } else {
      badgeEl.textContent = 'Offline';
      badgeEl.className = 'status-badge offline';
    }
  }

  // ==================== FHIR ValueSet Loading ====================

  /**
   * Load data from FHIR server
   * @param {Object} options - Loading options
   * @param {boolean} options.fromBackgroundUpdate - If true, don't show error toasts or fallback UI
   * @param {boolean} options.skipCacheFallback - If true, don't fallback to cache on error
   * @param {string} options.successMessage - Custom success toast message
   */
  async function tryFHIRLoad(options = {}) {
    const { fromBackgroundUpdate = false, skipCacheFallback = false, successMessage = null } = options;

    setStatus('Loading from FHIR...', 'loading');

    try {
      const { concepts: allConcepts, meta } = await fetchAllValueSetConcepts();

      if (allConcepts.length === 0) {
        throw new Error('No concepts returned from FHIR server');
      }

      // Convert FHIR concepts to the same format as CSV data
      const data = convertFHIRConceptsToData(allConcepts);

      // Use FHIR CodeSystem meta.lastUpdated for the badge
      const lastUpdated = meta?.lastUpdated
        ? new Date(meta.lastUpdated).toLocaleDateString()
        : new Date().toLocaleDateString();

      finalizeDataLoad(data, 'fhir-fresh', 'FHIR', lastUpdated);

      // Save to cache
      const versionId = meta?.versionId || meta?.lastUpdated;
      await saveCachedData(data, {
        source: 'fhir',
        versionId: versionId,
        lastUpdated: meta?.lastUpdated || new Date().toISOString()
      });

      clearToasts();
      const msg = successMessage || (fromBackgroundUpdate
        ? `Updated to ${data.length.toLocaleString()} drugs from FHIR server`
        : `Loaded ${data.length.toLocaleString()} drugs from FHIR server`);
      showToast(msg, 'success');
    } catch (error) {
      console.error('FHIR load failed:', error);

      // If called from background update and we have data, just keep using it
      if (fromBackgroundUpdate && state.data && state.data.length > 0) {
        console.log('Background FHIR update failed, keeping existing data');
        return;
      }

      if (skipCacheFallback) return;

      // Check if we have cached data to fall back to
      const cached = await loadCachedData();
      if (cached.data && cached.data.length > 0) {
        // Keep using cached data
        const lastUpdated = cached.meta?.lastUpdated
          ? new Date(cached.meta.lastUpdated).toLocaleDateString()
          : new Date(cached.meta?.timestamp).toLocaleDateString();

        finalizeDataLoad(cached.data, 'cached', 'Cache (FHIR failed)', lastUpdated);

        if (!fromBackgroundUpdate) {
          showToast('FHIR server unavailable, using cached data', 'warning');
        }
        return;
      }

      // No cache - fall back to CSV
      setStatus('FHIR failed, trying CSV...', 'loading');
      if (!fromBackgroundUpdate) {
        showToast('FHIR server unavailable, falling back to CSV', 'error');
      }
      setTimeout(() => tryCSVLoadWithCache({ fromBackgroundUpdate }), 500);
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

  /**
   * Alias for tryCSVLoadWithCache for backward compatibility
   * @deprecated Use tryCSVLoadWithCache instead
   */
  async function tryAutoLoad(options = {}) {
    return tryCSVLoadWithCache(options);
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
  function parseAndLoadCSV(text, _filename = null, githubDate = null, _fromBackgroundUpdate = false) {
    const rows = CSVToArray(text);

    if (!rows.length) {
      setStatus('Empty CSV', 'error');
      return [];
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

    finalizeDataLoad(data, 'csv-fresh', 'CSV', lastUpdatedText);

    return data;
  }

  function showUploadUI() {
    $('#uploadArea').hidden = false;
    $('#searchInterface').hidden = true;
  }

  function showSearchUI() {
    $('#uploadArea').hidden = true;
    $('#searchInterface').hidden = false;
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
    const btnOnlyRX = $('#btnOnlyRX');
    const btnOnlyOTC = $('#btnOnlyOTC');
    const btnOnlyGeneric = $('#btnOnlyGeneric');
    const btnShowVet = $('#btnShowVet');
    const btnShowSupplement = $('#btnShowSupplement');
    const btnShowMedicalDevice = $('#btnShowMedicalDevice');
    const clearSearch = $('#clearSearch');
    const clearFilters = $('#clearFilters');

    // Search input with debounce
    q?.addEventListener('input', debounce(() => {
      state.searchQ = q.value.trim();
      state.page = 1;
      filterAndRender();
    }, 150));

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
      state.onlyGeneric = false;
      state.showVet = false;
      state.showSupplement = false;
      state.showMedicalDevice = false;
      btnOnlyRX?.classList.remove('active');
      btnOnlyOTC?.classList.remove('active');
      btnOnlyGeneric?.classList.remove('active');
      btnShowVet?.classList.remove('active');
      btnShowSupplement?.classList.remove('active');
      btnShowMedicalDevice?.classList.remove('active');
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

    // Lock filter buttons
    btnOnlyRX?.addEventListener('click', () => {
      state.onlyRX = !state.onlyRX;
      if (state.onlyRX) state.onlyOTC = false;
      btnOnlyRX.classList.toggle('active', state.onlyRX);
      btnOnlyOTC?.classList.remove('active');
      state.page = 1;
      filterAndRender();
    });

    btnOnlyOTC?.addEventListener('click', () => {
      state.onlyOTC = !state.onlyOTC;
      if (state.onlyOTC) state.onlyRX = false;
      btnOnlyOTC.classList.toggle('active', state.onlyOTC);
      btnOnlyRX?.classList.remove('active');
      state.page = 1;
      filterAndRender();
    });

    btnOnlyGeneric?.addEventListener('click', () => {
      state.onlyGeneric = !state.onlyGeneric;
      btnOnlyGeneric.classList.toggle('active', state.onlyGeneric);
      state.page = 1;
      filterAndRender();
    });

    btnShowVet?.addEventListener('click', () => {
      state.showVet = !state.showVet;
      btnShowVet.classList.toggle('active', state.showVet);
      state.page = 1;
      filterAndRender();
    });

    btnShowSupplement?.addEventListener('click', () => {
      state.showSupplement = !state.showSupplement;
      btnShowSupplement.classList.toggle('active', state.showSupplement);
      state.page = 1;
      filterAndRender();
    });

    btnShowMedicalDevice?.addEventListener('click', () => {
      state.showMedicalDevice = !state.showMedicalDevice;
      btnShowMedicalDevice.classList.toggle('active', state.showMedicalDevice);
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
          listEl.hidden = false;
          tableContainer.hidden = true;
        } else {
          listEl.hidden = true;
          tableContainer.hidden = false;
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
      listEl.hidden = false;
      tableContainer.hidden = true;
    } else {
      listEl.hidden = true;
      tableContainer.hidden = false;
    }
  }

  function scrollToResults() {
    const results = $('.results-container');
    if (results) {
      results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function filterAndRender() {
    const q = normalizeText(state.searchQ);
    const f = state.searchField;
    const terms = q ? q.split(/\s+/).filter((t) => t.length > 0) : [];

    state.filtered = state.data.filter((row) => {
      const norm = row._norm;
      if (!norm) return false;

      // Classification filters using pre-computed flags
      if (state.onlyRX && !norm.isRx) return false;
      if (state.onlyOTC && !norm.isOtc) return false;
      if (state.onlyGeneric && !norm.isGeneric) return false;
      if (!state.showVet && norm.isVet) return false;
      if (!state.showSupplement && norm.isSupplement) return false;
      if (!state.showMedicalDevice && norm.isMedicalDevice) return false;

      if (!q) return true;

      if (f === 'all') {
        return terms.every((term) => norm.searchableText.includes(term));
      } else {
        const fieldValue = normalizeText(row[f]);
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
      emptyEl.hidden = false;
    } else {
      emptyEl.hidden = true;
      const h = (s) => highlight(String(s || ''), state.searchQ.trim().toLowerCase());

      if (state.viewMode === 'cards') {
        // Card view
        listEl.hidden = false;
        tableContainer.hidden = true;
        listEl.innerHTML = '';

        const fragment = document.createDocumentFragment();
        state.pageRows.forEach((r, idx) => {
          fragment.appendChild(renderDrugCard(r, idx, h));
        });
        listEl.appendChild(fragment);

        // Event delegation for card interactions
        listEl.onclick = (e) => {
          const btn = e.target.closest('.add-rx-btn');
          if (btn) {
            e.stopPropagation();
            const idx = +btn.dataset.idx;
            addRxFromRecord(state.pageRows[idx]);
            showToast('Added to prescription', 'success');
            return;
          }

          const card = e.target.closest('.drug-card');
          if (card) {
            const idx = +card.dataset.idx;
            addRxFromRecord(state.pageRows[idx]);
            showToast('Added to prescription', 'success');
          }
        };
      } else {
        // Table view
        listEl.hidden = true;
        tableContainer.hidden = false;
        tableBody.innerHTML = '';

        const fragment = document.createDocumentFragment();
        state.pageRows.forEach((r, idx) => {
          fragment.appendChild(renderDrugTableRow(r, idx, h));
        });
        tableBody.appendChild(fragment);

        // Event delegation for table buttons
        tableBody.onclick = (e) => {
          const btn = e.target.closest('.add-table-btn');
          if (btn) {
            const idx = +btn.dataset.idx;
            addRxFromRecord(state.pageRows[idx]);
            showToast('Added to prescription', 'success');
          }
        };
      }
    }

    // Update pagination
    $('#pageInfo').textContent = `Page ${state.page} of ${pages}`;
    $('#prev').disabled = state.page <= 1;
    $('#next').disabled = state.page >= pages;
    $('#filterSummary').textContent = `${total.toLocaleString()} shown`;
  }

  function renderDrugCard(r, idx, highlightFn) {
    const card = cloneTemplate('tpl-drug-card');
    card.dataset.idx = idx;

    const classification = r['Classification'] || '';
    const isRx = classification.toLowerCase().includes('rx');
    const isOtc = classification.toLowerCase().includes('over-the-counter');
    const isHousehold = classification.toLowerCase().includes('household');
    const isHumanDrug = classification.toLowerCase().includes('human drug');
    const expiryStatus = getExpiryStatus(r['Expiry Date']);

    // Set chip
    const chipEl = card.querySelector('[data-field="chip"]');
    if (isHumanDrug) {
      chipEl.remove();
    } else {
      let chipClass = '';
      let chipText = classification;
      if (isRx) { chipClass = 'rx'; chipText = 'Rx'; }
      else if (isOtc) { chipClass = 'otc'; chipText = 'OTC'; }
      else if (isHousehold) { chipClass = 'household'; chipText = 'Household Remedy'; }
      chipEl.className = `drug-class ${chipClass}`;
      chipEl.textContent = chipText;
    }

    // Set text fields with highlighting
    const generic = r['Generic Name'] || '';
    const brand = r['Brand Name'] || '';
    card.querySelector('[data-field="generic"]').innerHTML = highlightFn(generic);
    card.querySelector('[data-field="brand"]').innerHTML = highlightFn(brand);

    // Strength
    const strengthEl = card.querySelector('[data-field="strength"]');
    const strength = r['Dosage Strength'];
    if (strength) {
      strengthEl.innerHTML = `<strong>${highlightFn(strength)}</strong>`;
    } else {
      strengthEl.remove();
    }

    // Form
    const formEl = card.querySelector('[data-field="form"]');
    const form = r['Dosage Form'];
    if (form) {
      formEl.textContent = form;
    } else {
      formEl.remove();
    }

    // Manufacturer
    const mfrEl = card.querySelector('[data-field="manufacturer"]');
    const manufacturer = r['Manufacturer'];
    if (manufacturer) {
      mfrEl.textContent = manufacturer.slice(0, 30);
    } else {
      mfrEl.remove();
    }

    // Registration and expiry
    card.querySelector('[data-field="regNo"]').textContent = r['Registration Number'] || '';
    const expiryEl = card.querySelector('[data-field="expiry"]');
    expiryEl.className = `drug-expiry ${expiryStatus.class}`;
    expiryEl.textContent = `Exp: ${r['Expiry Date'] || 'N/A'}`;

    // Set button index
    card.querySelector('.add-rx-btn').dataset.idx = idx;

    return card;
  }

  function renderDrugTableRow(r, idx, highlightFn) {
    const row = cloneTemplate('tpl-table-row');
    row.dataset.idx = idx;

    const classification = r['Classification'] || '';
    const isRx = classification.toLowerCase() === 'rx';
    const isOtc = classification.toLowerCase().includes('over-the-counter');
    const isHousehold = classification.toLowerCase().includes('household');
    const isHumanDrug = classification.toLowerCase().includes('human drug');
    const expiryStatus = getExpiryStatus(r['Expiry Date']);

    // Set text fields with highlighting and tooltips
    const generic = r['Generic Name'] || '';
    const brand = r['Brand Name'] || '';
    const manufacturer = r['Manufacturer'] || '';

    const genericCell = row.querySelector('[data-field="generic"]');
    genericCell.innerHTML = highlightFn(generic);
    genericCell.title = generic;

    const brandCell = row.querySelector('[data-field="brand"]');
    brandCell.innerHTML = highlightFn(brand);
    brandCell.title = brand;

    row.querySelector('[data-field="strength"]').innerHTML = highlightFn(r['Dosage Strength'] || '');
    row.querySelector('[data-field="form"]').textContent = r['Dosage Form'] || '';

    // Classification badge
    const clsCell = row.querySelector('[data-field="classification"]');
    if (isHumanDrug) {
      clsCell.textContent = '';
    } else {
      let badgeClass = '';
      let badgeText = classification;
      if (isRx) { badgeClass = 'rx'; badgeText = 'Rx'; }
      else if (isOtc) { badgeClass = 'otc'; badgeText = 'OTC'; }
      else if (isHousehold) { badgeClass = 'household'; badgeText = 'Household Remedy'; }
      clsCell.innerHTML = `<span class="rx-badge ${badgeClass}">${badgeText}</span>`;
    }

    const mfrCell = row.querySelector('[data-field="manufacturer"]');
    mfrCell.innerHTML = highlightFn(manufacturer);
    mfrCell.title = manufacturer;

    row.querySelector('[data-field="regNo"]').textContent = r['Registration Number'] || '';

    const expiryCell = row.querySelector('[data-field="expiry"]');
    expiryCell.className = expiryStatus.class;
    expiryCell.textContent = r['Expiry Date'] || '—';

    // Set button index
    row.querySelector('.add-table-btn').dataset.idx = idx;

    return row;
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
      t: r._norm?.searchableText || ''
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

    // Quick add search with debounce
    drugQuick?.addEventListener('input', debounce(() => {
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
        sideResults.innerHTML = '';
        sideResults.appendChild(cloneTemplate('tpl-side-card-empty'));
      } else {
        sideResults.innerHTML = '';
        const h = (s) => highlight(String(s || ''), q);

        hits.forEach((hit) => {
          const r = state.data[hit.i];
          sideResults.appendChild(renderSideCard(r, q, hit.i, h));
        });

        // Event delegation for add buttons
        sideResults.onclick = (e) => {
          const btn = e.target.closest('.add-side-btn');
          if (btn) {
            const idx = +btn.dataset.i;
            addRxFromRecord(state.data[idx]);
            drugQuick.value = '';
            sideResults.innerHTML = '';
          }
        };
      }
    }, 150));

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
      const itemCount = rxItems.querySelectorAll('.rx-item').length;
      if (itemCount === 0) return;

      showConfirmToast(
        `Remove all ${itemCount} medication${itemCount > 1 ? 's' : ''}?`,
        () => {
          rxItems.innerHTML = '';
          rxItems.appendChild(cloneTemplate('tpl-empty-rx'));
          state.rxItemCount = 0;
          updateRxBadge();
          updateRxPreview();
          showToast('All items cleared', 'info');
        }
      );
    });

    // Save/Load local
    $('#saveLocal')?.addEventListener('click', saveLocal);
    $('#loadLocal')?.addEventListener('click', loadLocal);

    // Copy
    $('#copyRx')?.addEventListener('click', copyRx);

    // Print
    $('#printRx')?.addEventListener('click', printRx);

    // Save as Image
    $('#saveImageRx')?.addEventListener('click', saveAsImage);

    // Event delegation for prescription items (click actions and input updates)
    const rxItems = $('#rxItems');
    if (rxItems) {
      rxItems.addEventListener('click', handleRxItemAction);
      rxItems.addEventListener('input', handleRxItemInput);
    }

    // Initialize signature pad
    initSignaturePad();
  }

  // ==================== Signature Pad ====================

  let signatureCanvas = null;
  let signatureCtx = null;
  let isDrawing = false;
  let signatureData = localStorage.getItem('rxSignatureData') || '';

  function initSignaturePad() {
    signatureCanvas = $('#signatureCanvas');
    if (!signatureCanvas) return;

    signatureCtx = signatureCanvas.getContext('2d');
    signatureCtx.strokeStyle = '#000000';
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    signatureCtx.lineJoin = 'round';

    // Restore saved signature if exists
    if (signatureData) {
      restoreSignature(signatureData);
    }

    // Mouse events
    signatureCanvas.addEventListener('mousedown', startDrawing);
    signatureCanvas.addEventListener('mousemove', draw);
    signatureCanvas.addEventListener('mouseup', stopDrawing);
    signatureCanvas.addEventListener('mouseleave', stopDrawing);

    // Touch events
    signatureCanvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    signatureCanvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    signatureCanvas.addEventListener('touchend', stopDrawing);

    // Upload button
    $('#uploadSignature')?.addEventListener('click', () => {
      $('#signatureFileInput')?.click();
    });

    // File input change
    $('#signatureFileInput')?.addEventListener('change', handleSignatureUpload);

    // Clear button
    $('#clearSignature')?.addEventListener('click', clearSignature);
  }

  function startDrawing(e) {
    isDrawing = true;
    signatureCanvas.classList.add('signing');
    const { x, y } = getCanvasCoordinates(e);
    signatureCtx.beginPath();
    signatureCtx.moveTo(x, y);
  }

  function draw(e) {
    if (!isDrawing) return;
    e.preventDefault();
    const { x, y } = getCanvasCoordinates(e);
    signatureCtx.lineTo(x, y);
    signatureCtx.stroke();
  }

  function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    signatureCanvas.classList.remove('signing');
    saveSignatureData();
  }

  function handleTouchStart(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousedown', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    signatureCanvas.dispatchEvent(mouseEvent);
  }

  function handleTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    const mouseEvent = new MouseEvent('mousemove', {
      clientX: touch.clientX,
      clientY: touch.clientY
    });
    signatureCanvas.dispatchEvent(mouseEvent);
  }

  function getCanvasCoordinates(e) {
    const rect = signatureCanvas.getBoundingClientRect();
    const scaleX = signatureCanvas.width / rect.width;
    const scaleY = signatureCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function saveSignatureData() {
    signatureData = signatureCanvas.toDataURL('image/png');
    localStorage.setItem('rxSignatureData', signatureData);
  }

  function restoreSignature(dataUrl) {
    if (!signatureCtx || !dataUrl) return;
    const img = new Image();
    img.onload = () => {
      signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
      signatureCtx.drawImage(img, 0, 0);
    };
    img.src = dataUrl;
  }

  function clearSignature() {
    if (!signatureCtx) return;
    signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);
    signatureData = '';
    localStorage.removeItem('rxSignatureData');
  }

  function handleSignatureUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('Please select an image file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        // Clear canvas and draw uploaded image scaled to fit
        signatureCtx.clearRect(0, 0, signatureCanvas.width, signatureCanvas.height);

        // Calculate scaling to fit within canvas while maintaining aspect ratio
        const scale = Math.min(
          signatureCanvas.width / img.width,
          signatureCanvas.height / img.height,
          1
        );
        const x = (signatureCanvas.width - img.width * scale) / 2;
        const y = (signatureCanvas.height - img.height * scale) / 2;

        signatureCtx.drawImage(img, x, y, img.width * scale, img.height * scale);
        saveSignatureData();
        showToast('Signature uploaded', 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);

    // Reset file input
    e.target.value = '';
  }

  function renderSideCard(r, q, idx, highlightFn) {
    const card = cloneTemplate('tpl-side-card');
    const expiry = r['Expiry Date'] || '';

    card.querySelector('[data-field="generic"]').innerHTML = highlightFn(r['Generic Name'] || '');
    card.querySelector('[data-field="brandStrength"]').innerHTML =
      `${highlightFn(r['Brand Name'] || '')} • ${highlightFn(r['Dosage Strength'] || '')}`;
    card.querySelector('[data-field="formExpiry"]').textContent =
      `${r['Dosage Form'] || ''} • Exp: ${expiry || 'N/A'}`;

    const btn = card.querySelector('.add-side-btn');
    btn.dataset.i = idx;

    return card;
  }

  function addRxFromRecord(r) {
    const rawBrand = r['Brand Name'] || '';
    const brandName = rawBrand.toLowerCase() === 'none' ? '' : rawBrand;
    const rawGeneric = r['Generic Name'] || '';
    // Remove parenthetical content from generic name (e.g., "Esomeprazole (as magnesium trihydrate)" -> "Esomeprazole")
    const genericName = rawGeneric.replace(/\s*\([^)]*\)/g, '').trim();
    addRxItem({
      genericName: genericName,
      brandName: brandName,
      strength: r['Dosage Strength'] || '',
      form: r['Dosage Form'] || ''
    });
  }

  function addRxItem({ genericName = '', brandName = '', strength = '', form = '', qty = '', sig = '' }) {
    const rxItems = $('#rxItems');

    // Remove empty state if present
    const emptyState = rxItems.querySelector('.empty-rx');
    if (emptyState) {
      emptyState.remove();
    }

    state.rxItemCount++;
    updateRxBadge();

    const div = cloneTemplate('tpl-rx-item');
    div.querySelector('.rx-item-number').textContent = state.rxItemCount;
    div.querySelector('.rx-generic').value = genericName;
    div.querySelector('.rx-brand').value = brandName;
    div.querySelector('.rx-strength').value = strength;
    div.querySelector('.rx-form').value = form;
    div.querySelector('.rx-qty').value = qty;
    div.querySelector('.rx-sig').value = sig;

    rxItems.appendChild(div);

    // Focus first field
    div.querySelector('.rx-generic').focus();

    // Scroll to item on mobile
    if (window.innerWidth < 640) {
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Update the live preview
    updateRxPreview();
  }

  /**
   * Handle prescription item actions via event delegation
   * @param {Event} e - Click event
   */
  function handleRxItemAction(e) {
    const btn = e.target.closest('.rx-item-actions button, .rx-item input');
    if (!btn) return;

    const div = btn.closest('.rx-item');
    if (!div) return;

    const rxItems = $('#rxItems');

    if (btn.classList.contains('remove')) {
      div.remove();
      renumberItems();
      if (rxItems.children.length === 0) {
        rxItems.innerHTML = '';
        rxItems.appendChild(cloneTemplate('tpl-empty-rx'));
        state.rxItemCount = 0;
        updateRxBadge();
      }
      updateRxPreview();
    } else if (btn.classList.contains('duplicate')) {
      const vals = collectItem(div);
      addRxItem(vals);
    } else if (btn.classList.contains('move-up')) {
      if (div.previousElementSibling) {
        div.parentNode.insertBefore(div, div.previousElementSibling);
        renumberItems();
        updateRxPreview();
      }
    } else if (btn.classList.contains('move-down')) {
      if (div.nextElementSibling) {
        div.parentNode.insertBefore(div.nextElementSibling, div);
        renumberItems();
        updateRxPreview();
      }
    }
  }

  /**
   * Handle input changes for live preview via event delegation
   * @param {Event} e - Input event
   */
  function handleRxItemInput(e) {
    if (e.target.closest('.rx-item')) {
      updateRxPreview();
    }
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
      badge.hidden = state.rxItemCount === 0;
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
    const fields = getFormFields();

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    const payload = {
      meta: Object.fromEntries(
        Object.entries(fields).map(([k, el]) => [k, el?.value || ''])
      ),
      items,
      signature: signatureData || localStorage.getItem('rxSignatureData') || ''
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
      const fields = getFormFields();

      Object.entries(data.meta || {}).forEach(([k, v]) => {
        if (fields[k]) fields[k].value = v;
      });

      const rxItems = $('#rxItems');
      rxItems.innerHTML = '';
      state.rxItemCount = 0;

      const items = data.items || [];
      if (items.length === 0) {
        rxItems.appendChild(cloneTemplate('tpl-empty-rx'));
      } else {
        items.forEach((item) => addRxItem(item));
      }

      // Restore signature if present
      const savedSig = data.signature || '';
      if (savedSig) {
        signatureData = savedSig;
        localStorage.setItem('rxSignatureData', savedSig);
        restoreSignature(savedSig);
      }

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
      previewEl.innerHTML = '';
      previewEl.appendChild(cloneTemplate('tpl-rx-preview-empty'));
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

  function getFormFields() {
    return {
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
  }

  function populatePrintTemplate() {
    const fields = getFormFields();

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
    $('#pPRCWrap').textContent = prcVal ? `PRC: ${prcVal}` : '';
    $('#pPTRWrap').textContent = ptrVal ? `PTR: ${ptrVal}` : '';
    $('#pS2Wrap').textContent = s2Val ? `S2: ${s2Val}` : '';

    // Show/hide signature label based on whether licenses are present
    const hasAnyLicense = prcVal || ptrVal || s2Val;
    $('#signatureLabel').hidden = hasAnyLicense;

    const ol = $('#pItems');
    ol.innerHTML = '';

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    for (const it of items) {
      const li = cloneTemplate('tpl-print-item');

      const namePart = it.genericName && it.brandName
        ? `${it.genericName} (${it.brandName})`
        : it.genericName;
      const strengthPart = it.strength || '';
      const formPart = it.form || '';
      const qtyPart = it.qty ? ` #${it.qty}` : '';
      const line1Left = `${namePart} ${strengthPart} ${formPart}`.trim();

      const nameSpan = li.querySelector('.rx-name');
      const qtySpan = li.querySelector('.qty-right');
      const sigDiv = li.querySelector('.rx-sig');

      nameSpan.textContent = line1Left;

      if (qtyPart) {
        qtySpan.textContent = qtyPart;
      } else {
        qtySpan.remove();
      }

      if (it.sig) {
        sigDiv.textContent = `Sig. ${it.sig}`;
      } else {
        sigDiv.remove();
      }

      ol.appendChild(li);
    }

    const notes = fields.rxNotes?.value?.trim();
    $('#pNotes').textContent = notes ? `Notes: ${notes}` : '';

    // Populate signature image if available
    const sigImg = $('#pSignatureImage');
    if (sigImg) {
      const sigData = signatureData || localStorage.getItem('rxSignatureData') || '';
      if (sigData) {
        sigImg.src = sigData;
        sigImg.style.display = 'block';
      } else {
        sigImg.src = '';
        sigImg.style.display = 'none';
      }
    }

    return fields;
  }

  function printRx() {
    populatePrintTemplate();
    window.print();
  }

  async function saveAsImage() {
    if (!window.htmlToImage) {
      showToast('Image library not loaded. Please try again.', 'error');
      return;
    }

    const printEl = $('#rxPrint');
    if (!printEl) {
      showToast('Print template not found', 'error');
      return;
    }

    // Populate the print template with current data
    const fields = populatePrintTemplate();

    // Show loading toast
    showToast('Generating image...', 'info');

    try {
      // Add capture-mode class to show element with proper styles
      printEl.classList.add('capture-mode');

      // Wait for next frame to ensure element is rendered
      await new Promise(resolve => requestAnimationFrame(resolve));
      // Wait another frame to be sure styles are applied
      await new Promise(resolve => requestAnimationFrame(resolve));

      // Wait for fonts to render
      await document.fonts.ready;

      // Small delay to ensure everything is painted
      await new Promise(resolve => setTimeout(resolve, 100));

      // Generate PNG
      const dataUrl = await window.htmlToImage.toPng(printEl, {
        quality: 1.0,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        skipFonts: false
      });

      // Remove capture-mode class
      printEl.classList.remove('capture-mode');

      // Create download link
      const link = document.createElement('a');
      const patientName = fields.ptName?.value?.trim() || 'prescription';
      const dateStr = new Date().toISOString().slice(0, 10);
      link.download = `rx-${patientName.replace(/\s+/g, '_')}-${dateStr}.png`;
      link.href = dataUrl;
      link.click();

      showToast('Image saved!', 'success');
    } catch (err) {
      console.error('Failed to generate image:', err);
      printEl.classList.remove('capture-mode');
      showToast('Failed to generate image. Please try again.', 'error');
    }
  }

  // ==================== Share Modal ====================

  const SHARE_URL = 'https://rxbuilder.vercel.app/';
  let qrCodeGenerated = false;

  /**
   * Initialize share modal functionality
   */
  function initShareModal() {
    const shareBadge = $('#shareBadge');
    const shareModal = $('#shareModal');
    const closeBtn = $('#closeShareModal');
    const copyBtn = $('#copyShareLink');
    const backdrop = shareModal?.querySelector('.share-backdrop');

    shareBadge?.addEventListener('click', openShareModal);
    closeBtn?.addEventListener('click', closeShareModal);
    backdrop?.addEventListener('click', closeShareModal);
    copyBtn?.addEventListener('click', copyShareLink);

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !shareModal?.hidden) {
        closeShareModal();
      }
    });
  }

  /**
   * Open the share modal and generate QR code if needed
   */
  function openShareModal() {
    const shareModal = $('#shareModal');
    if (!shareModal) return;

    shareModal.hidden = false;
    document.body.style.overflow = 'hidden'; // Prevent background scrolling

    // Generate QR code on first open
    if (!qrCodeGenerated) {
      generateQRCode();
      qrCodeGenerated = true;
    }
  }

  /**
   * Close the share modal
   */
  function closeShareModal() {
    const shareModal = $('#shareModal');
    if (!shareModal) return;

    shareModal.hidden = true;
    document.body.style.overflow = '';
  }

  /**
   * Generate a simple QR code using a reliable third-party API
   */
  function generateQRCode() {
    const qrContainer = $('#shareQR');
    if (!qrContainer) return;

    // Use QRServer API to generate QR code
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(SHARE_URL)}`;

    const img = document.createElement('img');
    img.src = qrUrl;
    img.alt = 'QR Code for Rx Builder';
    img.width = 180;
    img.height = 180;
    img.style.display = 'block';

    // Clear placeholder and add image
    qrContainer.innerHTML = '';
    qrContainer.appendChild(img);
  }

  /**
   * Copy the share link to clipboard
   */
  async function copyShareLink() {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      showToast('Link copied to clipboard!', 'success');
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = SHARE_URL;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showToast('Link copied to clipboard!', 'success');
      } catch (e) {
        showToast('Failed to copy link', 'error');
      }
      document.body.removeChild(textArea);
    }
  }

  // ==================== Initialization ====================

  async function init() {
    initNavigation();
    initCSVLoading();
    initSearch();
    initPrescription();
    initShareModal();

    // Load saved data on startup
    const saved = localStorage.getItem('rxBuilderSave_v2');
    if (saved) {
      // Don't auto-load, let user decide
    }

    // Try to load from cache first for immediate offline availability
    const cached = await loadCachedData();
    if (cached.data && cached.data.length > 0) {
      // Load cached data immediately
      const lastUpdated = cached.meta?.lastUpdated
        ? new Date(cached.meta.lastUpdated).toLocaleDateString()
        : new Date(cached.meta?.timestamp).toLocaleDateString();

      finalizeDataLoad(cached.data, 'cached', 'Cache', lastUpdated);

      // Check for updates in the background (silent - no toasts for connection issues)
      setTimeout(() => checkForUpdates(cached.meta), 1000);
    } else {
      // No cache - try to load from network (FHIR first, then CSV)
      setStatus('Loading drug data...', 'loading');
      await tryLoadFromNetwork();
    }
  }

  /**
   * Try to load from network sources (FHIR -> CSV)
   * Only called when there's no cached data
   */
  async function tryLoadFromNetwork() {
    // Try FHIR first
    try {
      const { concepts: allConcepts, meta } = await fetchAllValueSetConcepts();

      if (allConcepts.length === 0) {
        throw new Error('No concepts returned from FHIR server');
      }

      // Convert FHIR concepts to the same format as CSV data
      const data = convertFHIRConceptsToData(allConcepts);

      // Save to cache with version metadata
      const versionId = meta?.versionId || meta?.lastUpdated;
      await saveCachedData(data, {
        source: 'fhir',
        versionId: versionId,
        lastUpdated: meta?.lastUpdated || new Date().toISOString()
      });

      const lastUpdated = meta?.lastUpdated
        ? new Date(meta.lastUpdated).toLocaleDateString()
        : new Date().toLocaleDateString();

      finalizeDataLoad(data, 'fhir-fresh', 'FHIR', lastUpdated);

      clearToasts();
      showToast(`Loaded ${data.length.toLocaleString()} drugs from FHIR server`, 'success');
    } catch (error) {
      console.error('FHIR load failed:', error);
      // Fall back to CSV
      await tryCSVLoadWithCache();
    }
  }

  /**
   * Check for data updates in the background (silent - no errors shown to user)
   * @param {Object} cachedMeta - Current cached metadata
   */
  async function checkForUpdates(cachedMeta) {
    // Silently check for updates - don't disturb user if offline
    console.log('Checking for updates in background...');

    // Try FHIR first
    try {
      // Quick check to see if FHIR is available
      const url = `${FHIR_CONFIG.baseUrl}/CodeSystem/${FHIR_CONFIG.codeSystemId}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/fhir+json'
        },
        mode: 'cors'
      });

      if (response.ok) {
        const codeSystem = await response.json();
        const meta = codeSystem.meta;
        const versionId = meta?.versionId;

        if (isCacheStale(cachedMeta, versionId, 'fhir')) {
          showToast('New drug data available, updating...', 'info', 5000);
          await tryFHIRLoadWithCache({ fromBackgroundUpdate: true, skipCacheFallback: true });
        } else {
          console.log('Cache is up to date with FHIR server');
        }
        return;
      }
    } catch (error) {
      // Silent fail - we're just checking, cache is already loaded
      console.log('FHIR update check failed (likely offline):', error.message);
    }

    // Fallback to CSV check (only if FHIR not available)
    try {
      const githubDate = await fetchGitHubCSVLastUpdated();
      // If we can't get the GitHub date (offline), don't show "new data available"
      if (!githubDate) {
        console.log('Could not check CSV update date (likely offline), keeping cached data');
        return;
      }
      if (isCacheStale(cachedMeta, githubDate, 'csv')) {
        // Don't show toast until we successfully fetch the data
        await tryCSVLoadWithCache({ fromBackgroundUpdate: true });
      } else {
        console.log('Cache is up to date with CSV');
      }
    } catch (error) {
      // Silent fail - cache is already loaded and working
      console.log('CSV update check failed (likely offline):', error.message);
    }
  }

  /**
   * Load from FHIR and cache the result (compatibility wrapper)
   * @param {boolean|Object} options - If boolean, treated as fromBackgroundUpdate; otherwise options object
   */
  async function tryFHIRLoadWithCache(options = false) {
    const opts = typeof options === 'boolean'
      ? { fromBackgroundUpdate: options, skipCacheFallback: options }
      : options;
    return tryFHIRLoad({
      ...opts,
      successMessage: opts.fromBackgroundUpdate
        ? null
        : `Updated to ${state.data?.length?.toLocaleString() || ''} drugs from FHIR server`
    });
  }

  /**
   * Load from CSV and cache the result
   * @param {boolean|Object} options - If boolean, treated as fromBackgroundUpdate; otherwise options object
   * @param {boolean} options.fromBackgroundUpdate - If true, show toast only on success
   */
  async function tryCSVLoadWithCache(options = false) {
    const { fromBackgroundUpdate = false } = typeof options === 'boolean'
      ? { fromBackgroundUpdate: options }
      : options;

    setStatus('Loading CSV...', 'loading');

    // Check if we already have cached data - if so, keep it and don't show error
    const cached = await loadCachedData();
    const hasCache = cached.data && cached.data.length > 0;

    // Fetch GitHub last commit date for the CSV file
    let githubDate = null;
    try {
      githubDate = await fetchGitHubCSVLastUpdated();
    } catch (e) {
      console.log('Could not fetch GitHub date:', e);
    }

    try {
      const response = await fetch('Combined_All_CPR.csv');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const text = await response.text();
      const data = parseAndLoadCSV(text, null, githubDate, fromBackgroundUpdate);

      if (data && data.length > 0) {
        // Save to cache with version metadata (using GitHub commit date as version)
        await saveCachedData(data, {
          source: 'csv',
          versionId: githubDate || new Date().toISOString(),
          lastUpdated: githubDate || new Date().toISOString()
        });

        // Only show toast for background updates after successful fetch
        if (fromBackgroundUpdate) {
          showToast(`Updated to ${data.length.toLocaleString()} drugs from CSV`, 'success');
        }
      }
    } catch (error) {
      console.error('CSV load failed:', error);

      // If we have cached data, keep using it silently
      if (hasCache) {
        console.log('CSV load failed but cache exists, keeping cached data');
        setStatus(`${cached.data.length.toLocaleString()} records | Cache (offline)`, 'loaded');
        return;
      }

      // No cache - show error
      setStatus('Load failed', 'error');
      showUploadUI();
    }
  }

  // ==================== SMART on FHIR Integration ====================

  /**
   * SMART on FHIR state
   */
  const smartState = {
    isConnected: false,
    practitioner: null,
    patient: null,
    isLoading: false,
    manualPatient: null, // Stores manually entered patient details
    patientCheckTimeout: null, // Debounce timeout for patient existence check
    newPatientPending: null // Stores new patient data to be created on submit
  };

  /**
   * Initialize SMART on FHIR integration
   * Called during app initialization
   */
  async function initSMARTIntegration() {
    // Check if SMARTAuth is available
    if (typeof window.SMARTAuth === 'undefined') {
      console.log('[SMART] SMARTAuth module not loaded');
      return;
    }

    try {
      // Initialize SMART - check for existing session
      const result = await window.SMARTAuth.init();

      if (result.success) {
        console.log('[SMART] Session restored:', result);
        await handleSMARTConnected();
      } else {
        console.log('[SMART] No active session:', result.reason || result.error);
        updateSMARTUI(false);
      }
    } catch (error) {
      console.error('[SMART] Initialization failed:', error);
      updateSMARTUI(false);
    }

    // Set up event listeners
    setupSMARTEventListeners();
  }

  /**
   * Set up SMART on FHIR event listeners
   */
  function setupSMARTEventListeners() {
    // Connect button
    const connectBtn = $('#smartConnectBtn');
    if (connectBtn) {
      connectBtn.addEventListener('click', handleSMARTConnect);
    }

    // Sync practitioner button
    const syncBtn = $('#smartSyncPractitionerBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', handleSyncPractitioner);
    }

    // Submit to EHR button
    const submitBtn = $('#submitToEHR');
    if (submitBtn) {
      submitBtn.addEventListener('click', handleSubmitToEHR);
    }

    // Patient EHR buttons
    const loadPatientBtn = $('#smartLoadPatientBtn');
    if (loadPatientBtn) {
      loadPatientBtn.addEventListener('click', handleLoadPatientFromEHR);
    }

    const changePatientBtn = $('#smartChangePatientBtn');
    if (changePatientBtn) {
      changePatientBtn.addEventListener('click', handleChangePatient);
    }

    // Patient search input with debounce
    const ptNameInput = $('#ptName');
    if (ptNameInput && !ptNameInput._hasSearchListener) {
      ptNameInput._hasSearchListener = true;
      ptNameInput.addEventListener('input', debounce(() => {
        if (smartState.isConnected) {
          searchPatientsFromEHR(ptNameInput.value.trim());
        }
      }, 300));

      // Hide results when clicking outside
      document.addEventListener('click', (e) => {
        const results = $('#patientSearchResults');
        if (results && !ptNameInput.contains(e.target) && !results.contains(e.target)) {
          results.innerHTML = '';
          results.classList.remove('active');
        }
      });

      // Focus shows recent patients if connected
      ptNameInput.addEventListener('focus', () => {
        if (smartState.isConnected && !ptNameInput.value.trim()) {
          searchPatientsFromEHR('');
        }
      });

      // Blur event to check if patient exists when user finishes typing
      ptNameInput.addEventListener('blur', debounce(() => {
        if (smartState.isConnected && ptNameInput.value.trim()) {
          checkPatientExistsAndPrompt(ptNameInput.value.trim());
        }
      }, 500));

      // Input event to update clear button visibility
      ptNameInput.addEventListener('input', () => {
        updateSMARTUI(smartState.isConnected);
      });
    }

    // Clear patient button
    const clearPatientBtn = $('#clearPatientBtn');
    if (clearPatientBtn) {
      clearPatientBtn.addEventListener('click', handleClearPatient);
    }
  }

  /**
   * Handle SMART connect button click
   */
  async function handleSMARTConnect() {
    if (!window.SMARTAuth) {
      showToast('SMART on FHIR module not available', 'error');
      return;
    }

    const context = window.SMARTAuth.getContext();

    if (context.isAuthenticated) {
      // Already connected - offer to disconnect
      showConfirmToast(
        'Disconnect from EHR?',
        () => {
          window.SMARTAuth.logout();
          smartState.isConnected = false;
          smartState.practitioner = null;
          smartState.patient = null;
          updateSMARTUI(false);
          showToast('Disconnected from EHR', 'info');
        },
        () => {}
      );
    } else {
      // Start authorization flow
      showToast('Connecting to EHR...', 'info');
      try {
        await window.SMARTAuth.authorize();
        // Note: Page will redirect for OAuth flow
      } catch (error) {
        showToast('Failed to start EHR connection', 'error');
        console.error('[SMART] Authorization failed:', error);
      }
    }
  }

  /**
   * Handle successful SMART connection
   */
  async function handleSMARTConnected() {
    smartState.isConnected = true;
    updateSMARTUI(true);

    // Show EHR connected badge
    const contextInfo = $('#smartContextInfo');
    if (contextInfo) {
      contextInfo.removeAttribute('hidden');
    }

    // Automatically try to load practitioner info
    await handleSyncPractitioner();
  }

  /**
   * Handle sync practitioner button click
   */
  async function handleSyncPractitioner() {
    if (!window.SMARTAuth || !smartState.isConnected) {
      showToast('Not connected to EHR', 'error');
      return;
    }

    const syncBtn = $('#smartSyncPractitionerBtn');
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
        </svg>
        Loading...
      `;
    }

    try {
      const practitionerInfo = await window.SMARTAuth.loadPractitionerInfo();
      smartState.practitioner = practitionerInfo;

      // Populate form fields
      if (practitionerInfo.name) {
        const docNameEl = $('#docName');
        if (docNameEl && !docNameEl.value) {
          docNameEl.value = practitionerInfo.name;
        }
      }

      if (practitionerInfo.prcNumber) {
        const prcEl = $('#prc');
        if (prcEl && !prcEl.value) {
          prcEl.value = practitionerInfo.prcNumber;
        }
      }

      showToast(`Loaded practitioner: ${practitionerInfo.name}`, 'success');
    } catch (error) {
      console.error('[SMART] Failed to load practitioner:', error);
      showToast('Could not load practitioner from EHR', 'error');
    } finally {
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Load from EHR
        `;
      }
    }
  }

  /**
   * Handle submit prescription to EHR
   */
  async function handleSubmitToEHR() {
    if (!window.SMARTAuth || !smartState.isConnected) {
      showToast('Please connect to EHR first', 'error');
      return;
    }

    // Check if we have a patient selected (either from EHR or manually entered)
    const hasPatientId = window.SMARTAuth.getContext().patientId;
    const hasPatientName = $('#ptName')?.value?.trim();

    if (!hasPatientId && !hasPatientName) {
      showToast('Please enter patient information first', 'error');
      $('#ptName')?.focus();
      return;
    }

    // If connected to EHR but no patient ID linked, ask if they want to search
    if (!hasPatientId && hasPatientName && smartState.isConnected) {
      showConfirmToast(
        'Patient not linked to EHR. Search for patient in EHR?',
        () => {
          // User wants to search - trigger patient load
          handleLoadPatientFromEHR();
        },
        () => {
          // User wants to submit without linking - just confirm submission
          confirmAndSubmitToEHR();
        }
      );
      return;
    }

    await confirmAndSubmitToEHR();
  }

  /**
   * Confirm and submit prescription to EHR
   */
  async function confirmAndSubmitToEHR() {
    // Get prescription items
    const items = Array.from($('#rxItem s').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    if (items.length === 0) {
      showToast('No medications to submit', 'error');
      return;
    }

    // Get patient info for confirmation message
    const patientName = $('#ptName')?.value?.trim() || 'Unknown patient';

    // Confirm submission
    showConfirmToast(
      `Submit ${items.length} medication(s) for ${patientName}?`,
      async () => {
        const submitBtn = $('#submitToEHR');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <span class="btn-text">Submitting...</span>
          `;
        }

        try {
          // If there's a pending new patient, create them first
          if (smartState.newPatientPending) {
            showToast('Creating new patient...', 'info');

            const pending = smartState.newPatientPending;
            const ptSex = $('#ptSex')?.value?.toLowerCase() || '';

            // Build the Patient resource
            const newPatient = {
              resourceType: 'Patient',
              name: [{
                use: 'official',
                family: pending.familyName,
                given: [pending.givenName]
              }],
              ...(ptSex && ['male', 'female', 'other', 'unknown'].includes(ptSex) && { gender: ptSex })
            };

            // Create the patient in EHR
            const created = await window.SMARTAuth.createResource(newPatient);

            // Update SMART context with new patient
            window.SMARTAuth.setPatient(created.id);
            smartState.patient = { id: created.id, name: pending.fullName };
            smartState.newPatientPending = null;

            hidePatientManualStatus();
            updateSMARTUI(true);
            showToast('Patient created successfully', 'success');
          }

          // Submit as Bundle transaction
          const result = await window.SMARTAuth.submitPrescriptionBundle(items);

          // Count successful entries
          const successful = result.entry?.filter(e =>
            e.response?.status?.startsWith('2')
          ).length || 0;

          if (successful === items.length) {
            showToast(`Successfully submitted ${successful} medication(s) to EHR`, 'success');
          } else if (successful > 0) {
            showToast(`Submitted ${successful} of ${items.length} medications`, 'info');
          } else {
            showToast('Failed to submit medications', 'error');
          }
        } catch (error) {
          console.error('[SMART] Submit failed:', error);
          showToast('Failed to submit to EHR: ' + error.message, 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="12 8 12 12 15 15"/>
              </svg>
              <span class="btn-text">Submit to EHR</span>
            `;
          }
        }
      },
      () => {}
    );
  }

  /**
   * Handle load patient from EHR button click
   */
  async function handleLoadPatientFromEHR() {
    if (!window.SMARTAuth || !smartState.isConnected) {
      showToast('Not connected to EHR', 'error');
      return;
    }

    // Focus the patient name input which triggers the search dropdown
    const ptNameInput = $('#ptName');
    if (ptNameInput) {
      ptNameInput.focus();
      // Trigger initial search
      searchPatientsFromEHR('');
    }
  }

  /**
   * Handle change patient button click
   */
  async function handleChangePatient() {
    // Clear current patient
    smartState.patient = null;
    window.SMARTAuth.setPatient(null);

    // Clear patient form fields
    const ptName = $('#ptName');
    const ptAge = $('#ptAge');
    const ptSex = $('#ptSex');
    const ptAddr = $('#ptAddr');

    if (ptName) ptName.value = '';
    if (ptAge) ptAge.value = '';
    if (ptSex) ptSex.value = '';
    if (ptAddr) ptAddr.value = '';

    updateSMARTUI(true);
    showToast('Patient cleared. Enter new patient name to search.', 'info');

    // Focus the name input
    if (ptName) ptName.focus();
  }

  /**
   * Handle clear patient button click - clears all patient details
   */
  function handleClearPatient() {
    // Clear SMART state
    smartState.patient = null;
    smartState.manualPatient = null;
    smartState.newPatientPending = null;

    // Clear patient from SMART Auth if connected
    if (window.SMARTAuth) {
      window.SMARTAuth.setPatient(null);
    }

    // Clear patient form fields
    const ptName = $('#ptName');
    const ptAge = $('#ptAge');
    const ptSex = $('#ptSex');
    const ptAddr = $('#ptAddr');

    if (ptName) ptName.value = '';
    if (ptAge) ptAge.value = '';
    if (ptSex) ptSex.value = '';
    if (ptAddr) ptAddr.value = '';

    // Hide any status indicators
    hidePatientManualStatus();

    updateSMARTUI(true);
    showToast('Patient details cleared', 'info');

    // Focus the name input
    if (ptName) ptName.focus();
  }

  /**
   * Check if patient exists in EHR and prompt user if not found
   * Called when user finishes typing patient name
   */
  async function checkPatientExistsAndPrompt(patientName) {
    if (!window.SMARTAuth || !smartState.isConnected) return;
    if (!patientName || patientName.length < 2) return;

    // Don't check if we already have this patient selected
    if (smartState.patient && smartState.patient.name === patientName) return;

    try {
      // Search for exact match
      const result = await window.SMARTAuth.searchPatients(patientName);
      const patients = result.entry?.map(e => e.resource) || [];

      // Check for exact name match
      const exactMatch = patients.find(p => {
        const pName = formatPatientName(p.name);
        return pName.toLowerCase() === patientName.toLowerCase();
      });

      if (exactMatch) {
        // Patient exists - ask if user wants to link to existing or create new
        promptPatientExists(exactMatch, patientName);
      } else if (patients.length > 0) {
        // Similar patients found - show options
        promptSimilarPatients(patients, patientName);
      } else {
        // No patients found - ask to create new
        promptCreateNewPatient(patientName);
      }
    } catch (error) {
      console.error('[SMART] Patient check failed:', error);
    }
  }

  /**
   * Prompt user when exact patient match exists
   */
  function promptPatientExists(existingPatient, enteredName) {
    const pName = formatPatientName(existingPatient.name);
    const age = calculateAge(existingPatient.birthDate);
    const ageText = age !== null ? `${age} yrs` : 'Age unknown';
    const gender = existingPatient.gender || 'unknown';

    showPatientManualStatus(
      `A patient named "${pName}" already exists (${gender}, ${ageText}).`,
      [
        { label: 'Use Existing', action: () => linkToExistingPatient(existingPatient), primary: true },
        { label: 'Create New', action: () => showCreatePatientWithName(enteredName) },
        { label: 'Clear', action: () => handleClearPatient() }
      ]
    );
  }

  /**
   * Prompt user when similar patients are found
   */
  function promptSimilarPatients(similarPatients, enteredName) {
    const topMatches = similarPatients.slice(0, 3);
    const matchNames = topMatches.map(p => formatPatientName(p.name)).join(', ');

    showPatientManualStatus(
      `Similar patients found: ${matchNames}. Select one or create new?`,
      [
        { label: 'View Matches', action: () => showPatientPickerForSelection(similarPatients, enteredName) },
        { label: 'Create New', action: () => showCreatePatientWithName(enteredName) },
        { label: 'Clear', action: () => handleClearPatient() }
      ]
    );
  }

  /**
   * Mark patient as new (to be created on submit) when no matches found
   */
  function promptCreateNewPatient(patientName) {
    // Parse name into parts
    const nameParts = patientName.trim().split(/\s+/);
    const givenName = nameParts[0] || '';
    const familyName = nameParts.slice(1).join(' ') || '';

    // Store as pending new patient
    smartState.newPatientPending = {
      givenName,
      familyName,
      fullName: patientName.trim()
    };

    // Show status indicator that this is a new patient
    showPatientManualStatus(
      `New patient: "${patientName}" will be created when you submit.`,
      [
        { label: 'Edit Details', action: () => { $('#ptName')?.focus(); }, primary: true },
        { label: 'Clear', action: () => handleClearPatient() }
      ]
    );

    // Add visual indicator to the card
    updateSMARTUI(true);
  }

  /**
   * Show patient manual status with action buttons
   */
  function showPatientManualStatus(message, actions) {
    const statusEl = $('#patientManualStatus');
    if (!statusEl) return;

    const buttonsHtml = actions.map(btn => `
      <button class="btn ${btn.primary ? 'btn-primary' : 'btn-secondary'} btn-sm" data-action="${actions.indexOf(btn)}">
        ${btn.label}
      </button>
    `).join('');

    statusEl.innerHTML = `
      <div class="patient-manual-status unlinked">
        <span class="status-text">${message}</span>
        <div class="status-actions">
          ${buttonsHtml}
        </div>
      </div>
    `;

    statusEl.hidden = false;

    // Add click handlers
    statusEl.querySelectorAll('button[data-action]').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        actions[idx].action();
      });
    });
  }

  /**
   * Hide patient manual status
   */
  function hidePatientManualStatus() {
    const statusEl = $('#patientManualStatus');
    if (statusEl) {
      statusEl.hidden = true;
      statusEl.innerHTML = '';
    }
  }

  /**
   * Link form to existing patient
   */
  function linkToExistingPatient(patient) {
    const patientId = patient.id;
    const patientName = formatPatientName(patient.name);
    const patientGender = patient.gender || '';
    const patientBirthDate = patient.birthDate || '';

    // Set patient in SMART state
    window.SMARTAuth.setPatient(patientId);
    smartState.patient = { id: patientId, name: patientName };
    smartState.manualPatient = null;
    smartState.newPatientPending = null;

    // Update form fields
    const ptName = $('#ptName');
    const ptAge = $('#ptAge');
    const ptSex = $('#ptSex');

    if (ptName) ptName.value = patientName;
    if (ptAge && patientBirthDate) ptAge.value = calculateAge(patientBirthDate) || '';
    if (ptSex && patientGender) {
      ptSex.value = patientGender.charAt(0).toUpperCase() + patientGender.slice(1);
    }

    hidePatientManualStatus();
    updateSMARTUI(true);
    showToast(`Linked to existing patient: ${patientName}`, 'success');
  }

  /**
   * Show create patient dialog pre-filled with name
   */
  function showCreatePatientWithName(patientName) {
    // Parse name into parts (simple parsing)
    const nameParts = patientName.trim().split(/\s+/);
    const givenName = nameParts[0] || '';
    const familyName = nameParts.slice(1).join(' ') || '';

    // Pre-fill and show the create dialog
    showCreatePatientDialogInlineWithData(givenName, familyName);
  }

  /**
   * Show create patient dialog with pre-filled data
   */
  function showCreatePatientDialogInlineWithData(givenName, familyName) {
    const modal = document.createElement('div');
    modal.className = 'smart-modal';
    modal.id = 'createPatientModal';
    modal.innerHTML = `
      <div class="smart-modal-content">
        <div class="smart-modal-header">
          <h3>Create New Patient</h3>
          <button class="smart-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="smart-modal-body">
          <p class="modal-hint">Creating patient: <strong>${givenName} ${familyName}</strong></p>
          <div class="form-group">
            <label for="newPatientFamilyName">Last Name *</label>
            <input type="text" id="newPatientFamilyName" class="form-input" placeholder="e.g., Doe" value="${familyName}">
          </div>
          <div class="form-group">
            <label for="newPatientGivenName">First Name *</label>
            <input type="text" id="newPatientGivenName" class="form-input" placeholder="e.g., John" value="${givenName}">
          </div>
          <div class="form-group">
            <label for="newPatientBirthDate">Birth Date</label>
            <input type="date" id="newPatientBirthDate" class="form-input">
          </div>
          <div class="form-group">
            <label for="newPatientGender">Gender</label>
            <select id="newPatientGender" class="form-input">
              <option value="">-- Select --</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div class="smart-modal-actions">
            <button id="savePatientBtn" class="btn btn-primary">Create Patient</button>
            <button id="cancelCreatePatientBtn" class="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.smart-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cancelCreatePatientBtn').addEventListener('click', () => modal.remove());

    modal.querySelector('#savePatientBtn').addEventListener('click', async () => {
      const familyName = $('#newPatientFamilyName').value.trim();
      const givenName = $('#newPatientGivenName').value.trim();
      const birthDate = $('#newPatientBirthDate').value;
      const gender = $('#newPatientGender').value;

      if (!familyName || !givenName) {
        showToast('Please enter first and last name', 'error');
        return;
      }

      try {
        const newPatient = {
          resourceType: 'Patient',
          name: [{
            use: 'official',
            family: familyName,
            given: [givenName]
          }],
          ...(birthDate && { birthDate }),
          ...(gender && { gender })
        };

        const created = await window.SMARTAuth.createResource(newPatient);

        window.SMARTAuth.setPatient(created.id);
        smartState.patient = { id: created.id, name: `${givenName} ${familyName}` };
        smartState.manualPatient = null;

        // Update form fields
        const ptName = $('#ptName');
        const ptAge = $('#ptAge');
        const ptSex = $('#ptSex');

        if (ptName) ptName.value = `${givenName} ${familyName}`;
        if (ptAge && birthDate) ptAge.value = calculateAge(birthDate) || '';
        if (ptSex && gender) {
          ptSex.value = gender.charAt(0).toUpperCase() + gender.slice(1);
        }

        hidePatientManualStatus();
        updateSMARTUI(true);
        modal.remove();
        showToast('Patient created and selected', 'success');
      } catch (error) {
        console.error('[SMART] Failed to create patient:', error);
        showToast('Failed to create patient: ' + error.message, 'error');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Show patient picker for selecting from similar matches
   */
  function showPatientPickerForSelection(patients, enteredName) {
    const modal = document.createElement('div');
    modal.className = 'smart-modal';
    modal.id = 'patientPickerModal';

    const listHtml = patients.map(patient => {
      const name = formatPatientName(patient.name);
      const age = calculateAge(patient.birthDate);
      const ageText = age !== null ? `${age} yrs` : 'Age unknown';
      const gender = patient.gender || 'unknown';
      const genderIcon = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '○';

      return `
        <div class="patient-picker-item" data-patient-id="${patient.id}">
          <div class="patient-picker-item-info">
            <div class="patient-picker-item-name">${name}</div>
            <div class="patient-picker-item-details">
              <span class="patient-gender">${genderIcon} ${gender}</span>
              <span class="patient-age">${ageText}</span>
              ${patient.birthDate ? `<span class="patient-birthdate">(${patient.birthDate})</span>` : ''}
            </div>
          </div>
          <button class="btn btn-primary btn-sm select-patient-btn">Select</button>
        </div>
      `;
    }).join('');

    modal.innerHTML = `
      <div class="smart-modal-content">
        <div class="smart-modal-header">
          <h3>Select Matching Patient</h3>
          <button class="smart-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="smart-modal-body">
          <p class="modal-hint">You entered: <strong>${enteredName}</strong></p>
          <p>Select an existing patient or create a new one:</p>
          <div class="patient-picker-list">
            ${listHtml}
          </div>
          <div class="smart-modal-actions">
            <button id="createNewFromPickerBtn" class="btn btn-secondary">Create New Patient</button>
            <button id="cancelPickerBtn" class="btn btn-ghost">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    modal.querySelector('.smart-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cancelPickerBtn').addEventListener('click', () => modal.remove());

    // Create new button
    modal.querySelector('#createNewFromPickerBtn').addEventListener('click', () => {
      modal.remove();
      showCreatePatientWithName(enteredName);
    });

    // Select patient buttons
    modal.querySelectorAll('.select-patient-btn').forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        linkToExistingPatient(patients[idx]);
        modal.remove();
      });
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Search patients from EHR and display in dropdown
   */
  async function searchPatientsFromEHR(searchText) {
    const resultsContainer = $('#patientSearchResults');
    if (!resultsContainer) return;

    if (!smartState.isConnected) {
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('active');
      return;
    }

    // Show loading
    resultsContainer.innerHTML = '<div class="patient-search-loading">Searching...</div>';
    resultsContainer.classList.add('active');

    try {
      const result = await window.SMARTAuth.searchPatients(searchText);
      displayPatientSearchResults(result, searchText);
    } catch (error) {
      console.error('[SMART] Patient search failed:', error);
      resultsContainer.innerHTML = '<div class="patient-search-error">Search failed. Try again.</div>';
    }
  }

  /**
   * Display patient search results in dropdown
   */
  function displayPatientSearchResults(bundle, searchText) {
    const resultsContainer = $('#patientSearchResults');
    if (!resultsContainer) return;

    const patients = bundle.entry?.map(e => e.resource) || [];

    if (patients.length === 0) {
      resultsContainer.innerHTML = `
        <div class="patient-search-empty">
          <p>No patients found${searchText ? ` for "${searchText}"` : ''}</p>
          <button id="createPatientFromSearchBtn" class="btn btn-primary btn-sm">Create New Patient</button>
        </div>
      `;
      resultsContainer.querySelector('#createPatientFromSearchBtn')?.addEventListener('click', () => {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.remove('active');
        showCreatePatientDialogInline();
      });
      return;
    }

    const listHtml = patients.map(patient => {
      const name = formatPatientName(patient.name);
      const age = calculateAge(patient.birthDate);
      const ageText = age !== null ? `${age} yrs` : 'Age unknown';
      const gender = patient.gender || 'unknown';
      const genderIcon = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '○';

      return `
        <div class="patient-search-item" data-patient-id="${patient.id}" data-patient-name="${name}" data-patient-gender="${gender}" data-patient-birthdate="${patient.birthDate || ''}">
          <div class="patient-search-item-info">
            <div class="patient-search-item-name">${name}</div>
            <div class="patient-search-item-details">
              <span class="patient-gender">${genderIcon} ${gender}</span>
              <span class="patient-age">${ageText}</span>
              ${patient.birthDate ? `<span class="patient-birthdate">(${patient.birthDate})</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    resultsContainer.innerHTML = `
      <div class="patient-search-list">
        ${listHtml}
        <div class="patient-search-footer">
          <button id="createPatientFromListBtn" class="btn btn-secondary btn-sm">+ Create New Patient</button>
        </div>
      </div>
    `;

    // Add click handlers for patient items
    resultsContainer.querySelectorAll('.patient-search-item').forEach(item => {
      item.addEventListener('click', () => {
        const patientId = item.dataset.patientId;
        const patientName = item.dataset.patientName;
        const patientGender = item.dataset.patientGender;
        const patientBirthDate = item.dataset.patientBirthdate;

        // Set patient in SMART state
        window.SMARTAuth.setPatient(patientId);
        smartState.patient = { id: patientId, name: patientName };

        // Update form fields
        const ptName = $('#ptName');
        const ptAge = $('#ptAge');
        const ptSex = $('#ptSex');

        if (ptName) ptName.value = patientName;
        if (ptAge && patientBirthDate) ptAge.value = calculateAge(patientBirthDate) || '';
        if (ptSex && patientGender) {
          ptSex.value = patientGender.charAt(0).toUpperCase() + patientGender.slice(1);
        }

        // Hide results
        resultsContainer.innerHTML = '';
        resultsContainer.classList.remove('active');

        // Hide any manual status indicators
        hidePatientManualStatus();

        // Update UI
        updateSMARTUI(true);
        showToast(`Patient ${patientName} selected from EHR`, 'success');
      });
    });

    // Create patient button
    resultsContainer.querySelector('#createPatientFromListBtn')?.addEventListener('click', () => {
      resultsContainer.innerHTML = '';
      resultsContainer.classList.remove('active');
      showCreatePatientDialogInline();
    });
  }

  /**
   * Show create patient dialog inline (near the patient field)
   */
  function showCreatePatientDialogInline() {
    const modal = document.createElement('div');
    modal.className = 'smart-modal';
    modal.id = 'createPatientModal';
    modal.innerHTML = `
      <div class="smart-modal-content">
        <div class="smart-modal-header">
          <h3>Create New Patient</h3>
          <button class="smart-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="smart-modal-body">
          <div class="form-group">
            <label for="newPatientFamilyName">Last Name *</label>
            <input type="text" id="newPatientFamilyName" class="form-input" placeholder="e.g., Doe">
          </div>
          <div class="form-group">
            <label for="newPatientGivenName">First Name *</label>
            <input type="text" id="newPatientGivenName" class="form-input" placeholder="e.g., John">
          </div>
          <div class="form-group">
            <label for="newPatientBirthDate">Birth Date</label>
            <input type="date" id="newPatientBirthDate" class="form-input">
          </div>
          <div class="form-group">
            <label for="newPatientGender">Gender</label>
            <select id="newPatientGender" class="form-input">
              <option value="">-- Select --</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div class="smart-modal-actions">
            <button id="savePatientBtn" class="btn btn-primary">Create Patient</button>
            <button id="cancelCreatePatientBtn" class="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('.smart-modal-close').addEventListener('click', () => modal.remove());
    modal.querySelector('#cancelCreatePatientBtn').addEventListener('click', () => modal.remove());

    modal.querySelector('#savePatientBtn').addEventListener('click', async () => {
      const familyName = $('#newPatientFamilyName').value.trim();
      const givenName = $('#newPatientGivenName').value.trim();
      const birthDate = $('#newPatientBirthDate').value;
      const gender = $('#newPatientGender').value;

      if (!familyName || !givenName) {
        showToast('Please enter first and last name', 'error');
        return;
      }

      try {
        const newPatient = {
          resourceType: 'Patient',
          name: [{
            use: 'official',
            family: familyName,
            given: [givenName]
          }],
          ...(birthDate && { birthDate }),
          ...(gender && { gender })
        };

        const created = await window.SMARTAuth.createResource(newPatient);

        window.SMARTAuth.setPatient(created.id);
        smartState.patient = { id: created.id, name: `${givenName} ${familyName}` };

        // Update form fields
        const ptName = $('#ptName');
        const ptAge = $('#ptAge');
        const ptSex = $('#ptSex');

        if (ptName) ptName.value = `${givenName} ${familyName}`;
        if (ptAge && birthDate) ptAge.value = calculateAge(birthDate) || '';
        if (ptSex && gender) {
          ptSex.value = gender.charAt(0).toUpperCase() + gender.slice(1);
        }

        updateSMARTUI(true);
        modal.remove();
        showToast('Patient created and selected', 'success');
      } catch (error) {
        console.error('[SMART] Failed to create patient:', error);
        showToast('Failed to create patient: ' + error.message, 'error');
      }
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  /**
   * Show patient selection dialog with search and create options
   */
  function showPatientSelectionDialog() {
    // Create modal for patient selection
    const modal = document.createElement('div');
    modal.className = 'smart-modal';
    modal.id = 'patientPickerModal';
    modal.innerHTML = `
      <div class="smart-modal-content">
        <div class="smart-modal-header">
          <h3>Select Patient</h3>
          <button class="smart-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="smart-modal-body">
          <p>Search for an existing patient or create a new one.</p>
          <div class="patient-search-section">
            <div class="form-group">
              <label for="patientSearchInput">Search Patients</label>
              <div class="search-input-wrapper">
                <input type="text" id="patientSearchInput" class="form-input" placeholder="Enter name to search...">
                <button id="searchPatientsBtn" class="btn btn-primary">Search</button>
              </div>
            </div>
          </div>
          <div id="patientsListContainer" class="patients-list-container">
            <div class="patients-loading">Loading patients...</div>
          </div>
          <div class="smart-modal-actions">
            <button id="createPatientBtn" class="btn btn-secondary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              Create New Patient
            </button>
            <button id="cancelPatientBtn" class="btn btn-secondary">Cancel</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    modal.querySelector('.smart-modal-close').addEventListener('click', () => {
      modal.remove();
    });

    // Cancel button
    modal.querySelector('#cancelPatientBtn').addEventListener('click', () => {
      modal.remove();
    });

    // Search button
    modal.querySelector('#searchPatientsBtn').addEventListener('click', () => {
      searchAndDisplayPatients();
    });

    // Enter key in search input
    modal.querySelector('#patientSearchInput').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        searchAndDisplayPatients();
      }
    });

    // Create new patient button
    modal.querySelector('#createPatientBtn').addEventListener('click', () => {
      showCreatePatientDialog(modal);
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });

    // Load initial patient list
    loadInitialPatients();
  }

  /**
   * Calculate age from birthdate
   */
  function calculateAge(birthDate) {
    if (!birthDate) return null;
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  /**
   * Format patient name
   */
  function formatPatientName(name) {
    if (!name || !name.length) return 'Unknown';
    const official = name.find(n => n.use === 'official') || name[0];
    const given = official.given ? official.given.join(' ') : '';
    const family = official.family || '';
    return [given, family].filter(Boolean).join(' ');
  }

  /**
   * Load initial patient list
   */
  async function loadInitialPatients() {
    const container = $('#patientsListContainer');
    if (!container) return;

    container.innerHTML = '<div class="patients-loading">Loading patients...</div>';

    try {
      const result = await window.SMARTAuth.searchPatients('');
      displayPatients(result);
    } catch (error) {
      console.error('[SMART] Failed to load patients:', error);
      container.innerHTML = '<div class="patients-error">Failed to load patients. Please try searching.</div>';
    }
  }

  /**
   * Search and display patients
   */
  async function searchAndDisplayPatients() {
    const searchInput = $('#patientSearchInput');
    const container = $('#patientsListContainer');
    const searchText = searchInput.value.trim();

    container.innerHTML = '<div class="patients-loading">Searching...</div>';

    try {
      const result = await window.SMARTAuth.searchPatients(searchText);
      displayPatients(result);
    } catch (error) {
      console.error('[SMART] Search failed:', error);
      container.innerHTML = '<div class="patients-error">Search failed. Please try again.</div>';
    }
  }

  /**
   * Display patients in the list
   */
  function displayPatients(bundle) {
    const container = $('#patientsListContainer');
    if (!container) return;

    const patients = bundle.entry?.map(e => e.resource) || [];

    if (patients.length === 0) {
      container.innerHTML = `
        <div class="patients-empty">
          <p>No patients found.</p>
          <button id="createPatientFromEmptyBtn" class="btn btn-primary btn-sm">Create New Patient</button>
        </div>
      `;
      container.querySelector('#createPatientFromEmptyBtn')?.addEventListener('click', () => {
        showCreatePatientDialog($('#patientPickerModal'));
      });
      return;
    }

    const listHtml = patients.map(patient => {
      const name = formatPatientName(patient.name);
      const age = calculateAge(patient.birthDate);
      const ageText = age !== null ? `${age} yrs` : 'Age unknown';
      const gender = patient.gender || 'unknown';
      const genderIcon = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '○';

      return `
        <div class="patient-list-item" data-patient-id="${patient.id}">
          <div class="patient-info">
            <div class="patient-name">${name}</div>
            <div class="patient-details">
              <span class="patient-gender">${genderIcon} ${gender}</span>
              <span class="patient-age">${ageText}</span>
              ${patient.birthDate ? `<span class="patient-birthdate">(${patient.birthDate})</span>` : ''}
            </div>
          </div>
          <button class="btn btn-primary btn-sm select-patient-btn">Select</button>
        </div>
      `;
    }).join('');

    container.innerHTML = `<div class="patients-list">${listHtml}</div>`;

    // Add click handlers for select buttons
    container.querySelectorAll('.select-patient-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const item = e.target.closest('.patient-list-item');
        const patientId = item.dataset.patientId;

        // Set the patient ID
        window.SMARTAuth.setPatient(patientId);
        smartState.patient = { id: patientId };

        // Update UI to show patient context
        updatePatientContextUI(patientId);

        $('#patientPickerModal').remove();
        showToast('Patient selected', 'success');

        // Now proceed with submission
        await submitPrescriptionToEHR();
      });
    });
  }

  /**
   * Show create patient dialog
   */
  function showCreatePatientDialog(parentModal) {
    // Hide parent modal temporarily
    parentModal.style.display = 'none';

    const modal = document.createElement('div');
    modal.className = 'smart-modal';
    modal.id = 'createPatientModal';
    modal.innerHTML = `
      <div class="smart-modal-content">
        <div class="smart-modal-header">
          <h3>Create New Patient</h3>
          <button class="smart-modal-close" aria-label="Close">&times;</button>
        </div>
        <div class="smart-modal-body">
          <div class="form-group">
            <label for="newPatientFamilyName">Last Name *</label>
            <input type="text" id="newPatientFamilyName" class="form-input" placeholder="e.g., Doe">
          </div>
          <div class="form-group">
            <label for="newPatientGivenName">First Name *</label>
            <input type="text" id="newPatientGivenName" class="form-input" placeholder="e.g., John">
          </div>
          <div class="form-group">
            <label for="newPatientBirthDate">Birth Date</label>
            <input type="date" id="newPatientBirthDate" class="form-input">
          </div>
          <div class="form-group">
            <label for="newPatientGender">Gender</label>
            <select id="newPatientGender" class="form-input">
              <option value="">-- Select --</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="unknown">Unknown</option>
            </select>
          </div>
          <div class="smart-modal-actions">
            <button id="savePatientBtn" class="btn btn-primary">Create Patient</button>
            <button id="cancelCreatePatientBtn" class="btn btn-secondary">Back</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button
    modal.querySelector('.smart-modal-close').addEventListener('click', () => {
      modal.remove();
      parentModal.style.display = 'flex';
    });

    // Cancel button
    modal.querySelector('#cancelCreatePatientBtn').addEventListener('click', () => {
      modal.remove();
      parentModal.style.display = 'flex';
    });

    // Save button
    modal.querySelector('#savePatientBtn').addEventListener('click', async () => {
      const familyName = $('#newPatientFamilyName').value.trim();
      const givenName = $('#newPatientGivenName').value.trim();
      const birthDate = $('#newPatientBirthDate').value;
      const gender = $('#newPatientGender').value;

      if (!familyName || !givenName) {
        showToast('Please enter first and last name', 'error');
        return;
      }

      try {
        const newPatient = {
          resourceType: 'Patient',
          name: [{
            use: 'official',
            family: familyName,
            given: [givenName]
          }],
          ...(birthDate && { birthDate }),
          ...(gender && { gender })
        };

        const created = await window.SMARTAuth.createResource(newPatient);

        // Set the new patient ID
        window.SMARTAuth.setPatient(created.id);
        smartState.patient = { id: created.id, name: `${givenName} ${familyName}` };

        // Update UI to show patient context
        updatePatientContextUI(created.id);

        modal.remove();
        parentModal.remove();
        showToast('Patient created and selected', 'success');

        // Now proceed with submission
        await submitPrescriptionToEHR();
      } catch (error) {
        console.error('[SMART] Failed to create patient:', error);
        showToast('Failed to create patient: ' + error.message, 'error');
      }
    });

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
        parentModal.style.display = 'flex';
      }
    });
  }

  /**
   * Update UI to show patient context (without showing ID)
   */
  function updatePatientContextUI(patientId) {
    // Just show EHR connected badge - patient ID is not displayed
    const contextInfo = $('#smartContextInfo');
    if (contextInfo) {
      contextInfo.removeAttribute('hidden');
    }
  }

  /**
   * Submit prescription to EHR
   */
  async function submitPrescriptionToEHR() {
    // Get prescription items
    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    if (items.length === 0) {
      showToast('No medications to submit', 'error');
      return;
    }

    // Confirm submission
    showConfirmToast(
      `Submit ${items.length} medication(s) to EHR?`,
      async () => {
        const submitBtn = $('#submitToEHR');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
            <span class="btn-text">Submitting...</span>
          `;
        }

        try {
          // Submit as Bundle transaction
          const result = await window.SMARTAuth.submitPrescriptionBundle(items);

          // Count successful entries
          const successful = result.entry?.filter(e =>
            e.response?.status?.startsWith('2')
          ).length || 0;

          if (successful === items.length) {
            showToast(`Successfully submitted ${successful} medication(s) to EHR`, 'success');
          } else if (successful > 0) {
            showToast(`Submitted ${successful} of ${items.length} medications`, 'info');
          } else {
            showToast('Failed to submit medications', 'error');
          }
        } catch (error) {
          console.error('[SMART] Submit failed:', error);
          showToast('Failed to submit to EHR: ' + error.message, 'error');
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="12 8 12 12 15 15"/>
              </svg>
              <span class="btn-text">Submit to EHR</span>
            `;
          }
        }
      },
      () => {}
    );
  }

  /**
   * Update SMART UI based on connection state
   */
  function updateSMARTUI(isConnected) {
    const badge = $('#smartStatusBadge');
    const connectBtn = $('#smartConnectBtn');
    const connectText = $('#smartConnectText');
    const syncBtn = $('#smartSyncPractitionerBtn');
    const submitBtn = $('#submitToEHR');
    const loadPatientBtn = $('#smartLoadPatientBtn');
    const changePatientBtn = $('#smartChangePatientBtn');

    if (badge) {
      if (isConnected) {
        badge.className = 'status-badge smart-connected';
        badge.textContent = 'EHR Connected';
        badge.title = 'SMART on FHIR: Connected';
      } else {
        badge.className = 'status-badge smart-disconnected';
        badge.textContent = 'EHR';
        badge.title = 'SMART on FHIR: Disconnected';
      }
    }

    if (connectBtn && connectText) {
      if (isConnected) {
        connectText.textContent = 'Disconnect';
        connectBtn.title = 'Disconnect from EHR';
      } else {
        connectText.textContent = 'Connect EHR';
        connectBtn.title = 'Connect to EHR via SMART on FHIR';
      }
    }

    if (syncBtn) {
      syncBtn.hidden = !isConnected;
    }

    if (submitBtn) {
      submitBtn.hidden = !isConnected;
    }

    // Patient buttons
    if (loadPatientBtn) {
      loadPatientBtn.hidden = !isConnected || smartState.patient;
    }
    if (changePatientBtn) {
      changePatientBtn.hidden = !isConnected || !smartState.patient;
    }

    // Clear patient button - show when there's patient data (EHR linked or manual entry)
    const clearPatientBtn = $('#clearPatientBtn');
    const ptName = $('#ptName');
    const hasPatientData = smartState.patient || (ptName && ptName.value.trim());
    if (clearPatientBtn) {
      clearPatientBtn.hidden = !hasPatientData;
    }

    // Update patient EHR status indicator
    updatePatientEhrStatus();
  }

  /**
   * Update patient EHR status indicator
   */
  function updatePatientEhrStatus() {
    const statusEl = $('#patientEhrStatus');
    if (!statusEl) return;

    if (smartState.patient) {
      statusEl.hidden = false;
      statusEl.innerHTML = `
        <span class="ehr-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M20 6L9 17l-5-5"/>
          </svg>
          Linked to EHR
        </span>
      `;
    } else if (smartState.newPatientPending) {
      // Show new patient indicator
      statusEl.hidden = false;
      statusEl.innerHTML = `
        <span class="ehr-badge new-patient">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          New Patient (will be created)
        </span>
      `;
    } else {
      statusEl.hidden = true;
      statusEl.innerHTML = '';
    }
  }

  // Add CSS animation for loading spinner
  const style = document.createElement('style');
  style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);

  // ==================== Override init to include SMART ====================

  const originalInit = init;
  init = async function() {
    await originalInit();
    await initSMARTIntegration();
  };

  // Start the app
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

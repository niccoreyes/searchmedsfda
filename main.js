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
    onlyHuman: false,
    pageRows: [],
    quickIndex: [],
    isDataLoaded: false,
    rxItemCount: 0
  };

  // DOM helpers
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ==================== Toast Notifications ====================

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

  // ==================== CSV Loading ====================

  function initCSVLoading() {
    const fileInput = $('#fileInput');
    const btnPick = $('#btnPick');
    const btnReload = $('#btnReload');
    const dropOverlay = $('#dropOverlay');

    // Button click handlers
    btnPick?.addEventListener('click', () => fileInput?.click());
    btnReload?.addEventListener('click', tryAutoLoad);

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

    // Try auto-load on init
    setTimeout(tryAutoLoad, 500);
  }

  function setStatus(text, type = 'loading') {
    const statusEl = $('#loadStatus');
    if (!statusEl) return;

    statusEl.textContent = text;
    statusEl.className = `status-badge ${type}`;
  }

  function tryAutoLoad() {
    setStatus('Loading...', 'loading');

    fetch('ALL_DrugProducts.csv')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        parseAndLoadCSV(text);
      })
      .catch(() => {
        setStatus('Load failed', 'error');
        showUploadUI();
      });
  }

  function readFile(file) {
    setStatus('Reading...', 'loading');

    const reader = new FileReader();
    reader.onload = () => {
      parseAndLoadCSV(reader.result, file.name);
      showToast(`Loaded ${file.name}`, 'success');
    };
    reader.onerror = () => {
      setStatus('Read failed', 'error');
      showToast('Failed to read file', 'error');
    };
    reader.readAsText(file);
  }

  function parseAndLoadCSV(text) {
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

    setStatus(`${data.length.toLocaleString()} records`, 'loaded');
    $('#summary').textContent = `${data.length.toLocaleString()} drugs`;

    // Try to extract update date from CSV
    const m = text.match(/Updated\s+as\s+of\s+([^\r\n]+)/i);
    state.lastUpdatedText = m ? m[1].trim() : '—';
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
      state.onlyHuman = false;
      onlyRX.checked = false;
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

      if (gen.includes('veterinary') || cls.includes('veterinary') || brand.includes('vet')) {
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

    // Update UI
    const listEl = $('#resultsList');
    const emptyEl = $('#emptyState');

    if (state.pageRows.length === 0) {
      listEl.innerHTML = '';
      emptyEl.style.display = 'block';
    } else {
      emptyEl.style.display = 'none';
      listEl.innerHTML = state.pageRows.map((r, idx) => drugCardHTML(r, idx)).join('');

      // Wire up add buttons
      $$('.drug-card').forEach((card) => {
        card.addEventListener('click', (e) => {
          // Don't trigger if clicking the button directly
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
    const expiry = (r['Expiry Date'] || '').split(' ')[0];

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
    const expiry = (r['Expiry Date'] || '').split(' ')[0];

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
        <input class="rx-duration small" placeholder="Duration">
        <input class="rx-refills small" placeholder="Refills">
      </div>
      <div class="rx-item-body">
        <input class="rx-notes" placeholder="Special instructions (optional)">
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
    });

    div.querySelector('.duplicate').addEventListener('click', () => {
      const vals = collectItem(div);
      addRxItem(vals);
    });

    div.querySelector('.move-up').addEventListener('click', () => {
      if (div.previousElementSibling) {
        div.parentNode.insertBefore(div, div.previousElementSibling);
        renumberItems();
      }
    });

    div.querySelector('.move-down').addEventListener('click', () => {
      if (div.nextElementSibling) {
        div.parentNode.insertBefore(div.nextElementSibling, div);
        renumberItems();
      }
    });

    // Focus first field
    div.querySelector('.rx-generic').focus();

    // Scroll to item on mobile
    if (window.innerWidth < 640) {
      div.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
      sig: div.querySelector('.rx-sig')?.value.trim() || '',
      duration: div.querySelector('.rx-duration')?.value.trim() || '',
      refills: div.querySelector('.rx-refills')?.value.trim() || '',
      notes: div.querySelector('.rx-notes')?.value.trim() || ''
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
    $('#pDoc').textContent = fields.docName?.value || '';
    $('#pDoc2').textContent = fields.docName?.value || '';
    $('#pPRC').textContent = fields.prc?.value || '';
    $('#pPTR').textContent = fields.ptr?.value || '';
    $('#pS2').textContent = fields.s2?.value || '';

    const ol = $('#pItems');
    ol.innerHTML = '';

    const items = Array.from($('#rxItems').children)
      .filter((child) => child.classList.contains('rx-item'))
      .map((div) => collectItem(div));

    for (const it of items) {
      let displayName = '';
      if (it.genericName && it.brandName) {
        displayName = `${it.genericName} — ${it.brandName}`;
      } else if (it.genericName) {
        displayName = it.genericName;
      }

      const line = [
        [displayName, it.strength].filter(Boolean).join(', '),
        it.form,
        it.sig,
        it.duration ? `for ${it.duration}` : '',
        it.qty ? `Qty: ${it.qty}` : '',
        it.refills ? `Refills: ${it.refills}` : ''
      ]
        .filter(Boolean)
        .join(' • ');

      const li = document.createElement('li');
      li.textContent = line;
      ol.appendChild(li);

      if (it.notes) {
        const n = document.createElement('div');
        n.className = 'print-note';
        n.textContent = '— ' + it.notes;
        n.style.cssText = 'margin-left: 20px; font-style: italic; color: #666;';
        ol.appendChild(n);
      }
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

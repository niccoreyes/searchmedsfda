(function(){
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
    pageRows: []
  };

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Tabs
  $$('.tab').forEach(t => t.addEventListener('click', () => {
    $$('.tab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const target = t.dataset.tab;
    $$('.view').forEach(v => v.style.display = 'none');
    $('#view-' + target).style.display = '';
  }));
  $('#toRx').addEventListener('click', ()=>$$('.tab[data-tab="rx"]')[0].click());
  $('#backToSearch').addEventListener('click', ()=>$$('.tab[data-tab="search"]')[0].click());

  // CSV loading
  const loadStatus = $('#loadStatus');
  const summary = $('#summary'), filterSummary = $('#filterSummary'), updateBadge = $('#updateBadge');
  const drop = $('#drop'); const fileInput = $('#fileInput'); const btnPick = $('#btnPick'); const btnReload = $('#btnReload');

  btnPick.addEventListener('click', ()=>fileInput.click());
  fileInput.addEventListener('change', e=>{
    const f = e.target.files[0]; if (f) readFile(f);
  });

  ;['dragenter','dragover'].forEach(evt=>drop.addEventListener(evt, e=>{e.preventDefault(); drop.classList.add('drag')}));
  ;['dragleave','drop'].forEach(evt=>drop.addEventListener(evt, e=>{e.preventDefault(); drop.classList.remove('drag')}));
  drop.addEventListener('drop', e=>{
    const f = e.dataTransfer.files[0]; if (f) readFile(f);
  });

  btnReload.addEventListener('click', tryAutoLoad);

  function setStatus(text, ok){
    loadStatus.textContent = text;
    loadStatus.style.background = ok ? '#063518' : '#3a0a0a';
    loadStatus.style.color = ok ? '#9ff0c5' : '#f7caca';
    loadStatus.style.border = '1px solid ' + (ok ? '#155b37' : '#6b1212');
  }

  function tryAutoLoad(){
    setStatus('Loading ALL_DrugProducts.csv…', true);
    fetch('ALL_DrugProducts.csv')
      .then(r=>{
        if(!r.ok) throw new Error('HTTP '+r.status);
        return r.text();
      })
      .then(text => {
        parseAndLoadCSV(text, 'auto');
      })
      .catch(()=>{
        setStatus('Auto-load failed. Use "Load CSV file".', false);
        drop.style.display = '';
      });
  }

  function readFile(file){
    setStatus('Reading '+file.name+'…', true);
    const reader = new FileReader();
    reader.onload = () => parseAndLoadCSV(reader.result, 'manual');
    reader.onerror = () => setStatus('Failed to read file.', false);
    reader.readAsText(file);
  }

  function parseAndLoadCSV(text){
    const rows = CSVToArray(text);
    if (!rows.length){ setStatus('CSV appears empty.', false); return; }
    // Header
    const headers = rows[0].map(h=>h.trim());
    const idx = Object.fromEntries(headers.map((h,i)=>[h,i]));
    const reqCols = ["Registration Number","Generic Name","Brand Name","Dosage Strength","Dosage Form","Classification","Pharmacologic Category","Manufacturer","Country of Origin","Application Type","Issuance Date","Expiry Date"];
    const missing = reqCols.filter(c=>idx[c]===undefined);
    if(missing.length){
      // Proceed anyway but warn
      console.warn('Missing columns:', missing);
    }
    const data = [];
    for(let i=1;i<rows.length;i++){
      const r = rows[i]; if (!r || r.length===0) continue;
      const obj = {};
      headers.forEach((h, j)=> obj[h]= (r[j] ?? '').trim());
      data.push(obj);
    }
    state.data = data;
    state.page = 1;
    setStatus(`Loaded ${data.length.toLocaleString()} records`, true);
    summary.textContent = `${data.length.toLocaleString()} records`;
    // Try to infer "Updated as of" if present at top lines or file name pattern
    const m = text.match(/Updated\s+as\s+of\s+([^\r\n]+)/i);
    state.lastUpdatedText = m ? m[1].trim() : '—';
    updateBadge.textContent = 'Updated: ' + state.lastUpdatedText;
    drop.style.display = 'none';
    filterAndRender();
    // Build quick index for side search
    buildQuickIndex();
  }

  // Simple CSV parser (handles quoted fields)
  function CSVToArray(strData, strDelimiter) {
    strDelimiter = (strDelimiter || ",");
    const objPattern = new RegExp(
      (
        "(\\"
        + strDelimiter
        + "|\\r?\\n|\\r|^)"
        + "(?:\"([^\"]*(?:\"\"[^\"]*)*)\"|"
        + "([^\"\\"
        + strDelimiter
        + "\\r\\n]*))"
      ), "gi");
    const arrData = [[]];
    let arrMatches = null;
    while (arrMatches = objPattern.exec(strData)){
      const strMatchedDelimiter = arrMatches[1];
      if (strMatchedDelimiter.length && strMatchedDelimiter !== strDelimiter){
        arrData.push([]);
      }
      let strMatchedValue;
      if (arrMatches[2]){
        strMatchedValue = arrMatches[2].replace(/""/g, "\"");
      } else {
        strMatchedValue = arrMatches[3];
      }
      arrData[arrData.length - 1].push(strMatchedValue);
    }
    // Remove empty trailing row
    if (arrData.length && arrData[arrData.length-1].length===1 && arrData[arrData.length-1][0]==="") arrData.pop();
    return arrData;
  }

  // Searching and rendering
  const q = $('#q'), fieldSelect = $('#fieldSelect'), perPage = $('#perPage'), onlyRX = $('#onlyRX'), onlyHuman = $('#onlyHuman');
  const tbody = $('#tbody'), pageInfo = $('#pageInfo'), prev = $('#prev'), next = $('#next');

  q.addEventListener('input', debounce(()=>{ state.searchQ = q.value.trim(); state.page=1; filterAndRender(); }, 120));
  $('#clearSearch').addEventListener('click', ()=>{ q.value=''; state.searchQ=''; state.page=1; filterAndRender(); });
  fieldSelect.addEventListener('change', ()=>{ state.searchField = fieldSelect.value; state.page=1; filterAndRender(); });
  perPage.addEventListener('change', ()=>{ state.perPage = +perPage.value; state.page=1; renderTable(); });
  onlyRX.addEventListener('change', ()=>{ state.onlyRX = onlyRX.checked; state.page=1; filterAndRender(); });
  onlyHuman.addEventListener('change', ()=>{ state.onlyHuman = onlyHuman.checked; state.page=1; filterAndRender(); });

  $$('#tbl thead th[data-k]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const k = th.dataset.k;
      if (state.sortKey===k){ state.sortDir = (state.sortDir==='asc'?'desc':'asc'); }
      else { state.sortKey = k; state.sortDir = 'asc'; }
      renderTable();
    });
  });

  prev.addEventListener('click', ()=>{ if (state.page>1){ state.page--; renderTable(); }});
  next.addEventListener('click', ()=>{ const pages = Math.max(1, Math.ceil(state.filtered.length/state.perPage)); if (state.page<pages){ state.page++; renderTable(); }});

  function filterAndRender(){
    const q = state.searchQ.toLowerCase().trim();
    const f = state.searchField;

    // Split query into terms for cross-field matching (handles "Metho Epri" matching "Methoprene + ... + Eprinomectin")
    const terms = q ? q.split(/\s+/).filter(t => t.length > 0) : [];

    const isHuman = (row) => {
      // Heuristic: Application Type or Classification might contain 'Veterinary' vs 'Human'
      // If CSV has "Human Drugs" info, user can tighten this; here we attempt via Category/Classification
      const gen = (row['Pharmacologic Category']||'').toLowerCase();
      const cls = (row['Classification']||'').toLowerCase();
      // Heuristic to detect veterinary drugs
      const brand = (row['Brand Name']||'').toLowerCase();
      // If it mentions veterinary explicitly, exclude
      if (gen.includes('veterinary') || cls.includes('veterinary') || brand.includes('vet')) return false;
      return true;
    };

    // Fields to search for cross-field matching (excludes Registration No, Expiry, Class as requested)
    const searchableFields = ['Generic Name','Brand Name','Pharmacologic Category','Manufacturer','Dosage Form','Dosage Strength'];

    state.filtered = state.data.filter(row=>{
      if (state.onlyRX){
        if (!String(row['Classification']||'').toLowerCase().includes('prescription')) return false;
      }
      if (state.onlyHuman){
        if (!isHuman(row)) return false;
      }
      if (!q) return true;

      if (f==='all'){
        // Cross-field search: each term must match at least one field
        // This allows "Amlo Exfo" to match Generic="Amlodipine..." and Brand="Exforge..."
        const rowText = searchableFields.map(k => String(row[k]||'').toLowerCase()).join(' ');
        return terms.every(term => rowText.includes(term));
      } else {
        // Field-specific search: all terms must match within the selected field
        const fieldValue = String(row[f]||'').toLowerCase();
        return terms.every(term => fieldValue.includes(term));
      }
    });
    state.page = 1;
    renderTable();
  }

  function renderTable(){
    // Sort
    const k = state.sortKey, dir = state.sortDir;
    const data = state.filtered.slice().sort((a,b)=>{
      const av = (a[k]||'').toString().toLowerCase();
      const bv = (b[k]||'').toString().toLowerCase();
      if (av<bv) return dir==='asc'?-1:1;
      if (av>bv) return dir==='asc'?1:-1;
      return 0;
    });
    // Paging
    const total = data.length;
    const pages = Math.max(1, Math.ceil(total/state.perPage));
    state.page = Math.min(state.page, pages);
    const start = (state.page-1)*state.perPage;
    state.pageRows = data.slice(start, start+state.perPage);

    // Render
    tbody.innerHTML = state.pageRows.map((r, idx)=> rowHTML(r, idx)).join('');
    pageInfo.textContent = `Page ${state.page} of ${pages}`;
    filterSummary.textContent = `${total.toLocaleString()} shown`;
    // Wire add buttons
    $$('#tbody .addRx').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = +btn.dataset.idx;
        const record = state.pageRows[idx];
        addRxFromRecord(record);
        // Switch to RX tab
        $$('.tab[data-tab="rx"]')[0].click();
      });
    });
  }

  function rowHTML(r, idx){
    const textQ = state.searchQ.trim().toLowerCase();
    const h = (s)=> highlight(String(s||''), textQ);
    const expiry = (r['Expiry Date']||'').split(' ')[0];
    const cells = [
      h(r['Generic Name']),
      h(r['Brand Name']),
      h(r['Dosage Strength']),
      h(r['Dosage Form']),
      h(r['Classification']),
      h(r['Manufacturer']),
      h(r['Registration Number']),
      h(expiry)
    ];
    return `<tr>
      <td class="truncate" title="${escapeHTML(r['Generic Name']||'')}">${cells[0]}</td>
      <td class="truncate" title="${escapeHTML(r['Brand Name']||'')}">${cells[1]}</td>
      <td>${cells[2]}</td>
      <td>${cells[3]}</td>
      <td>${cells[4]}</td>
      <td class="truncate" title="${escapeHTML(r['Manufacturer']||'')}">${cells[5]}</td>
      <td>${cells[6]}</td>
      <td>${cells[7]}</td>
      <td><button class="addRx" data-idx="${idx}">Add</button></td>
    </tr>`;
  }

  function highlight(text, q){
    if (!q) return escapeHTML(text);
    // Split query into terms for highlighting
    const terms = q.toLowerCase().trim().split(/\s+/).filter(t => t.length > 0);
    if (terms.length === 0) return escapeHTML(text);

    // Sort terms by length (longest first) to avoid partial matches issues
    const sortedTerms = [...terms].sort((a, b) => b.length - a.length);

    let result = text;
    const highlights = [];

    // Find all matches for all terms
    sortedTerms.forEach(term => {
      let idx = result.toLowerCase().indexOf(term);
      while (idx >= 0) {
        // Check if this position is already highlighted
        const isAlreadyHighlighted = highlights.some(h =>
          (idx >= h.start && idx < h.end) ||
          (idx + term.length > h.start && idx + term.length <= h.end)
        );

        if (!isAlreadyHighlighted) {
          highlights.push({ start: idx, end: idx + term.length, term: result.slice(idx, idx + term.length) });
        }

        idx = result.toLowerCase().indexOf(term, idx + 1);
      }
    });

    if (highlights.length === 0) return escapeHTML(text);

    // Sort by position
    highlights.sort((a, b) => a.start - b.start);

    // Build result with highlights
    let output = '';
    let lastEnd = 0;
    highlights.forEach(h => {
      output += escapeHTML(result.slice(lastEnd, h.start));
      output += '<span class="hl">' + escapeHTML(h.term) + '</span>';
      lastEnd = h.end;
    });
    output += escapeHTML(result.slice(lastEnd));

    return output;
  }
  function escapeHTML(s){ return s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

  function debounce(fn, ms){
    let t; return (...a)=>{ clearTimeout(t); t = setTimeout(()=>fn(...a), ms); }
  }

  // display a temporary toast message (auto-dismiss)
  function showToast(msg, type='info'){
    const container = document.getElementById('toastContainer');
    if(!container) return; // fallback
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = msg;
    container.appendChild(toast);
    // trigger animation
    requestAnimationFrame(()=> toast.classList.add('show'));
    // remove after timeout
    setTimeout(()=>{
      toast.classList.remove('show');
      setTimeout(()=> toast.remove(), 300);
    }, 3000);
  }

  // Quick index for side search (excludes Registration Number and Classification)
  let quickIndex = [];
  function buildQuickIndex(){
    quickIndex = state.data.map((r,i)=>({
      i,
      t: [
        r['Generic Name'], r['Brand Name'],
        r['Pharmacologic Category'], r['Manufacturer'], r['Dosage Form'], r['Dosage Strength']
      ].map(x=>String(x||'').toLowerCase()).join(' | ')
    }));
  }

  // Side search (in RX view)
  const sideSearch = $('#sideSearch'), sideResults = $('#sideResults');
  sideSearch.addEventListener('input', debounce(()=>{
    const q = sideSearch.value.trim().toLowerCase();
    if (!q){ sideResults.innerHTML = ''; return; }
    // Split query into terms for cross-field matching
    const terms = q.split(/\s+/).filter(t => t.length > 0);
    const hits = quickIndex.filter(x => terms.every(term => x.t.includes(term))).slice(0,50);
    sideResults.innerHTML = hits.map(h=>{
      const r = state.data[h.i];
      return cardForRecord(r, q);
    }).join('');
    // Wire buttons
    sideResults.querySelectorAll('.addFromSide').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = +btn.dataset.i;
        addRxFromRecord(state.data[idx]);
      });
    });
  }, 150));

  function cardForRecord(r, q){
    const h = (s)=> highlight(String(s||''), q);
    const idx = state.data.indexOf(r);
    return `<div style="border:1px solid var(--border); border-radius:10px; padding:8px; margin-bottom:6px; background:#0b1220">
      <div><strong>${h(r['Generic Name'])}</strong> — ${h(r['Brand Name'])}</div>
      <div class="small muted">${h(r['Dosage Strength'])} • ${h(r['Dosage Form'])}</div>
      <div class="small muted">Reg: ${h(r['Registration Number'])} • Exp: ${h((r['Expiry Date']||'').split(' ')[0])}</div>
      <div style="text-align:right; margin-top:6px"><button class="addFromSide" data-i="${idx}">Add to Rx</button></div>
    </div>`;
  }

  // RX Builder
  const rxItemsEl = $('#rxItems');
  const fields = {
    clinic: $('#clinic'), clinicAddr: $('#clinicAddr'),
    docName: $('#docName'), prc: $('#prc'), ptr: $('#ptr'), s2: $('#s2'),
    ptName: $('#ptName'), ptAge: $('#ptAge'), ptSex: $('#ptSex'), ptAddr: $('#ptAddr'),
    rxDate: $('#rxDate'), rxNotes: $('#rxNotes')
  };

  // Default date today
  if (!fields.rxDate.value){
    fields.rxDate.valueAsNumber = Date.now() - (new Date()).getTimezoneOffset()*60000;
  }

  $('#addBlank').addEventListener('click', ()=>addRxItem({}));
  $('#clearItems').addEventListener('click', ()=>{ if(confirm('Remove all items?')) rxItemsEl.innerHTML=''; });

  // Quick add by typing and pressing Enter picks first match
  const drugQuick = $('#drugQuick');
  drugQuick.addEventListener('keydown', e=>{
    if (e.key==='Enter'){
      const q = drugQuick.value.trim().toLowerCase();
      if (!q) return;
      // Split query into terms for cross-field matching
      const terms = q.split(/\s+/).filter(t => t.length > 0);
      const idx = quickIndex.find(x => terms.every(term => x.t.includes(term)));
      if (idx){
        addRxFromRecord(state.data[idx.i]);
        drugQuick.value = '';
      } else {
        // create custom with name as typed
        addRxItem({ name: drugQuick.value.trim() });
        drugQuick.value = '';
      }
    }
  });

  function addRxFromRecord(r){
    const genericName = r['Generic Name']||'';
    const brandName = r['Brand Name']||'';
    const form = r['Dosage Form']||'';
    const strength = r['Dosage Strength']||'';
    addRxItem({
      genericName, brandName, strength, form
    });
  }

  function addRxItem({genericName='', brandName='', name='', strength='', form=''}){
    // Support legacy 'name' field for backwards compatibility
    const gen = genericName || name || '';
    const div = document.createElement('div');
    div.className = 'rx-item';
    div.innerHTML = `
      <div class="row">
        <input class="rx-generic" value="${escapeHTML(gen)}" placeholder="Generic Name">
        <input class="rx-brand" value="${escapeHTML(brandName)}" placeholder="Brand Name">
        <input class="rx-strength" value="${escapeHTML(strength)}" placeholder="Strength (e.g., 500 mg)">
        <input class="rx-form" value="${escapeHTML(form)}" placeholder="Form (e.g., tablet)">
        <input class="rx-qty" placeholder="Qty">
      </div>
      <div class="row">
        <input class="rx-sig" placeholder="Sig (e.g., 1 tab PO BID)">
        <input class="rx-duration" placeholder="Duration (e.g., 7 days)">
        <input class="rx-refills" placeholder="Refills">
      </div>
      <div class="row">
        <input class="rx-notes" placeholder="Instructions / Notes (optional)">
      </div>
      <div class="rx-actions">
        <button class="ghost up">↑</button>
        <button class="ghost down">↓</button>
        <button class="ghost dup">Duplicate</button>
        <button class="danger del">Remove</button>
      </div>
    `;
    rxItemsEl.appendChild(div);
    // Wire actions
    div.querySelector('.del').addEventListener('click', ()=> div.remove());
    div.querySelector('.dup').addEventListener('click', ()=>{
      const vals = collectItem(div);
      addRxItem(vals);
    });
    div.querySelector('.up').addEventListener('click', ()=>{
      if (div.previousElementSibling) div.parentNode.insertBefore(div, div.previousElementSibling);
    });
    div.querySelector('.down').addEventListener('click', ()=>{
      if (div.nextElementSibling) div.parentNode.insertBefore(div.nextElementSibling, div);
    });
    // Focus first field
    div.querySelector('.rx-generic').focus();
  }

  function collectItem(div){
    return {
      genericName: div.querySelector('.rx-generic').value.trim(),
      brandName: div.querySelector('.rx-brand').value.trim(),
      strength: div.querySelector('.rx-strength').value.trim(),
      form: div.querySelector('.rx-form').value.trim(),
      qty: div.querySelector('.rx-qty').value.trim(),
      sig: div.querySelector('.rx-sig').value.trim(),
      duration: div.querySelector('.rx-duration').value.trim(),
      refills: div.querySelector('.rx-refills').value.trim(),
      notes: div.querySelector('.rx-notes').value.trim()
    };
  }

  // Print
  function fillPrint(){
    $('#pClinic').textContent = fields.clinic.value || 'Clinic';
    $('#pClinicAddr').textContent = fields.clinicAddr.value || '';
    $('#pPtName').textContent = fields.ptName.value || '';
    const ageSex = [fields.ptAge.value, fields.ptSex.value].filter(Boolean).join(' / ');
    $('#pPtAgeSex').textContent = ageSex;
    $('#pPtAddr').textContent = fields.ptAddr.value || '';
    $('#pDate').textContent = fields.rxDate.value || new Date().toISOString().slice(0,10);
    $('#pDoc').textContent = fields.docName.value || '';
    $('#pDoc2').textContent = fields.docName.value || '';
    $('#pPRC').textContent = fields.prc.value || '';
    $('#pPTR').textContent = fields.ptr.value || '';
    $('#pS2').textContent = fields.s2.value || '';
    const ol = $('#pItems'); ol.innerHTML = '';
    const items = Array.from(rxItemsEl.children).map(div=>collectItem(div));
    for(const it of items){
      // Build display name from separate generic/brand fields (with backwards compat for legacy 'name' field)
      let displayName = '';
      if (it.genericName && it.brandName) {
        displayName = `${it.genericName} — ${it.brandName}`;
      } else if (it.genericName) {
        displayName = it.genericName;
      } else if (it.name) {
        // Legacy fallback for old saved data
        displayName = it.name;
      }
      const line = [
        [displayName, it.strength].filter(Boolean).join(', '),
        it.form,
        it.sig,
        it.duration ? `for ${it.duration}` : '',
        it.qty ? `Qty: ${it.qty}` : '',
        it.refills ? `Refills: ${it.refills}` : ''
      ].filter(Boolean).join(' • ');
      const li = document.createElement('li');
      li.textContent = line;
      ol.appendChild(li);
      if (it.notes){
        const n = document.createElement('div'); n.style.marginLeft='8px'; n.style.fontSize='10pt'; n.textContent = '— ' + it.notes;
        ol.appendChild(n);
      }
    }
    const notes = fields.rxNotes.value.trim();
    $('#pNotes').textContent = notes ? 'Notes: ' + notes : '';
  }
  function printNow(){ fillPrint(); window.print(); }
  $('#printRx').addEventListener('click', printNow);
  $('#printRx2').addEventListener('click', printNow);

  // Copy as text
  $('#copyRx').addEventListener('click', ()=>{
    const items = Array.from(rxItemsEl.children).map(div=>collectItem(div));
    const lines = items.map((it,i)=>{
      // Use dedicated fields (with backwards compat for legacy 'name' field)
      let generic = it.genericName || '';
      let brand = it.brandName || '';

      // Legacy fallback: if no separate fields, try to parse from old 'name' field
      if (!generic && !brand && it.name) {
        const dashIdx = it.name.indexOf(' — ');
        if (dashIdx > -1) {
          generic = it.name.slice(0, dashIdx).trim();
          brand = it.name.slice(dashIdx + 3).trim();
        } else {
          generic = it.name;
        }
      }

      // Format: 1. Desonide (Desowen) 500 mcg/g (0.05%) Lotion #1
      const namePart = brand ? `${generic} (${brand})` : generic;
      const strengthPart = it.strength || '';
      const formPart = it.form || '';
      const qtyPart = it.qty ? ` #${it.qty}` : '';
      const line1 = `${i+1}. ${namePart} ${strengthPart} ${formPart}${qtyPart}`.trim();

      // Format: Sig. Apply on the affected area, (AM & PM)
      const line2 = it.sig ? `Sig. ${it.sig}` : '';

      return [line1, line2].filter(Boolean).join('\n');
    });
    const text = lines.join('\n\n');
    navigator.clipboard.writeText(text).then(()=> showToast('Copied to clipboard')).catch(()=> showToast('Copy failed'));
  });

  // Local save/load
  $('#saveLocal').addEventListener('click', ()=>{
    const items = Array.from(rxItemsEl.children).map(div=>collectItem(div));
    const payload = {
      meta: Object.fromEntries(Object.entries(fields).map(([k,el])=>[k, el.value])),
      items
    };
    localStorage.setItem('rxBuilderSave', JSON.stringify(payload));
    showToast('Saved locally.');
  });
  $('#loadLocal').addEventListener('click', ()=>{
    const s = localStorage.getItem('rxBuilderSave');
    if (!s) return showToast('No saved data found.');
    try{
      const data = JSON.parse(s);
      Object.entries(data.meta||{}).forEach(([k,v])=>{ if(fields[k]) fields[k].value = v; });
      rxItemsEl.innerHTML = '';
      (data.items||[]).forEach(it=> addRxItem(it));
      showToast('Restored.');
    }catch(e){ showToast('Failed to restore.'); }
  });

  // Initialize
  // Try to load CSV from file
  tryAutoLoad();
  // Show drop area if auto-load fails after delay
  setTimeout(()=>{
    if (!state.data.length){ drop.style.display=''; }
  }, 2000);

})();

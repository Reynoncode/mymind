// ============================================================
// DATA LAYER
// localStorage indi; Firebase-ə keçmək üçün DB obyektini dəyiş
// ============================================================
const DB = {
  _read() {
    try { return JSON.parse(localStorage.getItem('bilikbazasi') || 'null'); } catch { return null; }
  },
  _write(data) {
    localStorage.setItem('bilikbazasi', JSON.stringify(data));
  },
  _init() {
    const d = this._read();
    if (d) return d;
    const fresh = { categories: [], notes: [], links: [], nextId: 1 };
    this._write(fresh);
    return fresh;
  },
  get() { return this._init(); },
  save(data) { this._write(data); },

  genId() {
    const d = this.get(); const id = d.nextId; d.nextId++; this.save(d); return id;
  },
  addCategory(name, icon = '📁') {
    const d = this.get();
    const cat = { id: this.genId(), name, icon, subcats: [] };
    d.categories.push(cat); this.save(d); return cat;
  },
  addSubcat(catId, name) {
    const d = this.get();
    const cat = d.categories.find(c => c.id === catId);
    if (!cat) return null;
    const sub = { id: this.genId(), name };
    cat.subcats.push(sub); this.save(d); return sub;
  },
  deleteCategory(catId) {
    const d = this.get();
    d.categories = d.categories.filter(c => c.id !== catId);
    d.notes = d.notes.filter(n => n.catId !== catId);
    this.save(d);
  },
  deleteSubcat(catId, subcatId) {
    const d = this.get();
    const cat = d.categories.find(c => c.id === catId);
    if (cat) cat.subcats = cat.subcats.filter(s => s.id !== subcatId);
    d.notes = d.notes.filter(n => !(n.catId === catId && n.subcatId === subcatId));
    this.save(d);
  },
  saveNote(note) {
    const d = this.get();
    const idx = d.notes.findIndex(n => n.id === note.id);
    if (idx >= 0) d.notes[idx] = note; else d.notes.push(note);
    this.save(d); return note;
  },
  deleteNote(noteId) {
    const d = this.get();
    d.notes = d.notes.filter(n => n.id !== noteId);
    d.links = d.links.filter(l => l.a !== noteId && l.b !== noteId);
    this.save(d);
  },
  addLink(a, b) {
    const d = this.get();
    const exists = d.links.find(l => (l.a===a&&l.b===b)||(l.a===b&&l.b===a));
    if (!exists) { d.links.push({a,b}); this.save(d); }
  },
  removeLink(a, b) {
    const d = this.get();
    d.links = d.links.filter(l => !((l.a===a&&l.b===b)||(l.a===b&&l.b===a)));
    this.save(d);
  },
  getLinks(noteId) {
    const d = this.get();
    return d.links.filter(l => l.a===noteId||l.b===noteId)
      .map(l => l.a===noteId ? l.b : l.a);
  },
  searchNotes(q) {
    if (!q.trim()) return [];
    const d = this.get(); const ql = q.toLowerCase();
    return d.notes.filter(n =>
      n.title.toLowerCase().includes(ql) ||
      (n.content || '').toLowerCase().includes(ql)
    ).slice(0, 10);
  }
};

// ============================================================
// FIRESTORE HAZIRLIĞI
// Firebase inteqrasiyası üçün aşağıdakı funksiyaları
// firebase-config.js faylında override edin:
//
//   window.FS_saveNote    = async (note) => { ... }
//   window.FS_deleteNote  = async (id)   => { ... }
//   window.FS_saveCat     = async (cat)  => { ... }
//   window.FS_deleteCat   = async (id)   => { ... }
//   window.FS_saveLink    = async (a, b) => { ... }
//   window.FS_loadAll     = async ()     => { ... }  // returns {categories,notes,links}
//
// Hazır olduqda DB._write() əvəzinə bu funksiyaları çağırın.
// ============================================================

// ============================================================
// FILE STORE (base64 → localStorage; sonra Firebase Storage)
// ============================================================
const FileStore = {
  save(noteId, file) {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = e => {
        const key = `file_${noteId}_${Date.now()}_${file.name}`;
        try { localStorage.setItem(key, e.target.result); }
        catch { /* quota */ }
        res({ key, name: file.name, type: file.type, size: file.size });
      };
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
  },
  get(key) { return localStorage.getItem(key); },
  delete(key) { localStorage.removeItem(key); }
};

// ============================================================
// STATE
// ============================================================
let sidebarOpen = false;
let quillEditor = null;
let currentView = 'welcome';
let currentCatId = null;
let currentSubcatId = null;
let currentNoteId = null;
let editingNoteId = null;
let stagedFiles = [];
let graphNodes = [];
let graphEdges = [];
let graphDrag = null;
let linkingNoteId = null;
let genericModalCallback = null;

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
  initQuill();
  renderSidebar();
  updateStats();
  initGraphCanvas('graph-canvas');

  document.addEventListener('click', e => {
    if (!e.target.closest('#search-wrap')) {
      document.getElementById('search-results').classList.remove('show');
    }
  });

  const fa = document.getElementById('file-upload-area');
  fa.addEventListener('dragover', e => { e.preventDefault(); fa.classList.add('drag-over'); });
  fa.addEventListener('dragleave', () => fa.classList.remove('drag-over'));
  fa.addEventListener('drop', e => {
    e.preventDefault(); fa.classList.remove('drag-over');
    handleFileSelect(e.dataTransfer.files);
  });
});

// ============================================================
// SIDEBAR
// ============================================================
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
  document.getElementById('main').classList.toggle('sidebar-open', sidebarOpen);
  document.getElementById('overlay').classList.toggle('show', sidebarOpen);
}
function closeSidebar() {
  sidebarOpen = false;
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('main').classList.remove('sidebar-open');
  document.getElementById('overlay').classList.remove('show');
}

function renderSidebar() {
  const d = DB.get();
  const list = document.getElementById('cat-list');
  if (!d.categories.length) {
    list.innerHTML = `<div style="padding:20px 12px;text-align:center;color:rgba(255,255,255,0.3);font-size:12px;line-height:1.6">
      Hələ kateqoriya yoxdur.<br>+ düyməsi ilə əlavə edin.</div>`;
    return;
  }
  list.innerHTML = d.categories.map(cat => {
    const noteCount = d.notes.filter(n => n.catId === cat.id).length;
    const isOpen = currentCatId === cat.id;
    return `
    <div class="cat-item" id="cat-item-${cat.id}">
      <div class="cat-header ${currentCatId===cat.id&&!currentSubcatId?'active':''}"
           onclick="selectCategory(${cat.id})">
        <i class="ti ti-chevron-right cat-chevron ${isOpen?'open':''}"></i>
        <span class="cat-icon">${cat.icon}</span>
        <span class="cat-name">${escHtml(cat.name)}</span>
        <span class="cat-count">${noteCount}</span>
        <div class="cat-actions">
          <button onclick="event.stopPropagation();openAddSubcatModal(${cat.id})" title="Alt kateqoriya">
            <i class="ti ti-plus"></i></button>
          <button onclick="event.stopPropagation();renameCat(${cat.id})" title="Adını dəyiş">
            <i class="ti ti-pencil"></i></button>
          <button class="del-btn" onclick="event.stopPropagation();deleteCat(${cat.id})" title="Sil">
            <i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="subcat-list ${isOpen?'open':''}">
        ${cat.subcats.map(sub => {
          const sc = d.notes.filter(n=>n.catId===cat.id&&n.subcatId===sub.id).length;
          return `
          <div class="subcat-item ${currentSubcatId===sub.id?'active':''}"
               onclick="selectSubcat(${cat.id},${sub.id})">
            <div class="subcat-dot"></div>
            <span class="subcat-name">${escHtml(sub.name)}</span>
            <span class="cat-count">${sc}</span>
            <div class="subcat-actions">
              <button onclick="event.stopPropagation();renameSubcat(${cat.id},${sub.id})" title="Adını dəyiş">
                <i class="ti ti-pencil"></i></button>
              <button class="del-btn" onclick="event.stopPropagation();deleteSubcat(${cat.id},${sub.id})" title="Sil">
                <i class="ti ti-trash"></i></button>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function selectCategory(catId) {
  currentCatId = catId;
  currentSubcatId = null;
  renderSidebar();
  showCatView(catId, null);
}
function selectSubcat(catId, subcatId) {
  currentCatId = catId;
  currentSubcatId = subcatId;
  renderSidebar();
  showCatView(catId, subcatId);
  if (window.innerWidth < 600) closeSidebar();
}

// ============================================================
// VIEWS
// ============================================================
function showView(name) {
  document.getElementById('welcome').style.display = name==='welcome' ? '' : 'none';
  document.getElementById('cat-view').style.display = name==='cat' ? '' : 'none';
  document.getElementById('note-view').style.display = name==='note' ? '' : 'none';
  document.getElementById('editor-view').style.display = name==='editor' ? '' : 'none';
  currentView = name;
}

function updateStats() {
  const d = DB.get();
  document.getElementById('stat-notes').textContent = d.notes.length;
  document.getElementById('stat-cats').textContent = d.categories.length;
  let fc = 0;
  d.notes.forEach(n => fc += (n.files||[]).length);
  document.getElementById('stat-files').textContent = fc;
}

function showCatView(catId, subcatId) {
  const d = DB.get();
  const cat = d.categories.find(c => c.id===catId);
  if (!cat) return;
  let notes = d.notes.filter(n => n.catId===catId);
  if (subcatId) {
    notes = notes.filter(n => n.subcatId===subcatId);
    const sub = cat.subcats.find(s => s.id===subcatId);
    document.getElementById('cv-title').textContent = sub ? sub.name : cat.name;
    document.getElementById('cv-subtitle').textContent = sub
      ? `${cat.icon} ${cat.name} → ${sub.name} · ${notes.length} qeyd`
      : `${notes.length} qeyd`;
  } else {
    document.getElementById('cv-title').textContent = `${cat.icon} ${cat.name}`;
    document.getElementById('cv-subtitle').textContent = `${notes.length} qeyd`;
  }
  const nc = document.getElementById('note-cards');
  if (!notes.length) {
    nc.innerHTML = `<div class="empty-state"><i class="ti ti-file-text"></i><p>Bu bölmədə hələ qeyd yoxdur</p></div>`;
  } else {
    nc.innerHTML = notes.map(n => `
      <div class="note-card" onclick="showNote(${n.id})">
        <div class="note-card-title">${escHtml(n.title)}</div>
        <div class="note-card-preview">${stripHtml(n.content||'')}</div>
        <div class="note-card-meta">
          <span><i class="ti ti-clock" style="margin-right:3px"></i>${fmtDate(n.updatedAt)}</span>
          ${(n.files||[]).length ? `<span><i class="ti ti-paperclip" style="margin-right:3px"></i>${n.files.length} fayl</span>` : ''}
          ${DB.getLinks(n.id).length ? `<span><i class="ti ti-link" style="margin-right:3px"></i>${DB.getLinks(n.id).length} əlaqə</span>` : ''}
        </div>
      </div>`).join('');
  }
  showView('cat');
  updateGraphData();
  renderMobileGraph('graph-canvas-mobile');
}

function showNote(noteId) {
  const d = DB.get();
  const note = d.notes.find(n => n.id===noteId);
  if (!note) return;
  currentNoteId = noteId;
  document.getElementById('nv-title').textContent = note.title;
  const cat = d.categories.find(c => c.id===note.catId);
  const sub = cat?.subcats.find(s => s.id===note.subcatId);
  document.getElementById('nv-meta').innerHTML = `
    <span>${cat?`${cat.icon} ${cat.name}`:''}</span>
    ${sub?`<span>▸ ${sub.name}</span>`:''}
    <span><i class="ti ti-calendar" style="margin-right:3px"></i>${fmtDate(note.createdAt)}</span>
    <span><i class="ti ti-clock" style="margin-right:3px"></i>Yeniləndi: ${fmtDate(note.updatedAt)}</span>
  `;
  document.getElementById('nv-body').innerHTML = note.content || '<p style="color:var(--text3)">Məzmun yoxdur</p>';

  const nf = document.getElementById('nv-files');
  const fg = document.getElementById('nv-file-grid');
  if ((note.files||[]).length) {
    fg.innerHTML = note.files.map(f =>
      `<div class="file-chip" onclick="openFile('${f.key}','${escHtml(f.name)}','${f.type}')">
        <span>${fileIcon(f.type)}</span>
        <span class="file-chip-name">${escHtml(f.name)}</span>
      </div>`).join('');
    nf.style.display = '';
  } else { nf.style.display = 'none'; }

  const links = DB.getLinks(noteId);
  const mg = document.getElementById('mobile-graph-note');
  if (links.length && window.innerWidth < 1100) {
    mg.style.display = '';
    renderNoteGraph('graph-canvas-note', noteId);
  } else { mg.style.display = 'none'; }

  showView('note');
  updateGraphData();
  renderGraph('graph-canvas');
}

// ============================================================
// EDITOR
// ============================================================
function initQuill() {
  quillEditor = new Quill('#quill-editor', {
    theme: 'snow',
    placeholder: 'Məzmunu buraya yaz...',
    modules: {
      toolbar: [
        [{ header: [1,2,3,false] }],
        ['bold','italic','underline','strike'],
        [{ color: [] },{ background: [] }],
        [{ list: 'ordered' },{ list: 'bullet' }],
        ['blockquote','code-block'],
        ['link'],
        ['clean']
      ]
    }
  });
}

function openEditor(noteId) {
  editingNoteId = noteId;
  stagedFiles = [];
  const d = DB.get();

  const cs = document.getElementById('editor-cat-select');
  cs.innerHTML = '<option value="">Kateqoriya seç...</option>' +
    d.categories.map(c => `<option value="${c.id}">${c.icon} ${c.name}</option>`).join('');

  const ss = document.getElementById('editor-subcat-select');
  ss.innerHTML = '<option value="">Alt kateqoriya (ixtiyari)</option>';
  cs.onchange = () => {
    const cat = d.categories.find(c => c.id==cs.value);
    ss.innerHTML = '<option value="">Alt kateqoriya (ixtiyari)</option>' +
      (cat?.subcats||[]).map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  };

  if (noteId) {
    const note = d.notes.find(n => n.id===noteId);
    if (note) {
      document.getElementById('editor-title-input').value = note.title;
      quillEditor.root.innerHTML = note.content || '';
      cs.value = note.catId || '';
      cs.dispatchEvent(new Event('change'));
      setTimeout(() => { ss.value = note.subcatId || ''; }, 0);
      stagedFiles = (note.files||[]).map(f => ({ meta: f, file: null }));
      renderStagedFiles();
    }
  } else {
    document.getElementById('editor-title-input').value = '';
    quillEditor.setText('');
    if (currentCatId) {
      cs.value = currentCatId;
      cs.dispatchEvent(new Event('change'));
      setTimeout(() => { if (currentSubcatId) ss.value = currentSubcatId; }, 0);
    }
    document.getElementById('staged-files').innerHTML = '';
  }
  showView('editor');
}

function cancelEditor() {
  if (currentCatId) showCatView(currentCatId, currentSubcatId);
  else if (currentNoteId) showNote(currentNoteId);
  else { showView('welcome'); updateStats(); }
}

async function saveNote() {
  const title = document.getElementById('editor-title-input').value.trim();
  if (!title) { showToast('Başlıq daxil edin', 'error'); return; }
  const catId = parseInt(document.getElementById('editor-cat-select').value) || null;
  const subcatId = parseInt(document.getElementById('editor-subcat-select').value) || null;
  const content = quillEditor.root.innerHTML;
  const now = new Date().toISOString();

  const newFileMetas = [];
  for (const sf of stagedFiles) {
    if (sf.file) {
      try {
        const meta = await FileStore.save(editingNoteId || 'tmp', sf.file);
        newFileMetas.push(meta);
      } catch { newFileMetas.push({ name: sf.file.name, type: sf.file.type, key: null }); }
    } else if (sf.meta) {
      newFileMetas.push(sf.meta);
    }
  }

  const d = DB.get();
  let note;
  if (editingNoteId) {
    note = d.notes.find(n => n.id===editingNoteId);
    note.title = title; note.content = content;
    note.catId = catId; note.subcatId = subcatId;
    note.files = newFileMetas; note.updatedAt = now;
    DB.saveNote(note);
  } else {
    note = {
      id: DB.genId(), title, content,
      catId, subcatId, files: newFileMetas,
      createdAt: now, updatedAt: now
    };
    DB.saveNote(note);
  }

  renderSidebar();
  updateStats();
  currentNoteId = note.id;
  showNote(note.id);
  showToast('Saxlandı ✓', 'success');
}

// ============================================================
// FILE HANDLING
// ============================================================
function handleFileSelect(files) {
  for (const f of files) stagedFiles.push({ file: f, meta: null });
  renderStagedFiles();
}

function renderStagedFiles() {
  const container = document.getElementById('staged-files');
  container.innerHTML = stagedFiles.map((sf, i) => {
    const name = sf.file ? sf.file.name : sf.meta?.name || 'Fayl';
    return `<div class="staged-file">
      <span>${fileIcon(sf.file?.type||sf.meta?.type||'')}</span>
      <span>${escHtml(name)}</span>
      <button onclick="removeStagedFile(${i})"><i class="ti ti-x"></i></button>
    </div>`;
  }).join('');
}

function removeStagedFile(i) { stagedFiles.splice(i,1); renderStagedFiles(); }

function openFile(key, name, type) {
  const data = FileStore.get(key);
  const modal = document.getElementById('file-modal');
  const body = document.getElementById('file-modal-body');
  document.getElementById('file-modal-title').textContent = name;
  modal.classList.add('show');

  if (!data) {
    body.innerHTML = `<div class="file-unsupported"><i class="ti ti-alert-triangle"></i><p>Fayl tapılmadı (yaddaş limiti aşılmış ola bilər)</p></div>`;
    return;
  }

  if (type.startsWith('image/')) {
    body.innerHTML = `<img src="${data}" alt="${escHtml(name)}" style="max-width:100%;max-height:80vh;object-fit:contain">`;
  } else if (type === 'application/pdf') {
    body.innerHTML = `<iframe src="${data}" title="${escHtml(name)}"></iframe>`;
  } else if (type.startsWith('video/')) {
    body.innerHTML = `<video controls style="max-width:100%;max-height:80vh"><source src="${data}"></video>`;
  } else if (type.startsWith('audio/')) {
    body.innerHTML = `<audio controls><source src="${data}"></audio>`;
  } else {
    body.innerHTML = `<div class="file-unsupported">
      <i class="ti ti-file"></i>
      <p>${escHtml(name)}</p>
      <a href="${data}" download="${escHtml(name)}" class="download-btn">
        <i class="ti ti-download"></i> Yüklə
      </a></div>`;
  }
}

function closeFileModal() {
  document.getElementById('file-modal').classList.remove('show');
  document.getElementById('file-modal-body').innerHTML = '';
}

// ============================================================
// GRAPH ENGINE
// ============================================================
function updateGraphData() {
  const d = DB.get();
  const notes = currentCatId ? d.notes.filter(n => n.catId===currentCatId) : d.notes;
  const W = 300, H = 420;
  graphNodes = notes.map((n, i) => {
    const angle = (2*Math.PI*i/notes.length) - Math.PI/2;
    const r = Math.min(W,H)*0.32;
    return {
      id: n.id, label: n.title,
      x: W/2 + r*Math.cos(angle),
      y: H/2 + r*Math.sin(angle),
      vx:0, vy:0
    };
  });
  graphEdges = d.links.filter(l =>
    graphNodes.find(n=>n.id===l.a) && graphNodes.find(n=>n.id===l.b)
  );
}

function renderGraph(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  function draw() {
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#f0f1f5';
    ctx.fillRect(0,0,W,H);

    // Subtle grid
    ctx.fillStyle = '#e2e4ea';
    for (let x=20;x<W;x+=20) for (let y=20;y<H;y+=20) {
      ctx.beginPath(); ctx.arc(x,y,1,0,Math.PI*2); ctx.fill();
    }

    // Edges
    graphEdges.forEach(e => {
      const a = graphNodes.find(n=>n.id===e.a);
      const b = graphNodes.find(n=>n.id===e.b);
      if (!a||!b) return;
      ctx.beginPath();
      ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle = '#10b98155';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // Nodes
    graphNodes.forEach(n => {
      const isActive = n.id===currentNoteId;
      const isLinked = currentNoteId && DB.getLinks(currentNoteId).includes(n.id);
      const color = isActive ? '#111111' : isLinked ? '#10b981' : '#6b7280';

      ctx.beginPath(); ctx.arc(n.x,n.y,isActive?8:6,0,Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#f0f1f5'; ctx.lineWidth = 2; ctx.stroke();

      const label = n.label.length>10 ? n.label.slice(0,10)+'…' : n.label;
      ctx.fillStyle = isActive ? '#111' : '#6b7280';
      ctx.font = `${isActive?'600':'400'} 10px Inter, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(label, n.x, n.y+10);
    });
  }

  draw();

  canvas.onmousedown = e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX-rect.left, my = e.clientY-rect.top;
    graphDrag = graphNodes.find(n => Math.hypot(n.x-mx,n.y-my)<12);
  };
  canvas.onmousemove = e => {
    if (!graphDrag) return;
    const rect = canvas.getBoundingClientRect();
    graphDrag.x = e.clientX-rect.left;
    graphDrag.y = e.clientY-rect.top;
    draw();
  };
  canvas.onmouseup = () => { graphDrag = null; };
  canvas.onclick = e => {
    if (graphDrag) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX-rect.left, my = e.clientY-rect.top;
    const node = graphNodes.find(n => Math.hypot(n.x-mx,n.y-my)<12);
    if (node) showNote(node.id);
  };
  canvas.ontouchstart = e => {
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    graphDrag = graphNodes.find(n => Math.hypot(n.x-(t.clientX-rect.left),n.y-(t.clientY-rect.top))<16);
  };
  canvas.ontouchmove = e => {
    if (!graphDrag) return; e.preventDefault();
    const t = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    graphDrag.x = t.clientX-rect.left;
    graphDrag.y = t.clientY-rect.top;
    draw();
  };
  canvas.ontouchend = () => { graphDrag = null; };
}

function renderMobileGraph(canvasId) { updateGraphData(); renderGraph(canvasId); }
function renderNoteGraph(canvasId) { updateGraphData(); renderGraph(canvasId); }
function showGraphPanel() { updateGraphData(); renderGraph('graph-canvas'); }
function resetGraphView() { updateGraphData(); renderGraph('graph-canvas'); }
function initGraphCanvas(id) { updateGraphData(); renderGraph(id); }

// ============================================================
// LINK MODAL
// ============================================================
function openLinkModal(noteId) {
  linkingNoteId = noteId;
  const d = DB.get();
  const existing = DB.getLinks(noteId);
  const others = d.notes.filter(n => n.id !== noteId);
  const sel = document.getElementById('link-target-select');
  sel.innerHTML = others.map(n => {
    const linked = existing.includes(n.id);
    return `<option value="${n.id}" ${linked?'style="color:var(--success)"':''}>${linked?'✓ ':''} ${escHtml(n.title)}</option>`;
  }).join('');
  document.getElementById('link-modal').classList.add('show');
}
function closeLinkModal() { document.getElementById('link-modal').classList.remove('show'); }
function confirmLink() {
  const targetId = parseInt(document.getElementById('link-target-select').value);
  if (!targetId||!linkingNoteId) return;
  DB.addLink(linkingNoteId, targetId);
  closeLinkModal();
  showToast('Əlaqə quruldu ✓', 'success');
  updateGraphData();
  renderGraph('graph-canvas');
  if (currentNoteId) showNote(currentNoteId);
}

// ============================================================
// CATEGORY MODALS
// ============================================================
function openAddCatModal() {
  openGenericModal('Yeni Kateqoriya', 'Kateqoriyanın adı', 'Məs: İdman', true, 'Emoji (ixtiyari)', (name, icon) => {
    DB.addCategory(name, icon||'📁');
    renderSidebar(); updateStats();
    showToast('Kateqoriya əlavə edildi ✓', 'success');
  });
}

function openAddSubcatModal(catId) {
  openGenericModal('Yeni Alt Kateqoriya', 'Ad', 'Məs: Üzgüçülük', false, '', (name) => {
    DB.addSubcat(catId, name);
    renderSidebar();
    showToast('Alt kateqoriya əlavə edildi ✓', 'success');
  });
}

function renameCat(catId) {
  const d = DB.get();
  const cat = d.categories.find(c=>c.id===catId);
  openGenericModal('Adını Dəyiş', 'Yeni ad', cat?.name||'', false, '', (name) => {
    cat.name = name; DB.save(d); renderSidebar();
    showToast('Adı dəyişdirildi ✓', 'success');
  });
  setTimeout(()=>{ document.getElementById('gm-input').value = cat?.name||''; },0);
}

function renameSubcat(catId, subcatId) {
  const d = DB.get();
  const cat = d.categories.find(c=>c.id===catId);
  const sub = cat?.subcats.find(s=>s.id===subcatId);
  openGenericModal('Adını Dəyiş', 'Yeni ad', sub?.name||'', false, '', (name) => {
    sub.name = name; DB.save(d); renderSidebar();
    showToast('Adı dəyişdirildi ✓', 'success');
  });
  setTimeout(()=>{ document.getElementById('gm-input').value = sub?.name||''; },0);
}

function deleteCat(catId) {
  if (!confirm('Bu kateqoriyanı və bütün qeydlərini silmək istəyirsiniz?')) return;
  DB.deleteCategory(catId);
  if (currentCatId===catId) { currentCatId=null; showView('welcome'); }
  renderSidebar(); updateStats();
  showToast('Kateqoriya silindi', 'success');
}

function deleteSubcat(catId, subcatId) {
  if (!confirm('Bu alt kateqoriyanı silmək istəyirsiniz?')) return;
  DB.deleteSubcat(catId, subcatId);
  if (currentSubcatId===subcatId) { currentSubcatId=null; showCatView(catId,null); }
  renderSidebar(); updateStats();
  showToast('Alt kateqoriya silindi', 'success');
}

function deleteNote(noteId) {
  if (!confirm('Bu qeydi silmək istəyirsiniz?')) return;
  DB.deleteNote(noteId);
  renderSidebar(); updateStats();
  if (currentCatId) showCatView(currentCatId, currentSubcatId);
  else showView('welcome');
  showToast('Qeyd silindi', 'success');
}

// ============================================================
// GENERIC MODAL
// ============================================================
function openGenericModal(title, label, placeholder, showExtra, extraLabel, cb) {
  genericModalCallback = cb;
  document.getElementById('gm-title').textContent = title;
  document.getElementById('gm-label').textContent = label;
  document.getElementById('gm-input').placeholder = placeholder;
  document.getElementById('gm-input').value = '';
  const extra = document.getElementById('gm-extra');
  extra.style.display = showExtra ? '' : 'none';
  if (showExtra) {
    document.getElementById('gm-extra-label').textContent = extraLabel;
    document.getElementById('gm-extra-input').value = '';
  }
  document.getElementById('generic-modal').classList.add('show');
  setTimeout(()=>document.getElementById('gm-input').focus(), 50);
  document.getElementById('gm-confirm-btn').onclick = () => {
    const val = document.getElementById('gm-input').value.trim();
    if (!val) return;
    const extra2 = document.getElementById('gm-extra-input').value.trim();
    closeGenericModal();
    cb(val, extra2);
  };
  document.getElementById('gm-input').onkeydown = e => {
    if (e.key==='Enter') document.getElementById('gm-confirm-btn').click();
  };
}
function closeGenericModal() {
  document.getElementById('generic-modal').classList.remove('show');
}

// ============================================================
// SEARCH
// ============================================================
function handleSearch(q) {
  const res = document.getElementById('search-results');
  if (!q.trim()) { res.classList.remove('show'); return; }
  const results = DB.searchNotes(q);
  const d = DB.get();
  if (!results.length) {
    res.innerHTML = `<div class="search-item" style="color:var(--text3);cursor:default">Nəticə tapılmadı</div>`;
  } else {
    res.innerHTML = results.map(n => {
      const cat = d.categories.find(c=>c.id===n.catId);
      const preview = stripHtml(n.content||'').slice(0,80);
      const hi = preview.toLowerCase().includes(q.toLowerCase())
        ? highlightMatch(preview, q) : preview;
      return `<div class="search-item" onclick="openSearchResult(${n.id})">
        <div class="search-item-title">${escHtml(n.title)}</div>
        <div class="search-item-path">${cat?`${cat.icon} ${cat.name}`:''}</div>
        ${preview?`<div class="search-item-match">${hi}</div>`:''}
      </div>`;
    }).join('');
  }
  res.classList.add('show');
}

function openSearchResult(noteId) {
  document.getElementById('search-results').classList.remove('show');
  document.getElementById('search-input').value = '';
  const d = DB.get();
  const note = d.notes.find(n=>n.id===noteId);
  if (note) { currentCatId=note.catId; currentSubcatId=note.subcatId; }
  renderSidebar();
  showNote(noteId);
}

function highlightMatch(text, q) {
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx<0) return escHtml(text);
  return escHtml(text.slice(0,idx))
    + `<mark style="background:rgba(0,0,0,0.08);color:var(--text);border-radius:2px">${escHtml(text.slice(idx,idx+q.length))}</mark>`
    + escHtml(text.slice(idx+q.length));
}

// ============================================================
// UTILS
// ============================================================
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function stripHtml(html) {
  const d = document.createElement('div'); d.innerHTML = html; return d.textContent||'';
}
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('az-AZ',{day:'2-digit',month:'short',year:'numeric'});
}
function fileIcon(type='') {
  if (type.startsWith('image/')) return '🖼️';
  if (type==='application/pdf') return '📄';
  if (type.startsWith('video/')) return '🎬';
  if (type.startsWith('audio/')) return '🎵';
  if (type.includes('word')) return '📝';
  if (type.includes('excel')||type.includes('spreadsheet')) return '📊';
  if (type.includes('zip')||type.includes('rar')) return '🗜️';
  return '📎';
}

let toastTimer = null;
function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  t.className = 'show ' + type;
  icon.className = type==='success' ? 'ti ti-check' : 'ti ti-alert-circle';
  msgEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2500);
}

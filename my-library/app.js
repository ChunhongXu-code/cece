// ===== 数据层 =====
const DB = {
  _g(k){try{return JSON.parse(localStorage.getItem(k))||[]}catch{return[]}},
  _s(k,d){localStorage.setItem(k,JSON.stringify(d))},
  getBooks(){return this._g('lib_books')},
  setBooks(d){this._s('lib_books',d)},
  getNotes(){return this._g('lib_notes')},
  setNotes(d){this._s('lib_notes',d)},
  getTopics(){return this._g('lib_topics')},
  setTopics(d){this._s('lib_topics',d)},
  genId(){return Date.now().toString(36)+Math.random().toString(36).slice(2,6)},
  exportAll(){return JSON.stringify({books:this.getBooks(),notes:this.getNotes(),topics:this.getTopics(),exportedAt:new Date().toISOString()},null,2)},
  importAll(j){const d=JSON.parse(j);if(d.books)this.setBooks(d.books);if(d.notes)this.setNotes(d.notes);if(d.topics)this.setTopics(d.topics)}
};

function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);requestAnimationFrame(()=>t.classList.add('show'));setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},2000)}
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}
const ST={reading:'在读',finished:'已读',wishlist:'想读'};

// ============================================================
//  双源聚合搜索引擎
// ============================================================
const BookSearch = {
  cache: {},

  async search(query) {
    if (!query.trim()) return [];
    const key = query.trim().toLowerCase();
    if (this.cache[key]) return this.cache[key];

    // 同时查两个源
    const [google, openlib] = await Promise.allSettled([
      this.searchGoogle(query),
      this.searchOpenLibrary(query)
    ]);

    const results = [];
    if (google.status === 'fulfilled') results.push(...google.value);
    if (openlib.status === 'fulfilled') results.push(...openlib.value);

    // 去重（按书名相似度）
    const merged = this.dedup(results);
    this.cache[key] = merged;
    return merged;
  },

  // Google Books API（中文覆盖好，免费无需 Key）
  async searchGoogle(query) {
    const results = [];
    try {
      // 同时搜中文版和原版
      const queries = [encodeURIComponent(query)];
      // 如果输入是中文，额外搜一次不限语言
      if (/[\u4e00-\u9fff]/.test(query)) {
        queries.push(encodeURIComponent(query));
      }

      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${queries[0]}&maxResults=20&printType=books`
      );
      const data = await res.json();

      if (data.items) {
        for (const item of data.items) {
          const v = item.volumeInfo;
          const cover = v.imageLinks?.thumbnail?.replace('http:','https:')
                     || v.imageLinks?.smallThumbnail?.replace('http:','https:')
                     || '';
          results.push({
            title: v.title || '',
            subtitle: v.subtitle || '',
            author: (v.authors || []).join(', '),
            cover: cover ? cover.replace('&zoom=1','') : '',
            description: (v.description || '').replace(/<[^>]*>/g, '').substring(0, 300),
            year: v.publishedDate?.substring(0, 4) || '',
            pages: v.pageCount || 0,
            publisher: v.publisher || '',
            isbn: (v.industryIdentifiers || []).find(i => i.type === 'ISBN_13')?.identifier
                || (v.industryIdentifiers || []).find(i => i.type === 'ISBN_10')?.identifier
                || '',
            categories: (v.categories || []).join(', '),
            source: 'Google Books'
          });
        }
      }
    } catch (e) {
      console.warn('Google Books 搜索失败:', e);
    }
    return results;
  },

  // Open Library Search API（英文覆盖好）
  async searchOpenLibrary(query) {
    const results = [];
    try {
      const res = await fetch(
        `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=15&fields=title,author_name,cover_i,first_publish_year,isbn,publisher,subject,number_of_pages_median`
      );
      const data = await res.json();

      if (data.docs) {
        for (const doc of data.docs) {
          results.push({
            title: doc.title || '',
            subtitle: '',
            author: (doc.author_name || []).join(', '),
            cover: doc.cover_i
              ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`
              : '',
            description: (doc.subject || []).slice(0, 8).join(' · '),
            year: doc.first_publish_year ? String(doc.first_publish_year) : '',
            pages: doc.number_of_pages_median || 0,
            publisher: (doc.publisher || [])[0] || '',
            isbn: (doc.isbn || [])[0] || '',
            categories: (doc.subject || []).slice(0, 3).join(', '),
            source: 'Open Library'
          });
        }
      }
    } catch (e) {
      console.warn('Open Library 搜索失败:', e);
    }
    return results;
  },

  // 去重：书名完全相同或高度相似的保留封面更好的
  dedup(results) {
    const map = new Map();
    for (const r of results) {
      const key = r.title.replace(/\s+/g, '').toLowerCase();
      if (!key) continue;
      if (map.has(key)) {
        const existing = map.get(key);
        // 保留有封面的、信息更全的
        if (!existing.cover && r.cover) map.set(key, r);
        else if (r.description.length > existing.description.length && r.cover) map.set(key, r);
      } else {
        map.set(key, r);
      }
    }
    return [...map.values()];
  }
};

// ============================================================
//  主应用
// ============================================================
class App {
  constructor() {
    this.filter = 'all';
    this.selectedTopics = [];
    this.quickAddStatus = 'wishlist';
    this.quickAddRating = 0;
    this.init();
  }

  init() {
    this.bindNav();
    this.bindFab();
    this.bindExplore();
    this.bindBookForm();
    this.bindNoteForm();
    this.bindTopicForm();
    this.bindQuickAdd();
    this.bindSettings();
    this.bindSearch();
    this.renderBooks();
  }

  // ===== 导航 =====
  bindNav() {
    document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const v = btn.dataset.view;
        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        document.getElementById(`view-${v}`).classList.add('active');
        const titles = {books:'书架',explore:'书库',topics:'人生课题',settings:'设置'};
        document.getElementById('page-title').textContent = titles[v] || '';
        if (v === 'topics') this.renderTopics();
        if (v === 'settings') this.renderStats();
      });
    });
    document.getElementById('btn-search-toggle').addEventListener('click', () => {
      const bar = document.getElementById('search-bar');
      bar.classList.toggle('open');
      if (bar.classList.contains('open')) document.getElementById('searchInput').focus();
    });
    document.querySelectorAll('.chip').forEach(c => {
      c.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
        this.filter = c.dataset.filter;
        this.renderBooks();
      });
    });
  }

  // ===== FAB =====
  bindFab() {
    const menu = document.getElementById('fab-menu');
    const overlay = document.getElementById('overlay');
    const toggle = () => { menu.classList.toggle('open'); overlay.classList.toggle('open'); };
    document.getElementById('btn-add').addEventListener('click', toggle);
    overlay.addEventListener('click', toggle);
    document.querySelectorAll('.fab-option').forEach(o => {
      o.addEventListener('click', () => {
        toggle();
        if (o.dataset.action === 'add-book') this.openBookForm();
        if (o.dataset.action === 'add-note') this.openNoteForm();
      });
    });
  }

  // ======================================================
  //  书库搜索（核心新功能）
  // ======================================================
  bindExplore() {
    const queryInput = document.getElementById('explore-query');
    const searchBtn = document.getElementById('btn-explore-search');

    const doSearch = () => {
      const q = queryInput.value.trim();
      if (q) this.doExploreSearch(q);
    };

    searchBtn.addEventListener('click', doSearch);
    queryInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });

    // 快捷标签
    document.querySelectorAll('.explore-tip').forEach(tip => {
      tip.addEventListener('click', () => {
        queryInput.value = tip.dataset.q;
        this.doExploreSearch(tip.dataset.q);
      });
    });
  }

  async doExploreSearch(query) {
    const statusEl = document.getElementById('explore-status');
    const resultsEl = document.getElementById('explore-results');

    statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在搜索书库…';
    resultsEl.innerHTML = '';

    try {
      const results = await BookSearch.search(query);

      if (results.length === 0) {
        statusEl.innerHTML = '<i class="fas fa-search"></i> 未找到结果，试试其他关键词';
        return;
      }

      statusEl.innerHTML = `<i class="fas fa-check"></i> 找到 ${results.length} 本相关书籍`;
      const myBooks = DB.getBooks();

      resultsEl.innerHTML = results.map((r, i) => {
        // 检查是否已在书架
        const inShelf = myBooks.find(b =>
          b.title.replace(/\s+/g,'').toLowerCase() === r.title.replace(/\s+/g,'').toLowerCase()
        );

        return `<div class="explore-card" data-idx="${i}">
          <div class="ec-cover">
            ${r.cover
              ? `<img src="${r.cover}" alt="" loading="lazy" onerror="this.outerHTML='<span class=no-cover>📖</span>'">`
              : '<span class="no-cover">📖</span>'}
          </div>
          <div class="ec-info">
            <div class="ec-title">${r.title}${r.subtitle ? '：'+r.subtitle : ''}</div>
            <div class="ec-author">${r.author || '未知作者'}</div>
            <div class="ec-meta">
              ${r.year ? `<span><i class="far fa-calendar"></i> ${r.year}</span>` : ''}
              ${r.pages ? `<span><i class="far fa-file"></i> ${r.pages}页</span>` : ''}
              ${r.publisher ? `<span>${r.publisher}</span>` : ''}
            </div>
            <div class="ec-desc">${r.description || '暂无简介'}</div>
          </div>
          <span class="ec-source">${r.source}</span>
          ${inShelf
            ? `<span class="ec-in-shelf"><i class="fas fa-check"></i> ${ST[inShelf.status]}</span>`
            : `<button class="ec-add-btn" data-idx="${i}"><i class="fas fa-plus"></i> 加入</button>`}
        </div>`;
      }).join('');

      // 绑定"加入"按钮
      resultsEl.querySelectorAll('.ec-add-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.idx);
          this.openQuickAdd(results[idx]);
        });
      });

      // 点击卡片也能加入（如果不在书架）
      resultsEl.querySelectorAll('.explore-card').forEach(card => {
        card.addEventListener('click', () => {
          const idx = parseInt(card.dataset.idx);
          const r = results[idx];
          const inShelf = myBooks.find(b =>
            b.title.replace(/\s+/g,'').toLowerCase() === r.title.replace(/\s+/g,'').toLowerCase()
          );
          if (!inShelf) this.openQuickAdd(r);
        });
      });

    } catch (err) {
      console.error(err);
      statusEl.innerHTML = '<i class="fas fa-exclamation-triangle"></i> 搜索失败，请检查网络';
    }
  }

  // ===== 快速加入书架 =====
  bindQuickAdd() {
    // 状态切换
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.status-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.quickAddStatus = btn.dataset.status;
      });
    });

    // 星星评分
    document.querySelectorAll('#star-picker .star').forEach(star => {
      star.addEventListener('click', () => {
        this.quickAddRating = parseInt(star.dataset.v);
        document.querySelectorAll('#star-picker .star').forEach(s =>
          s.classList.toggle('lit', parseInt(s.dataset.v) <= this.quickAddRating)
        );
      });
    });

    // 提交
    document.getElementById('form-quick-add').addEventListener('submit', e => {
      e.preventDefault();
      const data = JSON.parse(document.getElementById('quick-book-data').value);
      const books = DB.getBooks();

      // 检查重复
      const dup = books.find(b =>
        b.title.replace(/\s+/g,'').toLowerCase() === data.title.replace(/\s+/g,'').toLowerCase()
      );
      if (dup) { toast('这本书已在书架中'); closeModal('modal-quick-add'); return; }

      books.unshift({
        id: DB.genId(),
        title: data.title,
        author: data.author,
        cover: data.cover,
        description: data.description,
        status: this.quickAddStatus,
        rating: this.quickAddRating,
        dateAdded: new Date().toISOString().split('T')[0]
      });
      DB.setBooks(books);
      closeModal('modal-quick-add');
      this.renderBooks();
      // 刷新书库搜索结果中的状态
      const q = document.getElementById('explore-query').value.trim();
      if (q) this.doExploreSearch(q);
      toast(`✅ 已加入「${ST[this.quickAddStatus]}」`);
    });
  }

  openQuickAdd(bookData) {
    this.quickAddStatus = 'wishlist';
    this.quickAddRating = 0;

    document.querySelectorAll('.status-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.status === 'wishlist')
    );
    document.querySelectorAll('#star-picker .star').forEach(s => s.classList.remove('lit'));

    document.getElementById('quick-add-preview').innerHTML = `
      ${bookData.cover ? `<img src="${bookData.cover}" alt="">` : ''}
      <div class="qa-info">
        <div class="qa-title">${bookData.title}</div>
        <div class="qa-author">${bookData.author || ''}</div>
      </div>`;

    document.getElementById('quick-book-data').value = JSON.stringify(bookData);
    openModal('modal-quick-add');
  }

  // ===== 手动添加书籍 =====
  bindBookForm() {
    const coverInput = document.getElementById('book-cover');
    coverInput.addEventListener('input', () => {
      const url = coverInput.value.trim();
      document.getElementById('cover-preview').innerHTML = url ? `<img src="${url}" onerror="this.remove()">` : '';
    });
    document.getElementById('form-book').addEventListener('submit', e => this.saveBook(e));
  }

  openBookForm(book = null) {
    document.getElementById('form-book').reset();
    document.getElementById('book-edit-id').value = '';
    document.getElementById('cover-preview').innerHTML = '';
    document.getElementById('modal-book-title').textContent = book ? '编辑书籍' : '手动添加';
    if (book) {
      document.getElementById('book-edit-id').value = book.id;
      document.getElementById('book-title').value = book.title;
      document.getElementById('book-author').value = book.author || '';
      document.getElementById('book-cover').value = book.cover || '';
      document.getElementById('book-desc').value = book.description || '';
      document.getElementById('book-status').value = book.status;
      document.getElementById('book-rating').value = book.rating || 5;
      if (book.cover) document.getElementById('cover-preview').innerHTML = `<img src="${book.cover}" onerror="this.remove()">`;
    }
    openModal('modal-book');
  }

  saveBook(e) {
    e.preventDefault();
    const books = DB.getBooks();
    const editId = document.getElementById('book-edit-id').value;
    const data = {
      id: editId || DB.genId(),
      title: document.getElementById('book-title').value.trim(),
      author: document.getElementById('book-author').value.trim(),
      cover: document.getElementById('book-cover').value.trim(),
      description: document.getElementById('book-desc').value.trim(),
      status: document.getElementById('book-status').value,
      rating: parseInt(document.getElementById('book-rating').value),
      dateAdded: new Date().toISOString().split('T')[0]
    };
    if (editId) {
      const idx = books.findIndex(b => b.id === editId);
      if (idx >= 0) { data.dateAdded = books[idx].dateAdded; books[idx] = data; }
    } else { books.unshift(data); }
    DB.setBooks(books);
    closeModal('modal-book');
    this.renderBooks();
    toast(editId ? '✅ 已更新' : '✅ 已添加');
  }

  deleteBook(id) {
    if (!confirm('确定删除这本书及所有笔记？')) return;
    DB.setBooks(DB.getBooks().filter(b => b.id !== id));
    DB.setNotes(DB.getNotes().filter(n => n.bookId !== id));
    closeModal('modal-detail');
    this.renderBooks();
    toast('🗑️ 已删除');
  }

  // ===== 渲染书架 =====
  renderBooks(q = '') {
    const grid = document.getElementById('books-grid');
    let books = DB.getBooks();
    const notes = DB.getNotes();
    if (this.filter !== 'all') books = books.filter(b => b.status === this.filter);
    if (q) {
      const lq = q.toLowerCase();
      books = books.filter(b => b.title.toLowerCase().includes(lq) || (b.author||'').toLowerCase().includes(lq));
    }
    if (!books.length) {
      grid.innerHTML = `<div class="empty-state"><i class="fas fa-book-open"></i><p>${q ? '没有匹配' : '书架空空'}</p><p style="font-size:.85rem">去「书库」搜索添加吧</p></div>`;
      return;
    }
    grid.innerHTML = books.map(b => {
      const cnt = notes.filter(n => n.bookId === b.id).length;
      return `<div class="book-card" data-id="${b.id}">
        <span class="badge ${b.status}"></span>
        ${cnt ? `<span class="nc">${cnt}</span>` : ''}
        <div class="cover">
          ${b.cover
            ? `<img src="${b.cover}" alt="" loading="lazy" onerror="this.outerHTML='<div class=ph><i class=fas fa-book></i><span>${b.title}</span></div>'">`
            : `<div class="ph"><i class="fas fa-book"></i><span>${b.title}</span></div>`}
        </div>
        <div class="info"><div class="t">${b.title}</div><div class="a">${b.author||''}</div></div>
      </div>`;
    }).join('');
    grid.querySelectorAll('.book-card').forEach(c =>
      c.addEventListener('click', () => this.showBookDetail(c.dataset.id))
    );
  }

  showBookDetail(id) {
    const book = DB.getBooks().find(b => b.id === id);
    if (!book) return;
    const notes = DB.getNotes().filter(n => n.bookId === id);
    document.getElementById('detail-content').innerHTML = `
      <div class="detail-header">
        ${book.cover ? `<img src="${book.cover}" alt="">` : ''}
        <div class="detail-info">
          <h2>${book.title}</h2>
          <div class="author">${book.author||''}</div>
          <div class="desc">${book.description||'暂无简介'}</div>
          <div class="detail-meta">
            <span class="status ${book.status}">${ST[book.status]}</span>
            <span class="stars">${'★'.repeat(book.rating||0)}${'☆'.repeat(5-(book.rating||0))}</span>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button onclick="app.openNoteForm(null,'${book.id}')"><i class="fas fa-plus"></i> 写笔记</button>
        <button onclick="app.openBookForm(DB.getBooks().find(b=>b.id==='${book.id}'))"><i class="fas fa-edit"></i> 编辑</button>
        <button class="del-btn" onclick="app.deleteBook('${book.id}')"><i class="fas fa-trash"></i> 删除</button>
      </div>
      <div class="detail-section"><h3>笔记 (${notes.length})</h3>
        ${notes.length ? notes.map(n => this.noteHTML(n,false)).join('') : '<p style="color:var(--text2);text-align:center;padding:20px">还没有笔记</p>'}
      </div>`;
    openModal('modal-detail');
    this._bindNoteActions('#detail-content', () => this.showBookDetail(id));
  }

  // ===== 笔记 =====
  bindNoteForm() {
    document.getElementById('form-note').addEventListener('submit', e => this.saveNote(e));
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('note-type').value = btn.dataset.type;
      });
    });
  }

  openNoteForm(note = null, preBookId = null) {
    document.getElementById('form-note').reset();
    this.selectedTopics = [];
    document.getElementById('note-edit-id').value = '';
    document.getElementById('note-type').value = 'quote';
    document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === 'quote'));
    const sel = document.getElementById('note-book');
    sel.innerHTML = '<option value="">— 请选择 —</option>' + DB.getBooks().map(b => `<option value="${b.id}">${b.title}</option>`).join('');
    if (preBookId) sel.value = preBookId;
    if (note) {
      document.getElementById('note-edit-id').value = note.id;
      sel.value = note.bookId;
      document.getElementById('note-type').value = note.type;
      document.getElementById('note-content').value = note.content;
      document.getElementById('note-comment').value = note.comment || '';
      document.getElementById('note-page').value = note.page || '';
      this.selectedTopics = [...(note.topics || [])];
      document.querySelectorAll('.type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === note.type));
    }
    this.renderTopicPicker();
    openModal('modal-note');
  }

  renderTopicPicker() {
    const topics = DB.getTopics();
    const c = document.getElementById('topic-picker');
    if (!topics.length) { c.innerHTML = '<span style="color:var(--text2);font-size:.85rem">还没有课题，去"课题"页创建</span>'; return; }
    c.innerHTML = topics.map(t => `<button type="button" class="topic-pick-btn ${this.selectedTopics.includes(t.id)?'selected':''}" data-tid="${t.id}"><span class="dot" style="background:${t.color}"></span> ${t.name}</button>`).join('');
    c.querySelectorAll('.topic-pick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tid = btn.dataset.tid;
        this.selectedTopics = this.selectedTopics.includes(tid) ? this.selectedTopics.filter(x=>x!==tid) : [...this.selectedTopics, tid];
        this.renderTopicPicker();
      });
    });
  }

  saveNote(e) {
    e.preventDefault();
    const notes = DB.getNotes();
    const editId = document.getElementById('note-edit-id').value;
    const data = {
      id: editId || DB.genId(),
      bookId: document.getElementById('note-book').value,
      type: document.getElementById('note-type').value,
      content: document.getElementById('note-content').value.trim(),
      comment: document.getElementById('note-comment').value.trim(),
      topics: [...this.selectedTopics],
      page: document.getElementById('note-page').value || null,
      dateAdded: new Date().toISOString().split('T')[0]
    };
    if (editId) { const idx = notes.findIndex(n=>n.id===editId); if(idx>=0){data.dateAdded=notes[idx].dateAdded;notes[idx]=data;} }
    else { notes.unshift(data); }
    DB.setNotes(notes);
    closeModal('modal-note');
    this.renderBooks();
    toast(editId ? '✅ 已更新' : '✅ 已保存');
  }

  deleteNote(id) {
    if (!confirm('删除这条笔记？')) return;
    DB.setNotes(DB.getNotes().filter(n => n.id !== id));
    this.renderBooks();
    toast('🗑️ 已删除');
  }

  noteHTML(note, showSource = true) {
    const book = DB.getBooks().find(b => b.id === note.bookId);
    const topics = DB.getTopics();
    const tNames = (note.topics||[]).map(tid => topics.find(t=>t.id===tid)).filter(Boolean);
    return `<div class="note-card ${note.type}">
      <div class="note-actions">
        <button class="edit-note" data-id="${note.id}"><i class="fas fa-edit"></i></button>
        <button class="del-note" data-id="${note.id}"><i class="fas fa-trash"></i></button>
      </div>
      ${showSource && book ? `<div class="note-source">${book.cover?`<img src="${book.cover}" alt="">`:''}<div><div class="sb">${book.title}</div><div class="sm">${book.author||''} · P${note.page||'?'} · ${note.dateAdded}</div></div></div>`
        : `<div class="sm" style="margin-bottom:6px;font-size:.78rem;color:var(--text2)">P${note.page||'?'} · ${note.dateAdded}</div>`}
      <div class="note-text">${note.content}</div>
      ${note.comment ? `<div class="note-comment">${note.comment}</div>` : ''}
      ${tNames.length ? `<div class="note-tags">${tNames.map(t=>`<span class="mini-tag" style="background:${t.color}22;color:${t.color}">#${t.name}</span>`).join('')}</div>` : ''}
    </div>`;
  }

  _bindNoteActions(sel, refresh) {
    document.querySelectorAll(`${sel} .edit-note`).forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); const n = DB.getNotes().find(x=>x.id===btn.dataset.id); if(n){closeModal('modal-detail');this.openNoteForm(n);} });
    });
    document.querySelectorAll(`${sel} .del-note`).forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); this.deleteNote(btn.dataset.id); if(refresh)refresh(); });
    });
  }

  // ===== 人生课题 =====
  bindTopicForm() {
    document.getElementById('btn-new-topic').addEventListener('click', () => this.openTopicForm());
    document.querySelectorAll('.color-dot').forEach(d => {
      d.addEventListener('click', () => {
        document.querySelectorAll('.color-dot').forEach(x => x.classList.remove('active'));
        d.classList.add('active');
        document.getElementById('topic-color').value = d.dataset.color;
      });
    });
    document.getElementById('form-topic').addEventListener('submit', e => this.saveTopic(e));
  }

  openTopicForm(topic = null) {
    document.getElementById('form-topic').reset();

// ===== 数据库层 =====
const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; }
    catch { return []; }
  },
  set(key, data) { localStorage.setItem(key, JSON.stringify(data)); },
  getBooks() { return this.get('lib_books'); },
  setBooks(d) { this.set('lib_books', d); },
  getNotes() { return this.get('lib_notes'); },
  setNotes(d) { this.set('lib_notes', d); },
  genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
  exportAll() {
    return JSON.stringify({
      books: this.getBooks(),
      notes: this.getNotes(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  },
  importAll(json) {
    const data = JSON.parse(json);
    if (data.books) this.setBooks(data.books);
    if (data.notes) this.setNotes(data.notes);
  }
};

// ===== 工具函数 =====
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2000);
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

const statusText = { reading: '在读', finished: '已读', wishlist: '想读' };

// ===== 主应用 =====
class App {
  constructor() {
    this.currentFilter = 'all';
    this.currentTheme = null;
    this.noteTags = [];
    this.init();
  }

  init() {
    this.bindNav();
    this.bindFab();
    this.bindForms();
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
        const view = btn.dataset.view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view-${view}`).classList.add('active');
        const titles = { books: '书架', themes: '主题', settings: '设置' };
        document.getElementById('page-title').textContent = titles[view] || '';
        if (view === 'themes') this.renderThemes();
        if (view === 'settings') this.renderStats();
      });
    });

    // 搜索开关
    document.getElementById('btn-search-toggle').addEventListener('click', () => {
      const bar = document.getElementById('search-bar');
      bar.classList.toggle('open');
      if (bar.classList.contains('open')) {
        document.getElementById('searchInput').focus();
      }
    });

    // 过滤
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentFilter = chip.dataset.filter;
        this.renderBooks();
      });
    });
  }

  // ===== FAB 菜单 =====
  bindFab() {
    const fab = document.getElementById('btn-add');
    const menu = document.getElementById('fab-menu');
    const overlay = document.getElementById('overlay');

    const toggle = () => {
      menu.classList.toggle('open');
      overlay.classList.toggle('open');
    };

    fab.addEventListener('click', toggle);
    overlay.addEventListener('click', toggle);

    document.querySelectorAll('.fab-option').forEach(opt => {
      opt.addEventListener('click', () => {
        toggle();
        if (opt.dataset.action === 'add-book') this.openBookForm();
        if (opt.dataset.action === 'add-note') this.openNoteForm();
      });
    });
  }

  // ===== 书籍表单 =====
  openBookForm(book = null) {
    const form = document.getElementById('form-book');
    form.reset();
    document.getElementById('book-edit-id').value = '';

    if (book) {
      document.getElementById('book-edit-id').value = book.id;
      document.getElementById('book-title').value = book.title;
      document.getElementById('book-author').value = book.author || '';
      document.getElementById('book-cover').value = book.cover || '';
      document.getElementById('book-desc').value = book.description || '';
      document.getElementById('book-status').value = book.status;
      document.getElementById('book-rating').value = book.rating || 5;
      document.getElementById('book-isbn').value = book.isbn || '';
    }
    openModal('modal-book');
  }

  async fetchBookInfo() {
    const query = document.getElementById('book-query').value.trim();
    if (!query) return toast('请输入 ISBN 或书名');

    const btn = document.getElementById('btn-fetch-book');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    try {
      let data = null;

      // 尝试 ISBN
      if (/^\d{10,13}$/.test(query.replace(/-/g, ''))) {
        const isbn = query.replace(/-/g, '');
        try {
          const res = await fetch(
            `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`
          );
          const json = await res.json();
          const key = `ISBN:${isbn}`;
          if (json[key]) {
            const b = json[key];
            data = {
              title: b.title || '',
              authors: (b.authors || []).map(a => a.name).join(', '),
              cover: b.cover?.large || b.cover?.medium || '',
              description: b.excerpts?.[0]?.text ||
                           (b.subjects || []).map(s => s.name).slice(0, 5).join('、')
            };
          }
        } catch {}
      }

      // 回退：Google Books
      if (!data) {
        try {
          const res = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=1`
          );
          const json = await res.json();
          if (json.items?.[0]) {
            const info = json.items[0].volumeInfo;
            data = {
              title: info.title || '',
              authors: (info.authors || []).join(', '),
              cover: info.imageLinks?.thumbnail?.replace('http:', 'https:') || '',
              description: (info.description || '').substring(0, 300)
            };
          }
        } catch {}
      }

      if (data) {
        document.getElementById('book-title').value = data.title;
        document.getElementById('book-author').value = data.authors;
        document.getElementById('book-cover').value = data.cover;
        document.getElementById('book-desc').value = data.description;
        toast('✅ 获取成功！');
      } else {
        toast('未找到，请手动填写');
      }
    } finally {
      btn.innerHTML = '<i class="fas fa-search"></i> 自动获取';
    }
  }

  saveBook(e) {
    e.preventDefault();
    const books = DB.getBooks();
    const editId = document.getElementById('book-edit-id').value;

    const bookData = {
      id: editId || DB.genId(),
      isbn: document.getElementById('book-isbn').value,
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
      if (idx >= 0) {
        bookData.dateAdded = books[idx].dateAdded;
        books[idx] = bookData;
      }
    } else {
      books.unshift(bookData);
    }

    DB.setBooks(books);
    closeModal('modal-book');
    this.renderBooks();
    toast(editId ? '✅ 已更新' : '✅ 已添加');
  }

  deleteBook(id) {
    if (!confirm('确定删除这本书及其所有笔记？')) return;
    DB.setBooks(DB.getBooks().filter(b => b.id !== id));
    DB.setNotes(DB.getNotes().filter(n => n.bookId !== id));
    closeModal('modal-detail');
    this.renderBooks();
    toast('🗑️ 已删除');
  }

  // ===== 笔记表单 =====
  openNoteForm(note = null, preselectBookId = null) {
    const form = document.getElementById('form-note');
    form.reset();
    this.noteTags = [];
    document.getElementById('note-edit-id').value = '';
    document.getElementById('note-type').value = 'quote';

    // 填充书籍下拉
    const sel = document.getElementById('note-book');
    const books = DB.getBooks();
    sel.innerHTML = '<option value="">— 请选择 —</option>' +
      books.map(b => `<option value="${b.id}">${b.title}</option>`).join('');

    if (preselectBookId) sel.value = preselectBookId;

    // 类型按钮
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === 'quote');
    });

    if (note) {
      document.getElementById('note-edit-id').value = note.id;
      sel.value = note.bookId;
      document.getElementById('note-type').value = note.type;
      document.getElementById('note-content').value = note.content;
      document.getElementById('note-comment').value = note.comment || '';
      document.getElementById('note-page').value = note.page || '';
      this.noteTags = [...(note.themes || [])];
      document.querySelectorAll('.type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === note.type);
      });
    }

    this.renderTagInput();
    this.renderExistingTags();
    openModal('modal-note');
  }

  renderTagInput() {
    const container = document.getElementById('selected-tags');
    container.innerHTML = this.noteTags.map(t =>
      `<span class="sel-tag">#${t} <span class="remove" data-tag="${t}">×</span></span>`
    ).join('');

    container.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.noteTags = this.noteTags.filter(t => t !== btn.dataset.tag);
        this.renderTagInput();
      });
    });
  }

  renderExistingTags() {
    const allTags = new Set();
    DB.getNotes().forEach(n => (n.themes || []).forEach(t => allTags.add(t)));
    const container = document.getElementById('existing-tags');
    container.innerHTML = [...allTags]
      .filter(t => !this.noteTags.includes(t))
      .map(t => `<span class="etag" data-tag="${t}">#${t}</span>`)
      .join('');

    container.querySelectorAll('.etag').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.noteTags.includes(btn.dataset.tag)) {
          this.noteTags.push(btn.dataset.tag);
          this.renderTagInput();
          this.renderExistingTags();
        }
      });
    });
  }

  saveNote(e) {
    e.preventDefault();
    const notes = DB.getNotes();
    const editId = document.getElementById('note-edit-id').value;

    const noteData = {
      id: editId || DB.genId(),
      bookId: document.getElementById('note-book').value,
      type: document.getElementById('note-type').value,
      content: document.getElementById('note-content').value.trim(),
      comment: document.getElementById('note-comment').value.trim(),
      themes: [...this.noteTags],
      page: document.getElementById('note-page').value || null,
      dateAdded: new Date().toISOString().split('T')[0]
    };

    if (editId) {
      const idx = notes.findIndex(n => n.id === editId);
      if (idx >= 0) {
        noteData.dateAdded = notes[idx].dateAdded;
        notes[idx] = noteData;
      }
    } else {
      notes.unshift(noteData);
    }

    DB.setNotes(notes);
    closeModal('modal-note');
    this.renderBooks();
    toast(editId ? '✅ 笔记已更新' : '✅ 笔记已保存');
  }

  deleteNote(id) {
    if (!confirm('确定删除这条笔记？')) return;
    DB.setNotes(DB.getNotes().filter(n => n.id !== id));
    this.renderBooks();
    toast('🗑️ 已删除');
  }

  // ===== 渲染书架 =====
  renderBooks(searchQuery = '') {
    const grid = document.getElementById('books-grid');
    let books = DB.getBooks();
    const notes = DB.getNotes();

    if (this.currentFilter !== 'all') {
      books = books.filter(b => b.status === this.currentFilter);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      books = books.filter(b =>
        b.title.toLowerCase().includes(q) ||
        (b.author || '').toLowerCase().includes(q)
      );
    }

    if (books.length === 0) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <i class="fas fa-book-open"></i>
          <p>${searchQuery ? '没有匹配的书' : '书架空空如也'}</p>
          <p style="font-size:0.85rem; margin-top:4px;">点击 ➕ 添加第一本书吧</p>
        </div>`;
      return;
    }

    grid.innerHTML = books.map(book => {
      const cnt = notes.filter(n => n.bookId === book.id).length;
      return `
        <div class="book-card" data-id="${book.id}">
          <span class="badge ${book.status}"></span>
          ${cnt ? `<span class="note-count">${cnt}</span>` : ''}
          <div class="cover">
            ${book.cover
              ? `<img src="${book.cover}" alt="" loading="lazy"
                   onerror="this.outerHTML='<div class=placeholder><i class=fas fa-book></i><span>${book.title}</span></div>'">`
              : `<div class="placeholder"><i class="fas fa-book"></i><span>${book.title}</span></div>`
            }
          </div>
          <div class="info">
            <div class="title">${book.title}</div>
            <div class="author">${book.author || ''}</div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('.book-card').forEach(card => {
      card.addEventListener('click', () => this.showBookDetail(card.dataset.id));
    });
  }

  // ===== 书籍详情 =====
  showBookDetail(bookId) {
    const book = DB.getBooks().find(b => b.id === bookId);
    if (!book) return;
    const notes = DB.getNotes().filter(n => n.bookId === bookId);

    document.getElementById('detail-content').innerHTML = `
      <div class="detail-header">
        ${book.cover ? `<img src="${book.cover}" alt="">` : ''}
        <div class="detail-info">
          <h2>${book.title}</h2>
          <div class="author">${book.author || ''}</div>
          <div class="desc">${book.description || '暂无简介'}</div>
          <div class="detail-meta">
            <span class="status ${book.status}">${statusText[book.status]}</span>
            <span class="stars">${'★'.repeat(book.rating || 0)}${'☆'.repeat(5 - (book.rating || 0))}</span>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button onclick="app.openNoteForm(null, '${book.id}')">
          <i class="fas fa-plus"></i> 写笔记
        </button>
        <button onclick="app.openBookForm(DB.getBooks().find(b=>b.id==='${book.id}'))">
          <i class="fas fa-edit"></i> 编辑
        </button>
        <button class="del-btn" onclick="app.deleteBook('${book.id}')">
          <i class="fas fa-trash"></i> 删除
        </button>
      </div>
      <div class="detail-section">
        <h3>笔记 (${notes.length})</h3>
        ${notes.length ? notes.map(n => this.noteCardHTML(n, false)).join('')
          : '<p style="color:var(--text2);text-align:center;padding:20px;">还没有笔记</p>'}
      </div>`;

    openModal('modal-detail');

    // 绑定笔记操作
    document.querySelectorAll('#detail-content .edit-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const note = DB.getNotes().find(n => n.id === btn.dataset.id);
        if (note) { closeModal('modal-detail'); this.openNoteForm(note); }
      });
    });
    document.querySelectorAll('#detail-content .del-note').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteNote(btn.dataset.id);
        this.showBookDetail(bookId);
      });
    });
  }

  // ===== 笔记卡片 HTML =====
  noteCardHTML(note, showSource = true) {
    const book = DB.getBooks().find(b => b.id === note.bookId);
    return `
      <div class="note-card ${note.type}">
        <div class="note-actions">
          <button class="edit-note" data-id="${note.id}"><i class="fas fa-edit"></i></button>
          <button class="del-note" data-id="${note.id}"><i class="fas fa-trash"></i></button>
        </div>
        ${showSource && book ? `
          <div class="note-source">
            ${book.cover ? `<img src="${book.cover}" alt="">` : ''}
            <div>
              <div class="src-book">${book.title}</div>
              <div class="src-meta">${book.author || ''} · P${note.page || '?'} · ${note.dateAdded}</div>
            </div>
          </div>` : `
          <div class="src-meta" style="margin-bottom:6px;font-size:0.78rem;color:var(--text2);">
            P${note.page || '?'} · ${note.dateAdded}
          </div>`}
        <div class="note-text">${note.content}</div>
        ${note.comment ? `<div class="note-comment">${note.comment}</div>` : ''}
        <div class="note-tags">
          ${(note.themes || []).map(t => `<span class="mini-tag">#${t}</span>`).join('')}
        </div>
      </div>`;
  }

  // ===== 渲染主题 =====
  renderThemes() {
    const notes = DB.getNotes();
    const map = {};
    notes.forEach(n => (n.themes || []).forEach(t => {
      if (!map[t]) map[t] = [];
      map[t].push(n);
    }));

    const sorted = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
    const cloud = document.getElementById('theme-cloud');

    if (sorted.length === 0) {
      cloud.innerHTML = '<p style="color:var(--text2);font-size:0.9rem;">还没有主题标签，添加笔记时创建吧</p>';
      document.getElementById('theme-content').innerHTML = '';
      return;
    }

    cloud.innerHTML = sorted.map(([t, ns]) =>
      `<button class="theme-tag ${this.currentTheme === t ? 'active' : ''}" data-theme="${t}">
        #${t} <span class="cnt">${ns.length}</span>
      </button>`
    ).join('');

    cloud.querySelectorAll('.theme-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        cloud.querySelectorAll('.theme-tag').forEach(t => t.classList.remove('active'));
        tag.classList.add('active');
        this.currentTheme = tag.dataset.theme;
        this.renderThemeNotes(tag.dataset.theme);
      });
    });

    if (this.currentTheme && map[this.currentTheme]) {
      this.renderThemeNotes(this.currentTheme);
    } else {
      document.getElementById('theme-content').innerHTML = `
        <div class="empty-hint">
          <i class="fas fa-hand-pointer"></i>
          <p>点击主题标签查看相关笔记</p>
        </div>`;
    }
  }

  renderThemeNotes(theme) {
    const notes = DB.getNotes().filter(n => (n.themes || []).includes(theme));
    const books = new Set(notes.map(n => n.bookId));
    const container = document.getElementById('theme-content');

    container.innerHTML = `
      <div class="theme-title">
        <i class="fas fa-hashtag"></i> ${theme}
        <small>${books.size} 本书 · ${notes.length} 条笔记</small>
      </div>
      ${notes.map(n => this.noteCardHTML(n, true)).join('')}`;

    container.querySelectorAll('.edit-note').forEach(btn => {
      btn.addEventListener('click', () => {
        const note = DB.getNotes().find(n => n.id === btn.dataset.id);
        if (note) this.openNoteForm(note);
      });
    });
    container.querySelectorAll('.del-note').forEach(btn => {
      btn.addEventListener('click', () => {
        this.deleteNote(btn.dataset.id);
        this.renderThemes();
      });
    });
  }

  // ===== 搜索 =====
  bindSearch() {
    let timer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = e.target.value.trim();
        if (this.currentView() === 'books') {
          this.renderBooks(q);
        } else if (this.currentView() === 'themes' && q) {
          const notes = DB.getNotes().filter(n =>
            n.content.toLowerCase().includes(q.toLowerCase()) ||
            (n.comment || '').toLowerCase().includes(q.toLowerCase()) ||
            (n.themes || []).some(t => t.includes(q))
          );
          document.getElementById('theme-content').innerHTML = `
            <div class="theme-title">
              <i class="fas fa-search"></i> 搜索 "${q}"
              <small>${notes.length} 条结果</small>
            </div>
            ${notes.map(n => this.noteCardHTML(n, true)).join('')}`;
        }
      }, 300);
    });
  }

  currentView() {
    const active = document.querySelector('.view.active');
    return active ? active.id.replace('view-', '') : 'books';
  }

  // ===== 设置 =====
  bindSettings() {
    document.getElementById('btn-export').addEventListener('click', () => {
      const data = DB.exportAll();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `library-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('📦 已导出备份');
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          DB.importAll(reader.result);
          this.renderBooks();
          toast('✅ 数据已恢复');
        } catch {
          toast('❌ 文件格式错误');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });

    document.getElementById('btn-clear').addEventListener('click', () => {
      if (confirm('⚠️ 确定清空所有数据？此操作不可撤销！')) {
        localStorage.removeItem('lib_books');
        localStorage.removeItem('lib_notes');
        this.renderBooks();
        toast('🗑️ 已清空');
      }
    });
  }

  renderStats() {
    const books = DB.getBooks();
    const notes = DB.getNotes();
    const themes = new Set();
    notes.forEach(n => (n.themes || []).forEach(t => themes.add(t)));
    document.getElementById('s-books').textContent = books.length;
    document.getElementById('s-notes').textContent = notes.length;
    document.getElementById('s-themes').textContent = themes.size;
  }

  // ===== 表单绑定 =====
  bindForms() {
    document.getElementById('btn-fetch-book').addEventListener('click', () => this.fetchBookInfo());
    document.getElementById('form-book').addEventListener('submit', (e) => this.saveBook(e));
    document.getElementById('form-note').addEventListener('submit', (e) => this.saveNote(e));

    // 类型切换
    document.querySelectorAll('.type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('note-type').value = btn.dataset.type;
      });
    });

    // 标签输入
    document.getElementById('tag-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = e.target.value.trim().replace(/^#/, '');
        if (val && !this.noteTags.includes(val)) {
          this.noteTags.push(val);
          this.renderTagInput();
          this.renderExistingTags();
        }
        e.target.value = '';
      }
    });

    // 点击遮罩关闭模态框
    document.querySelectorAll('.modal').forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal(modal.id);
      });
    });
  }
}

// ===== 启动 =====
const app = new App();

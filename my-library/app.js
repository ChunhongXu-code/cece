const DB={
  _g(k){try{return JSON.parse(localStorage.getItem(k))||[]}catch{return[]}},
  _s(k,d){localStorage.setItem(k,JSON.stringify(d))},
  books(){return this._g('lb')},sBooks(d){this._s('lb',d)},
  notes(){return this._g('ln')},sNotes(d){this._s('ln',d)},
  topics(){return this._g('lt')},sTopics(d){this._s('lt',d)},
  id(){return Date.now().toString(36)+Math.random().toString(36).slice(2,5)},
  exp(){return JSON.stringify({books:this.books(),notes:this.notes(),topics:this.topics()})},
  imp(j){const d=JSON.parse(j);if(d.books)this.sBooks(d.books);if(d.notes)this.sNotes(d.notes);if(d.topics)this.sTopics(d.topics)}
};
function toast(m){const t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);requestAnimationFrame(()=>t.classList.add('show'));setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300)},2000)}
function OM(id){document.getElementById(id).classList.add('open')}
function CM(id){document.getElementById(id).classList.remove('open')}
const ST={reading:'在读',finished:'已读',wishlist:'想读'};

// ===== 搜索（仅用 Open Library，大陆可访问）=====
async function searchBooks(q){
  const clean=q.replace(/[-\s]/g,'');
  const isISBN=/^\d{10,13}$/.test(clean);
  let results=[];
  try{
    if(isISBN){
      const r=await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${clean}&format=json&jscmd=data`);
      const d=await r.json();const k=`ISBN:${clean}`;
      if(d[k]){
        const b=d[k];
        results.push({title:b.title||'',author:(b.authors||[]).map(a=>a.name).join(', '),
          cover:b.cover?.large||b.cover?.medium||`https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`,
          desc:(b.excerpts||[]).map(e=>e.text).join(' ')||(b.subjects||[]).map(s=>s.name).slice(0,5).join('、'),
          year:b.publish_date||''});
      }
    }
    if(results.length===0){
      const r=await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=15&fields=title,author_name,cover_i,first_publish_year,subject,number_of_pages_median`);
      const d=await r.json();
      if(d.docs){
        for(const doc of d.docs){
          results.push({title:doc.title||'',author:(doc.author_name||[]).join(', '),
            cover:doc.cover_i?`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`:'',
            desc:(doc.subject||[]).slice(0,6).join(' · '),
            year:doc.first_publish_year?String(doc.first_publish_year):'',
            pages:doc.number_of_pages_median||0});
        }
      }
    }
  }catch(e){console.error('搜索失败:',e)}
  // 去重
  const map=new Map();
  for(const r of results){const k=r.title.replace(/\s+/g,'').toLowerCase();if(!k)continue;if(!map.has(k))map.set(k,r);else if(!map.get(k).cover&&r.cover)map.set(k,r)}
  return[...map.values()];
}

// ===== 主应用 =====
class App{
  constructor(){
    this.filter='all';this.selTopics=[];this.qStatus='wishlist';
    this.init();
  }
  init(){
    this.bindNav();this.bindFab();this.bindExplore();
    this.bindBookForm();this.bindNoteForm();this.bindTopicForm();
    this.bindQuickAdd();this.bindSettings();this.bindSearch();
    this.renderBooks();
  }

  // 导航
  bindNav(){
    document.querySelectorAll('.ni[data-view]').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('.ni').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
        const v=b.dataset.view;
        document.querySelectorAll('.view').forEach(x=>x.classList.remove('active'));
        document.getElementById('view-'+v).classList.add('active');
        document.getElementById('page-title').textContent={books:'书架',explore:'书库',topics:'人生课题',settings:'设置'}[v]||'';
        if(v==='topics')this.renderTopics();
        if(v==='settings')this.renderStats();
      });
    });
    document.getElementById('btn-search-toggle').addEventListener('click',()=>{
      const b=document.getElementById('search-bar');b.classList.toggle('open');
      if(b.classList.contains('open'))document.getElementById('searchInput').focus();
    });
    document.querySelectorAll('.chip').forEach(c=>{
      c.addEventListener('click',()=>{
        document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));
        c.classList.add('active');this.filter=c.dataset.filter;this.renderBooks();
      });
    });
  }

  // FAB
  bindFab(){
    const m=document.getElementById('fab-menu'),o=document.getElementById('overlay');
    const t=()=>{m.classList.toggle('open');o.classList.toggle('open')};
    document.getElementById('btn-add').addEventListener('click',t);
    o.addEventListener('click',t);
    document.querySelectorAll('.fo').forEach(f=>{
      f.addEventListener('click',()=>{t();if(f.dataset.action==='add-book')this.openBookForm();if(f.dataset.action==='add-note')this.openNoteForm()});
    });
  }

  // 书库搜索
  bindExplore(){
    const qi=document.getElementById('explore-query');
    const go=()=>{const q=qi.value.trim();if(q)this.doExplore(q)};
    document.getElementById('btn-explore').addEventListener('click',go);
    qi.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();go()}});
    document.querySelectorAll('.etag').forEach(t=>{
      t.addEventListener('click',()=>{qi.value=t.dataset.q;this.doExplore(t.dataset.q)});
    });
  }
  async doExplore(q){
    const st=document.getElementById('explore-status');
    const re=document.getElementById('explore-results');
    st.innerHTML='<i class="fas fa-spinner spin"></i> 搜索中…（首次可能需几秒）';
    re.innerHTML='';
    try{
      const results=await searchBooks(q);
      if(!results.length){st.innerHTML='未找到结果，试试其他关键词';return}
      st.innerHTML=`找到 ${results.length} 本`;
      const my=app.books();
      re.innerHTML=results.map((r,i)=>{
        const inS=my.find(b=>b.title.replace(/\s+/g,'').toLowerCase()===r.title.replace(/\s+/g,'').toLowerCase());
        return`<div class="ec">
          <div class="ecc">${r.cover?`<img src="${r.cover}" loading="lazy" onerror="this.outerHTML='📖'">`:'📖'}</div>
          <div class="eci">
            <div class="ect">${r.title}</div>
            <div class="eca">${r.author||'未知'}</div>
            <div class="ecm">${r.year?r.year+'年 ':''}${r.pages?r.pages+'页':''}</div>
            <div class="ecd">${r.desc||'暂无简介'}</div>
          </div>
          ${inS?`<span class="ecis">✓ ${ST[inS.status]}</span>`:`<button class="ecab" data-i="${i}">+ 加入</button>`}
        </div>`;
      }).join('');
      re.querySelectorAll('.ecab').forEach(b=>{
        b.addEventListener('click',e=>{e.stopPropagation();this.openQuickAdd(results[parseInt(b.dataset.i)])});
      });
    }catch(e){st.innerHTML='搜索失败，请检查网络';console.error(e)}
  }

  books(){return DB.books()}

  // 快速加入
  bindQuickAdd(){
    document.querySelectorAll('.stb').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('.stb').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');this.qStatus=b.dataset.s;
        document.getElementById('q-status').value=b.dataset.s;
      });
    });
    document.getElementById('form-quick').addEventListener('submit',e=>{
      e.preventDefault();
      const d=JSON.parse(document.getElementById('q-data').value);
      const books=DB.books();
      if(books.find(b=>b.title.replace(/\s+/g,'').toLowerCase()===d.title.replace(/\s+/g,'').toLowerCase())){
        toast('已在书架');CM('modal-quick');return;
      }
      books.unshift({id:DB.id(),title:d.title,author:d.author,cover:d.cover,description:d.desc,status:this.qStatus,rating:0,dateAdded:new Date().toISOString().split('T')[0]});
      DB.sBooks(books);CM('modal-quick');this.renderBooks();
      const q=document.getElementById('explore-query').value.trim();if(q)this.doExplore(q);
      toast('✅ 已加入');
    });
  }
  openQuickAdd(d){
    this.qStatus='wishlist';
    document.querySelectorAll('.stb').forEach(b=>b.classList.toggle('active',b.dataset.s==='wishlist'));
    document.getElementById('q-preview').innerHTML=`${d.cover?`<img src="${d.cover}">`:''}<div><div class="qt">${d.title}</div><div class="qa">${d.author||''}</div></div>`;
    document.getElementById('q-data').value=JSON.stringify(d);
    OM('modal-quick');
  }

  // 书籍表单
  bindBookForm(){
    document.getElementById('bc').addEventListener('input',e=>{
      const u=e.target.value.trim();
      document.getElementById('cpv').innerHTML=u?`<img src="${u}" onerror="this.remove()">`:'';
    });
    document.getElementById('btn-fetch').addEventListener('click',()=>this.fetchBook());
    document.getElementById('form-book').addEventListener('submit',e=>this.saveBook(e));
  }
  async fetchBook(){
    const q=document.getElementById('bq').value.trim();
    const rd=document.getElementById('fetch-results');
    const btn=document.getElementById('btn-fetch');
    if(!q){toast('请输入书名');return}
    btn.disabled=true;btn.innerHTML='<i class="fas fa-spinner spin"></i>';
    rd.innerHTML='<div style="color:var(--t2);font-size:.83rem;padding:8px">搜索中…</div>';
    try{
      const res=await searchBooks(q);
      if(!res.length){rd.innerHTML='<div style="color:var(--t2);font-size:.83rem;padding:8px">未找到</div>';return}
      rd.innerHTML=res.slice(0,5).map((r,i)=>`<div class="fres" data-i="${i}">
        ${r.cover?`<img src="${r.cover}" onerror="this.style.display='none'">`:''}
        <div><div class="frt">${r.title}</div><div class="fra">${r.author||''} ${r.year||''}</div></div>
      </div>`).join('');
      rd.querySelectorAll('.fres').forEach(el=>{
        el.addEventListener('click',()=>{
          const r=res[parseInt(el.dataset.i)];
          document.getElementById('bt').value=r.title;
          document.getElementById('ba').value=r.author||'';
          document.getElementById('bc').value=r.cover||'';
          document.getElementById('bd').value=r.desc||'';
          document.getElementById('cpv').innerHTML=r.cover?`<img src="${r.cover}" onerror="this.remove()">`:'';
          rd.innerHTML='';toast('✅ 已填充');
        });
      });
    }catch{rd.innerHTML='<div style="color:var(--pk);font-size:.83rem;padding:8px">搜索失败</div>'}
    finally{btn.disabled=false;btn.innerHTML='<i class="fas fa-search"></i> 搜'}
  }
  openBookForm(book=null){
    document.getElementById('form-book').reset();
    document.getElementById('beid').value='';
    document.getElementById('fetch-results').innerHTML='';
    document.getElementById('cpv').innerHTML='';
    document.getElementById('mb-title').textContent=book?'编辑书籍':'添加书籍';
    if(book){
      document.getElementById('beid').value=book.id;
      document.getElementById('bt').value=book.title;
      document.getElementById('ba').value=book.author||'';
      document.getElementById('bc').value=book.cover||'';
      document.getElementById('bd').value=book.description||'';
      document.getElementById('bs').value=book.status;
      document.getElementById('br').value=book.rating||5;
      if(book.cover)document.getElementById('cpv').innerHTML=`<img src="${book.cover}" onerror="this.remove()">`;
    }
    OM('modal-book');
  }
  saveBook(e){
    e.preventDefault();const books=DB.books();const eid=document.getElementById('beid').value;
    const d={id:eid||DB.id(),title:document.getElementById('bt').value.trim(),author:document.getElementById('ba').value.trim(),cover:document.getElementById('bc').value.trim(),description:document.getElementById('bd').value.trim(),status:document.getElementById('bs').value,rating:parseInt(document.getElementById('br').value),dateAdded:new Date().toISOString().split('T')[0]};
    if(eid){const i=books.findIndex(b=>b.id===eid);if(i>=0){d.dateAdded=books[i].dateAdded;books[i]=d}}else books.unshift(d);
    DB.sBooks(books);CM('modal-book');this.renderBooks();toast(eid?'✅ 已更新':'✅ 已添加');
  }
  delBook(id){
    if(!confirm('删除此书及笔记？'))return;
    DB.sBooks(DB.books().filter(b=>b.id!==id));DB.sNotes(DB.notes().filter(n=>n.bookId!==id));
    CM('modal-detail');this.renderBooks();toast('🗑️ 已删除');
  }

  // 书架
  renderBooks(q=''){
    const g=document.getElementById('books-grid');let books=DB.books();const notes=DB.notes();
    if(this.filter!=='all')books=books.filter(b=>b.status===this.filter);
    if(q){const l=q.toLowerCase();books=books.filter(b=>b.title.toLowerCase().includes(l)||(b.author||'').toLowerCase().includes(l))}
    if(!books.length){g.innerHTML=`<div class="es"><i class="fas fa-book-open"></i><p>${q?'无匹配':'书架空空'}</p><p style="font-size:.83rem">去「书库」搜索添加</p></div>`;return}
    g.innerHTML=books.map(b=>{const c=notes.filter(n=>n.bookId===b.id).length;
      return`<div class="bk" data-id="${b.id}"><span class="bdg ${b.status}"></span>${c?`<span class="nc">${c}</span>`:''}
        <div class="cv">${b.cover?`<img src="${b.cover}" loading="lazy" onerror="this.outerHTML='<div class=ph><i class=fas fa-book></i><span>${b.title}</span></div>'">`:`<div class="ph"><i class="fas fa-book"></i><span>${b.title}</span></div>`}</div>
        <div class="inf"><div class="t">${b.title}</div><div class="a">${b.author||''}</div></div></div>`;
    }).join('');
    g.querySelectorAll('.bk').forEach(c=>c.addEventListener('click',()=>this.showDetail(c.dataset.id)));
  }
  showDetail(id){
    const b=DB.books().find(x=>x.id===id);if(!b)return;
    const notes=DB.notes().filter(n=>n.bookId===id);
    document.getElementById('dc').innerHTML=`
      <div class="dh">${b.cover?`<img src="${b.cover}">`:''}
        <div class="di"><h2>${b.title}</h2><div class="au">${b.author||''}</div><div class="de">${b.description||'暂无'}</div>
        <div class="dm"><span class="st2 ${b.status}">${ST[b.status]}</span><span class="stars">${'★'.repeat(b.rating||0)}${'☆'.repeat(5-(b.rating||0))}</span></div></div>
      </div>
      <div class="da">
        <button onclick="app.openNoteForm(null,'${b.id}')"><i class="fas fa-plus"></i> 笔记</button>
        <button onclick="app.openBookForm(DB.books().find(x=>x.id==='${b.id}'))"><i class="fas fa-edit"></i> 编辑</button>
        <button class="del" onclick="app.delBook('${b.id}')"><i class="fas fa-trash"></i> 删除</button>
      </div>
      <div class="ds"><h3>笔记(${notes.length})</h3>${notes.length?notes.map(n=>this.noteHTML(n,false)).join(''):'<p style="color:var(--t2);text-align:center;padding:16px">暂无</p>'}</div>`;
    OM('modal-detail');this._bindNA('#dc',()=>this.showDetail(id));
  }

  // 笔记
  bindNoteForm(){
    document.getElementById('form-note').addEventListener('submit',e=>this.saveNote(e));
    document.querySelectorAll('.tb').forEach(b=>{
      b.addEventListener('click',()=>{document.querySelectorAll('.tb').forEach(x=>x.classList.remove('active'));b.classList.add('active');document.getElementById('nt').value=b.dataset.type});
    });
  }
  openNoteForm(note=null,preBid=null){
    document.getElementById('form-note').reset();this.selTopics=[];
    document.getElementById('neid').value='';document.getElementById('nt').value='quote';
    document.querySelectorAll('.tb').forEach(b=>b.classList.toggle('active',b.dataset.type==='quote'));
    const sel=document.getElementById('nb');
    sel.innerHTML='<option value="">— 选择 —</option>'+DB.books().map(b=>`<option value="${b.id}">${b.title}</option>`).join('');
    if(preBid)sel.value=preBid;
    if(note){
      document.getElementById('neid').value=note.id;sel.value=note.bookId;
      document.getElementById('nt').value=note.type;document.getElementById('nc').value=note.content;
      document.getElementById('nm').value=note.comment||'';document.getElementById('np').value=note.page||'';
      this.selTopics=[...(note.topics||[])];
      document.querySelectorAll('.tb').forEach(b=>b.classList.toggle('active',b.dataset.type===note.type));
    }
    this.renderTP();OM('modal-note');
  }
  renderTP(){
    const ts=DB.topics(),c=document.getElementById('tp');
    if(!ts.length){c.innerHTML='<span style="color:var(--t2);font-size:.82rem">去课题页创建</span>';return}
    c.innerHTML=ts.map(t=>`<button type="button" class="tpb ${this.selTopics.includes(t.id)?'sel':''}" data-t="${t.id}"><span class="dot" style="background:${t.color}"></span>${t.name}</button>`).join('');
    c.querySelectorAll('.tpb').forEach(b=>{
      b.addEventListener('click',()=>{const id=b.dataset.t;this.selTopics=this.selTopics.includes(id)?this.selTopics.filter(x=>x!==id):[...this.selTopics,id];this.renderTP()});
    });
  }
  saveNote(e){
    e.preventDefault();const notes=DB.notes();const eid=document.getElementById('neid').value;
    const d={id:eid||DB.id(),bookId:document.getElementById('nb').value,type:document.getElementById('nt').value,
      content:document.getElementById('nc').value.trim(),comment:document.getElementById('nm').value.trim(),
      topics:[...this.selTopics],page:document.getElementById('np').value||null,dateAdded:new Date().toISOString().split('T')[0]};
    if(eid){const i=notes.findIndex(n=>n.id===eid);if(i>=0){d.dateAdded=notes[i].dateAdded;notes[i]=d}}else notes.unshift(d);
    DB.sNotes(notes);CM('modal-note');this.renderBooks();toast('✅ 已保存');
  }
  delNote(id){if(!confirm('删除？'))return;DB.sNotes(DB.notes().filter(n=>n.id!==id));this.renderBooks();toast('🗑️')}
  noteHTML(n,src=true){
    const b=DB.books().find(x=>x.id===n.bookId);const ts=DB.topics();
    const tn=(n.topics||[]).map(id=>ts.find(t=>t.id===id)).filter(Boolean);
    return`<div class="nc2 ${n.type}"><div class="nac"><button class="en" data-id="${n.id}"><i class="fas fa-edit"></i></button><button class="dn" data-id="${n.id}"><i class="fas fa-trash"></i></button></div>
      ${src&&b?`<div class="ns">${b.cover?`<img src="${b.cover}">`:''}<div><div class="sb">${b.title}</div><div class="sm">${b.author||''} · P${n.page||'?'} · ${n.dateAdded}</div></div></div>`
        :`<div class="sm" style="margin-bottom:4px">P${n.page||'?'} · ${n.dateAdded}</div>`}
      <div class="ntx">${n.content}</div>${n.comment?`<div class="ncm">${n.comment}</div>`:''}
      ${tn.length?`<div class="ntg">${tn.map(t=>`<span class="mtg" style="background:${t.color}22;color:${t.color}">#${t.name}</span>`).join('')}</div>`:''}</div>`;
  }
  _bindNA(sel,ref){
    document.querySelectorAll(`${sel} .en`).forEach(b=>{b.addEventListener('click',e=>{e.stopPropagation();const n=DB.notes().find(x=>x.id===b.dataset.id);if(n){CM('modal-detail');this.openNoteForm(n)}})});
    document.querySelectorAll(`${sel} .dn`).forEach(b=>{b.addEventListener('click',e=>{e.stopPropagation();this.delNote(b.dataset.id);if(ref)ref()})});
  }

  // 课题
  bindTopicForm(){
    document.getElementById('btn-new-topic').addEventListener('click',()=>this.openTopicForm());
    document.querySelectorAll('.cd').forEach(d=>{
      d.addEventListener('click',()=>{document.querySelectorAll('.cd').forEach(x=>x.classList.remove('active'));d.classList.add('active');document.getElementById('tc').value=d.dataset.c});
    });
    document.getElementById('form-topic').addEventListener('submit',e=>this.saveTopic(e));
  }
  openTopicForm(t=null){
    document.getElementById('form-topic').reset();document.getElementById('teid').value='';
    document.getElementById('tc').value='#6c63ff';
    document.querySelectorAll('.cd').forEach(d=>d.classList.toggle('active',d.dataset.c==='#6c63ff'));
    if(t){document.getElementById('teid').value=t.id;document.getElementById('tn').value=t.name;document.getElementById('td').value=t.description||'';document.getElementById('tc').value=t.color;
      document.querySelectorAll('.cd').forEach(d=>d.classList.toggle('active',d.dataset.c===t.color))}
    OM('modal-topic');
  }
  saveTopic(e){
    e.preventDefault();const ts=DB.topics();const eid=document.getElementById('teid').value;
    const d={id:eid||DB.id(),name:document.getElementById('tn').value.trim(),description:document.getElementById('td').value.trim(),color:document.getElementById('tc').value};
    if(eid){const i=ts.findIndex(t=>t.id===eid);if(i>=0)ts[i]={...ts[i],...d}}else ts.unshift(d);
    DB.sTopics(ts);CM('modal-topic');this.renderTopics();toast('✅ 已保存');
  }
  delTopic(id){if(!confirm('删除课题？'))return;DB.sTopics(DB.topics().filter(t=>t.id!==id));this.renderTopics();toast('🗑️')}
  renderTopics(){
    const ts=DB.topics(),notes=DB.notes(),list=document.getElementById('topics-list'),det=document.getElementById('topic-detail');
    det.style.display='none';list.style.display='';
    if(!ts.length){list.innerHTML='<div class="es"><i class="fas fa-compass"></i><p>还没有课题</p></div>';return}
    list.innerHTML=ts.map(t=>{const c=notes.filter(n=>(n.topics||[]).includes(t.id)).length;
      return`<div class="tc" data-t="${t.id}"><div class="tcb" style="background:${t.color}"></div><button class="tcdel" data-t="${t.id}"><i class="fas fa-trash"></i></button><div class="tcn">${t.name}</div><div class="tcd">${t.description||'点击查看'}</div><div class="tcc">${c} 条笔记</div></div>`;
    }).join('');
    list.querySelectorAll('.tc').forEach(c=>{c.addEventListener('click',e=>{if(e.target.closest('.tcdel'))return;this.showTopic(c.dataset.t)})});
    list.querySelectorAll('.tcdel').forEach(b=>{b.addEventListener('click',e=>{e.stopPropagation();this.delTopic(b.dataset.t)})});
  }
  showTopic(tid){
    const t=DB.topics().find(x=>x.id===tid);if(!t)return;
    const notes=DB.notes().filter(n=>(n.topics||[]).includes(tid));
    const list=document.getElementById('topics-list'),det=document.getElementById('topic-detail');
    list.style.display='none';det.style.display='';
    det.innerHTML=`<div class="tdh"><button class="tdb" id="tdb"><i class="fas fa-arrow-left"></i></button><div><div class="tdt" style="color:${t.color}">${t.name}</div><div style="color:var(--t2);font-size:.83rem">${notes.length} 条笔记</div></div></div>
      ${t.description?`<p style="color:var(--t2);margin-bottom:12px;font-size:.88rem">${t.description}</p>`:''}
      ${notes.length?notes.map(n=>this.noteHTML(n,true)).join(''):'<p style="color:var(--t2);text-align:center;padding:30px">暂无笔记</p>'}`;
    document.getElementById('tdb').addEventListener('click',()=>this.renderTopics());
    this._bindNA('#topic-detail',()=>this.showTopic(tid));
  }

  // 搜索
  bindSearch(){
    let t;document.getElementById('searchInput').addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>this.renderBooks(e.target.value.trim()),300)});
  }

  // 设置
  bindSettings(){
    document.getElementById('btn-export').addEventListener('click',()=>{
      const b=new Blob([DB.exp()],{type:'application/json'});const a=document.createElement('a');
      a.href=URL.createObjectURL(b);a.download=`lib-${new Date().toISOString().split('T')[0]}.json`;a.click();toast('📦 已导出');
    });
    document.getElementById('btn-import').addEventListener('click',()=>document.getElementById('import-file').click());
    document.getElementById('import-file').addEventListener('change',e=>{
      const f=e.target.files[0];if(!f)return;const r=new FileReader();
      r.onload=()=>{try{DB.imp(r.result);this.renderBooks();toast('✅ 已恢复')}catch{toast('❌ 格式错误')}};
      r.readAsText(f);e.target.value='';
    });
    document.getElementById('btn-clear').addEventListener('click',()=>{
      if(confirm('⚠️ 清空所有？')){['lb','ln','lt'].forEach(k=>localStorage.removeItem(k));this.renderBooks();toast('🗑️')}
    });
  }
  renderStats(){
    const n=DB.notes(),ts=new Set();n.forEach(x=>(x.topics||[]).forEach(t=>ts.add(t)));
    document.getElementById('s-books').textContent=DB.books().length;
    document.getElementById('s-notes').textContent=n.length;
    document.getElementById('s-topics').textContent=ts.size;
  }
}
const app=new App();

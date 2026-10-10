import { createStore, createUserState, JOB_STATUSES } from './lib/db.js';
import {
  filterGames, sortGames, filterJobs, sortJobs, formatSalary, daysUntil, freshness, STATUS_LABEL, norm, EMPLOYMENT_LABEL,
} from './lib/logic.js';
import { matchJob, cvSuggestions, coverLetter, emailDraft, aiPrompt } from './lib/match.js';
import { computeNotifications } from './lib/notify.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d) => { if (!d) return ''; const t = new Date(d); return Number.isNaN(+t) ? '' : t.toLocaleDateString('vi-VN'); };
const fmtDateTime = (d) => { const t = new Date(d); return Number.isNaN(+t) ? '' : t.toLocaleString('vi-VN'); };
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

const app = {
  store: null, user: null,
  data: { games: [], jobs: [], meta: { sources: {} }, generatedAt: null, loadError: null },
  manual: { games: [], jobs: [] },
  profile: {}, settings: { notify: false, newGames: true, newJobs: true, minMatch: 50, defLocation: '', defMaxExp: '', defMinSalary: '' },
  notifs: [], seen: null,
  filters: { games: { sort: 'release', platform: 'Android' }, jobs: { sort: 'date', hideExpired: true } },
  limit: { games: 40, jobs: 40 },
  gameSeg: 'all',
};
window.__app = app; // phục vụ kiểm thử/gỡ lỗi

const allGames = () => [...app.manual.games, ...app.data.games];
const allJobs = () => [...app.manual.jobs, ...app.data.jobs];
const findGame = (id) => allGames().find((g) => g.id === id) || app.user.game(id).snapshot;
const findJob = (id) => allJobs().find((j) => j.id === id) || app.user.job(id).snapshot;
const matchOf = (job) => matchJob(job, app.profile);

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2500);
}

// ---------------- Tải dữ liệu ----------------
async function fetchData(name, force) {
  const bust = force ? `?t=${Date.now()}` : '';
  const base = window.GJA_DATA_BASE || '';
  const tries = base ? [`${base}data/${name}.json${bust}`, `data/${name}.json${bust}`] : [`data/${name}.json${bust}`];
  let err;
  for (const u of tries) {
    try { const r = await fetch(u, force ? { cache: 'no-store' } : {}); if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`); return await r.json(); } catch (e) { err = e; }
  }
  throw err;
}

async function loadData(force = false) {
  try {
    const [g, j, m] = await Promise.all(['games', 'jobs', 'meta'].map((n) => fetchData(n, force)));
    app.data = { games: g.items, jobs: j.items, meta: m, generatedAt: m.generatedAt, loadError: null };
    await app.store.set('cache', app.data);
  } catch (e) {
    const cached = await app.store.get('cache');
    if (cached) app.data = { ...cached, loadError: `Không tải được dữ liệu mới (${e.message}); đang dùng bản lưu lần trước.` };
    else app.data.loadError = `Không tải được dữ liệu (${e.message}).`;
  }
  updateBanner();
}

function updateBanner() {
  const b = $('#banner');
  const msgs = [];
  if (app.data.loadError) msgs.push(app.data.loadError);
  if (app.data.generatedAt) {
    const hrs = Math.round((Date.now() - Date.parse(app.data.generatedAt)) / 3600000);
    if (hrs > 36) msgs.push(`Dữ liệu cập nhật ${hrs} giờ trước – máy chủ có thể chưa tự cập nhật. Xem mục Hồ sơ → Nguồn dữ liệu.`);
  }
  b.hidden = !msgs.length; b.textContent = msgs.join(' ');
}

// ---------------- Thông báo ----------------
async function processNotifications() {
  const cands = computeNotifications({ games: allGames(), jobs: allJobs() }, app.user.raw(), app.seen, app.profile, Date.now(), app.settings);
  const known = new Set(app.notifs.map((n) => n.id));
  const fresh = cands.filter((n) => !known.has(n.id));
  for (const n of fresh) app.notifs.unshift({ ...n, at: new Date().toISOString(), read: false });
  app.notifs = app.notifs.slice(0, 60);
  app.seen = { games: allGames().filter((g) => g.kind === 'store').map((g) => g.id), jobs: app.data.jobs.map((j) => j.id) };
  await app.store.set('seen', app.seen);
  await app.store.set('notifs', app.notifs);
  if (fresh.length && app.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    const reg = await navigator.serviceWorker?.getRegistration();
    for (const n of fresh.slice(0, 3)) {
      try { reg ? await reg.showNotification(n.title, { body: n.body, tag: n.id, icon: 'icons/icon-192.png', data: { url: n.url || './' } }) : new Notification(n.title, { body: n.body }); } catch { /* bỏ qua */ }
    }
  }
  updateBadge();
}
function updateBadge() {
  const n = app.notifs.filter((x) => !x.read).length;
  const b = $('#notif-badge'); b.hidden = !n; b.textContent = n;
}

// ---------------- Thành phần giao diện ----------------
function statusChip(g) {
  const label = STATUS_LABEL[g.status] || g.status;
  return `<span class="chip ${g.status === 'released' ? 'ok' : 'warn'}">${esc(label)}</span>`;
}
function gameDateLine(g) {
  if (g.releaseDate) return `${g.status === 'upcoming' ? 'Dự kiến phát hành (App Store)' : 'Phát hành'}: ${fmtDate(g.releaseDate)}`;
  if (g.announcedAt) return `Ngày đăng tin: ${fmtDate(g.announcedAt)} · chưa có ngày phát hành xác nhận`;
  return 'Chưa rõ ngày phát hành';
}
function gameCard(g) {
  const st = app.user.game(g.id);
  return `<div class="card"><div class="row">
    ${g.icon ? `<img class="thumb" loading="lazy" alt="" src="${esc(g.icon)}" onerror="this.style.visibility='hidden'">` : '<div class="thumb"></div>'}
    <div class="grow" data-action="open-game" data-id="${esc(g.id)}" style="cursor:pointer">
      <p class="title">${esc(g.name)}</p>
      <p class="sub">${esc(gameDateLine(g))}</p>
      <div class="chips">${statusChip(g)}${g.kind === 'news' ? '<span class="chip warn">Tin báo chí</span>' : ''}${g.kind === 'manual' ? '<span class="chip warn">Nhập thủ công</span>' : ''}${g.genre ? `<span class="chip">${esc(g.genre)}</span>` : ''}${(g.platforms || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}${g.supportsVietnamese ? '<span class="chip ok">Có tiếng Việt</span>' : ''}${st.played ? '<span class="chip">Đã chơi</span>' : ''}</div>
      <p class="sub">Nguồn: ${esc(g.source || '')}${g.updatedAt ? ` · cập nhật ${fmtDate(g.updatedAt)}` : ''}</p>
    </div>
    <button class="fav" data-action="fav-game" data-id="${esc(g.id)}" aria-label="Yêu thích">${st.fav ? '★' : '☆'}</button>
  </div></div>`;
}
function deadlineChip(j, st = {}) {
  const dl = st.deadline || j.validThrough;
  const d = daysUntil(dl);
  if (d == null) return '';
  if (d < 0) return '<span class="chip bad">Đã hết hạn</span>';
  return `<span class="chip ${d <= 3 ? 'warn' : ''}">Hạn: ${fmtDate(dl)} (còn ${d} ngày)</span>`;
}
function jobCard(j) {
  const st = app.user.job(j.id);
  const fr = freshness(j.datePosted);
  const m = app.profile && matchOf(j);
  const status = JOB_STATUSES.find(([k]) => k === st.status);
  return `<div class="card"><div class="row">
    <div class="grow" data-action="open-job" data-id="${esc(j.id)}" style="cursor:pointer">
      <p class="title">${esc(j.title)}</p>
      <p class="sub">${esc(j.company)} · ${esc((j.locations || []).join(', ') || 'Chưa rõ địa điểm')}</p>
      <p class="sub">💰 ${esc(formatSalary(j.salary))}${j.expMonths != null ? ` · ${+(j.expMonths / 12).toFixed(1)} năm KN` : ''}</p>
      <div class="chips">${deadlineChip(j, st)}<span class="chip">Đăng: ${esc(fr.label)}</span>${(j.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}${status && st.status !== 'none' && st.status ? `<span class="chip ok">${esc(status[1])}</span>` : ''}${j.verification && j.verification.startsWith('Chưa') ? '<span class="chip warn">Chưa xác minh</span>' : ''}</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end">
      <button class="fav" data-action="fav-job" data-id="${esc(j.id)}" aria-label="Lưu tin">${st.fav ? '★' : '☆'}</button>
      ${m?.hasProfile ? `<span class="score" title="Mức phù hợp ước tính">${m.score}%</span>` : ''}
    </div>
  </div></div>`;
}
const empty = (t) => `<div class="empty">${esc(t)}</div>`;

// ---------------- Màn hình ----------------
const views = {};

views.home = () => {
  const games = allGames();
  const newGames = [
    ...sortGames(games.filter((g) => g.kind === 'news' && g.status === 'released' && g.platforms?.includes('Android')), 'release'),
    ...sortGames(games.filter((g) => g.kind !== 'news' && g.status === 'released'), 'release'),
  ].slice(0, 4);
  const upcoming = [
    ...games.filter((g) => g.status === 'upcoming' && g.releaseDate),
    ...sortGames(games.filter((g) => g.kind === 'news' && g.status !== 'released' && g.platforms?.includes('Android')), 'release'),
    ...sortGames(games.filter((g) => g.kind === 'news' && g.status !== 'released' && !g.platforms?.includes('Android')), 'release'),
  ].slice(0, 4);
  const jobs = allJobs();
  const now = Date.now();
  const active = jobs.filter((j) => !j.validThrough || Date.parse(j.validThrough) > now);
  const newJobs = sortJobs(active, 'date').slice(0, 4);
  let good = [];
  if (matchOf({ title: '', description: '' }).hasProfile) {
    good = sortJobs(active, 'match', Object.fromEntries(active.map((j) => [j.id, matchOf(j)]))).filter((j) => matchOf(j).score >= 60).slice(0, 4);
  }
  const savedIds = new Set(app.user.savedJobs().map(([id]) => id));
  const expiring = sortJobs(active.filter((j) => { const d = daysUntil(app.user.job(j.id).deadline || j.validThrough); return d != null && d >= 0 && d <= 7 && (savedIds.has(j.id) || j.relevance >= 60); }), 'deadline').slice(0, 4);
  const sg = app.user.savedGames().length; const sj = app.user.savedJobs().length;
  return `
    <div class="card"><b>Đã lưu:</b> ${sj} việc làm · ${sg} game · <a href="#saved">Xem</a></div>
    ${good.length ? `<h2>Việc làm phù hợp cao <a href="#jobs">Tất cả</a></h2>${good.map(jobCard).join('')}` : (matchOf({}).hasProfile ? '' : '<div class="card sub">Nhập hồ sơ/CV ở tab <a href="#profile">Hồ sơ</a> để thấy việc làm phù hợp cao.</div>')}
    <h2>Việc làm mới <a href="#jobs">Tất cả</a></h2>${newJobs.map(jobCard).join('') || empty('Chưa có dữ liệu việc làm.')}
    <h2>Sắp hết hạn nộp CV</h2>${expiring.map(jobCard).join('') || empty('Không có tin nào hết hạn trong 7 ngày tới.')}
    <h2>Game mới cập nhật <a href="#games">Tất cả</a></h2>${newGames.map(gameCard).join('') || empty('Chưa có dữ liệu game.')}
    <h2>Game sắp phát hành / thử nghiệm</h2>${upcoming.map(gameCard).join('') || empty('Chưa có tin game sắp ra mắt.')}`;
};

views.games = () => {
  const f = app.filters.games;
  const genres = [...new Set(allGames().map((g) => g.genre).filter(Boolean))].sort();
  const plat = (k, l) => `<button class="btn sm ${(f.platform || '') === k ? 'on' : ''}" data-action="game-plat" data-k="${k}">${l}</button>`;
  const seg = (k, l) => `<button class="btn sm ${app.gameSeg === k ? 'on' : ''}" data-action="game-seg" data-k="${k}">${l}</button>`;
  return `
    <div class="seg">${plat('Android', 'Android')}${plat('iOS', 'iOS (App Store VN)')}${plat('', 'Tất cả')}</div>
    <div class="seg">${seg('all', 'Mọi trạng thái')}${seg('released', 'Mới phát hành')}${seg('upcoming', 'Sắp ra / Đăng ký trước')}${seg('beta', 'Thử nghiệm')}</div>
    <div class="filters">
      <input class="full" type="search" placeholder="Tìm theo tên game…" data-filter="games.q" value="${esc(f.q || '')}">
      <select data-filter="games.genre"><option value="">Mọi thể loại</option>${genres.map((g) => `<option ${f.genre === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}</select>
      <select data-filter="games.sort">${[['release', 'Mới nhất theo ngày'], ['updated', 'Cập nhật gần đây'], ['name', 'Tên A-Z']].map(([k, l]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn full" data-action="add-manual" data-type="game">+ Thêm game (vd: Android bạn tìm thấy)</button>
    </div>
    <p class="kv">⚠ Android: Google Play không có API công khai nên không có danh sách tự động đầy đủ. Mục Android ở đây là <b>tin báo chí</b> (nền tảng suy ra từ nội dung tin) và game bạn tự thêm. iOS là dữ liệu chính thức từ App Store VN. Khả năng tải tại Việt Nam của game Android <b>chưa được xác minh</b> – hãy dùng nút “Tìm trên Google Play”.</p>
    <p class="kv" id="game-count"></p><div id="list"></div>`;
};
function gamesList() {
  const f = app.filters.games;
  let list = filterGames(allGames(), { q: f.q, genre: f.genre, platform: f.platform });
  if (app.gameSeg === 'released') list = list.filter((g) => g.status === 'released');
  if (app.gameSeg === 'upcoming') list = list.filter((g) => g.status === 'upcoming' || g.status === 'preregister');
  if (app.gameSeg === 'beta') list = list.filter((g) => g.status === 'beta');
  list = sortGames(list, f.sort);
  const shown = list.slice(0, app.limit.games);
  $('#game-count').textContent = `${list.length} mục`;
  $('#list').innerHTML = (shown.map(gameCard).join('') || empty(f.platform === 'Android' ? 'Chưa có tin/game Android phù hợp. Thử “Tất cả” hoặc thêm game thủ công.' : 'Không có game phù hợp bộ lọc.')) +
    (list.length > shown.length ? `<div class="actions"><button class="btn" data-action="more" data-k="games">Xem thêm (${list.length - shown.length})</button></div>` : '');
}
views.jobs = () => {
  const f = app.filters.jobs;
  const locs = [...new Set(allJobs().flatMap((j) => j.locations || []))].sort();
  const tags = [...new Set(allJobs().flatMap((j) => j.tags || []))].sort();
  const opt = (cur, arr) => arr.map(([v, l]) => `<option value="${v}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${l}</option>`).join('');
  return `
    <div class="filters">
      <input class="full" type="search" placeholder="Tìm chức danh, công ty, từ khóa…" data-filter="jobs.q" value="${esc(f.q || '')}">
      <select data-filter="jobs.location"><option value="">Mọi địa điểm</option>${locs.map((l) => `<option ${f.location === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select data-filter="jobs.tag"><option value="">Mọi nhóm nghề</option>${tags.map((l) => `<option ${f.tag === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select data-filter="jobs.maxExpMonths">${opt(f.maxExpMonths, [['', 'Mọi kinh nghiệm'], [0, 'Không yêu cầu'], [12, '≤ 1 năm'], [24, '≤ 2 năm'], [36, '≤ 3 năm'], [60, '≤ 5 năm']])}</select>
      <select data-filter="jobs.minSalary">${opt(f.minSalary, [['', 'Mọi mức lương'], [10e6, '≥ 10 triệu'], [15e6, '≥ 15 triệu'], [20e6, '≥ 20 triệu'], [30e6, '≥ 30 triệu']])}</select>
      <select data-filter="jobs.postedWithinDays">${opt(f.postedWithinDays, [['', 'Mọi ngày đăng'], [3, '3 ngày qua'], [7, '7 ngày qua'], [30, '30 ngày qua']])}</select>
      <select data-filter="jobs.sort">${opt(f.sort, [['date', 'Mới đăng'], ['deadline', 'Sắp hết hạn'], ['salary', 'Lương cao'], ['match', 'Phù hợp CV']])}</select>
      <label class="full" style="display:flex;gap:8px;align-items:center"><input style="width:auto;min-height:0" type="checkbox" data-filter="jobs.hideExpired" ${f.hideExpired ? 'checked' : ''}> Ẩn tin đã hết hạn</label>
      <button class="btn full" data-action="add-manual" data-type="job">+ Thêm tin thủ công / từ liên kết</button>
    </div>
    <details class="card"><summary>🔎 Tìm trên các trang tuyển dụng khác</summary>
      <p class="kv">Các trang này không cho phép lấy dữ liệu tự động hợp lệ, nên ứng dụng chỉ mở sẵn trang tìm kiếm. Thấy tin hay: dùng “Chia sẻ” → ứng dụng này, hoặc “+ Thêm tin thủ công”.</p>
      ${SEARCH_KEYWORDS.map((k) => `<div class="kv" style="margin:6px 0"><b>${esc(k)}</b>: ${JOB_SITES.map(([n, f]) => `<a target="_blank" rel="noopener" href="${esc(f(k))}">${n}</a>`).join(' · ')}</div>`).join('')}
    </details>
    <p class="kv" id="job-count"></p><div id="list"></div>`;
};
const SEARCH_KEYWORDS = ['HSE', 'EHS', 'An toàn lao động', 'Môi trường', 'ISO 14001', 'ISO 45001', 'ESG', 'Xử lý nước thải'];
const JOB_SITES = [
  ['TopCV', (k) => `https://www.topcv.vn/tim-viec-lam-${encodeURIComponent(norm(k).replace(/ /g, '-'))}`],
  ['VietnamWorks', (k) => `https://www.vietnamworks.com/viec-lam?q=${encodeURIComponent(k)}`],
  ['CareerViet', (k) => `https://careerviet.vn/viec-lam/${encodeURIComponent(norm(k).replace(/ /g, '-'))}-k-vi.html`],
  ['CareerLink', (k) => `https://www.careerlink.vn/vieclam/tim-kiem-viec-lam?keyword=${encodeURIComponent(k)}`],
  ['Indeed', (k) => `https://vn.indeed.com/jobs?q=${encodeURIComponent(k)}&l=Vi%E1%BB%87t+Nam`],
  ['LinkedIn', (k) => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(k)}&location=Vietnam`],
];
function jobsList() {
  const f = app.filters.jobs;
  const all = allJobs();
  const match = f.sort === 'match' ? Object.fromEntries(all.map((j) => [j.id, matchOf(j)])) : {};
  const list = sortJobs(filterJobs(all, f), f.sort, match);
  const shown = list.slice(0, app.limit.jobs);
  $('#job-count').textContent = `${list.length} tin phù hợp bộ lọc · dữ liệu: ${app.data.generatedAt ? fmtDateTime(app.data.generatedAt) : 'chưa có'}`;
  $('#list').innerHTML = (shown.map(jobCard).join('') || empty('Không có tin phù hợp bộ lọc.')) +
    (list.length > shown.length ? `<div class="actions"><button class="btn" data-action="more" data-k="jobs">Xem thêm (${list.length - shown.length})</button></div>` : '');
}

views.saved = () => {
  const sj = app.user.savedJobs(); const sg = app.user.savedGames();
  const byStatus = (s) => sj.filter(([, v]) => (v.status || 'none') === s);
  const sec = (s, label) => { const items = byStatus(s); return items.length ? `<h2>${label} (${items.length})</h2>${items.map(([id]) => jobCard(findJob(id))).join('')}` : ''; };
  return `
    ${sec('to_apply', 'Cần ứng tuyển')}${sec('applied', 'Đã ứng tuyển')}${sec('interview', 'Phỏng vấn')}${sec('none', 'Đã lưu (chưa phân loại)')}${sec('closed', 'Đã kết thúc')}
    ${sj.length ? '' : empty('Chưa lưu việc làm nào. Bấm ☆ trên tin để lưu.')}
    <h2>Game yêu thích / đã chơi (${sg.length})</h2>
    ${sg.map(([id]) => gameCard(findGame(id))).join('') || empty('Chưa lưu game nào.')}`;
};

const PROFILE_FIELDS = [
  ['name', 'Họ và tên', 'text'], ['email', 'Email', 'email'], ['phone', 'Số điện thoại', 'tel'],
  ['title', 'Chức danh hiện tại / mục tiêu', 'text'], ['years', 'Số năm kinh nghiệm', 'number'],
  ['education', 'Học vấn / bằng cấp', 'text'], ['certs', 'Chứng chỉ (mỗi dòng một chứng chỉ)', 'area'],
  ['skills', 'Kỹ năng', 'area'], ['summary', 'Giới thiệu ngắn', 'area'],
  ['locations', 'Nơi muốn làm (cách nhau bằng dấu phẩy)', 'text'], ['minSalary', 'Lương tối thiểu mong muốn (VND/tháng)', 'number'],
  ['cvText', 'Nội dung CV (dán văn bản, hoặc tải tệp .txt/.md)', 'area-lg'],
];
views.profile = () => {
  const p = app.profile; const s = app.settings;
  const field = ([k, l, t]) => `<label for="p-${k}">${l}</label>${t.startsWith('area') ? `<textarea id="p-${k}" data-profile="${k}" ${t === 'area-lg' ? 'style="min-height:220px"' : ''}>${esc(p[k] || '')}</textarea>` : `<input id="p-${k}" type="${t}" data-profile="${k}" value="${esc(p[k] ?? '')}">`}`;
  const src = Object.values(app.data.meta.sources || {}).map((x) => `<div class="card"><b>${esc(x.name)}</b> <span class="${x.ok ? 'src-ok' : 'src-bad'}">${x.ok ? '● hoạt động' : '● lỗi/không có dữ liệu'}</span><div class="kv">${x.count} mục · thu thập ${fmtDateTime(x.at)}<br>${esc(x.note || '')}${x.errors?.length ? `<br>Lỗi gần nhất: ${esc(x.errors[0])}` : ''}</div></div>`).join('');
  return `
    <h2>Hồ sơ nghề nghiệp</h2>
    <p class="kv">Lưu trên thiết bị này (IndexedDB), không gửi đi đâu. Ứng dụng không tự gửi CV cho nhà tuyển dụng.</p>
    ${PROFILE_FIELDS.map(field).join('')}
    <label for="cvfile">Tải CV (.txt, .md)</label><input id="cvfile" type="file" accept=".txt,.md,text/plain">
    <div class="actions"><button class="btn pri" data-action="save-profile">Lưu hồ sơ</button></div>
    <h2>Thông báo & bộ lọc mặc định</h2>
    <div class="card">
      <label style="display:flex;gap:8px;align-items:center"><input style="width:auto;min-height:0" type="checkbox" data-setting="notify" ${s.notify ? 'checked' : ''}> Bật thông báo hệ thống (xin quyền khi bật)</label>
      <label style="display:flex;gap:8px;align-items:center"><input style="width:auto;min-height:0" type="checkbox" data-setting="newGames" ${s.newGames ? 'checked' : ''}> Báo game mới</label>
      <label style="display:flex;gap:8px;align-items:center"><input style="width:auto;min-height:0" type="checkbox" data-setting="newJobs" ${s.newJobs ? 'checked' : ''}> Báo việc làm mới phù hợp</label>
      <label>Mức phù hợp tối thiểu để báo việc làm (%)</label><input type="number" data-setting="minMatch" value="${s.minMatch}">
      <label>Địa điểm mặc định khi lọc việc làm</label><input type="text" data-setting="defLocation" value="${esc(s.defLocation)}" placeholder="vd: Hồ Chí Minh">
      <p class="kv">Thông báo chỉ được tạo khi ứng dụng được mở (hoặc khi trình duyệt cho phép đồng bộ nền định kỳ). Không có máy chủ đẩy thông báo – xem README.</p>
    </div>
    <h2>Nguồn dữ liệu</h2>
    <p class="kv">Dữ liệu cập nhật lần cuối: ${app.data.generatedAt ? fmtDateTime(app.data.generatedAt) : 'chưa có'}.</p>${src || empty('Chưa có thông tin nguồn.')}
    <h2>Sao lưu dữ liệu</h2>
    <div class="actions"><button class="btn" data-action="export">Xuất sao lưu (JSON)</button><label class="btn" style="margin:0;cursor:pointer">Nhập sao lưu<input type="file" accept=".json" data-import hidden></label><button class="btn" data-action="wipe">Xóa dữ liệu cá nhân</button></div>`;
};

// ---------------- Hộp thoại chi tiết ----------------
function openDlg(html) {
  const d = $('#dlg'); d.innerHTML = `<div class="dlg-body">${html}<div class="actions"><button class="btn" data-action="close">Đóng</button></div></div>`;
  if (!d.open) d.showModal();
}
const closeDlg = () => { const d = $('#dlg'); if (d.open) d.close(); };

function gameDialog(id) {
  const g = findGame(id); if (!g) return;
  const st = app.user.game(id);
  const gp = `https://play.google.com/store/search?q=${encodeURIComponent(g.name)}&c=apps`;
  openDlg(`
    <div class="row">${g.icon ? `<img class="thumb" alt="" src="${esc(g.icon)}" style="width:80px;height:80px">` : ''}<div class="grow"><h3 class="title">${esc(g.name)}</h3><div class="chips">${statusChip(g)}${g.genre ? `<span class="chip">${esc(g.genre)}</span>` : ''}${(g.platforms || []).map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div></div></div>
    <p>${esc(gameDateLine(g))}</p>
    ${g.releaseDateKind === 'release' || g.kind === 'store' ? '' : '<p class="kv">⚠ Đây là tin công bố/đăng tải, chưa phải ngày phát hành chính thức.</p>'}
    <p>${esc(g.description || 'Chưa có mô tả.')}</p>
    <ul class="tight kv">
      ${g.developer ? `<li>Nhà phát hành: ${esc(g.developer)}</li>` : ''}
      ${g.rating ? `<li>Đánh giá tham khảo (${esc(g.rating.by)}): ${g.rating.value}/5 · ${g.rating.count} lượt</li>` : '<li>Đánh giá: chưa có dữ liệu</li>'}
      <li>Nền tảng: ${(g.platforms || []).length ? esc(g.platforms.join(', ')) : 'tin không nêu rõ'}${g.platformNote ? ` (${esc(g.platformNote)})` : ''}</li>
      ${g.regions?.length ? `<li>Khu vực: ${esc(g.regions.join(', '))}</li>` : '<li>Khu vực: chưa rõ</li>'}
      <li><b>Tải được tại Việt Nam:</b> ${g.kind === 'store' ? 'có trên App Store VN (đã đối chiếu qua API kho VN lúc thu thập)' : 'chưa xác minh – kiểm tra trên Google Play/App Store trước khi tin'}</li>
      ${g.languages?.length ? `<li>Ngôn ngữ: ${esc(g.languages.join(', '))}${g.supportsVietnamese ? ' (có tiếng Việt)' : ''}</li>` : '<li>Ngôn ngữ: chưa rõ</li>'}
      ${g.requirements ? `<li>Cấu hình tối thiểu: ${esc(g.requirements)}</li>` : '<li>Cấu hình: chưa có dữ liệu</li>'}
      ${g.price ? `<li>Giá: ${esc(g.price)}</li>` : ''}
      <li>Nguồn: ${esc(g.source || '')}${g.updatedAt ? ` · cập nhật ${fmtDateTime(g.updatedAt)}` : ''}${g.fetchedAt ? ` · thu thập ${fmtDateTime(g.fetchedAt)}` : ''}</li>
    </ul>
    <div class="actions">
      ${safeUrl(g.sourceUrl) ? `<a class="btn" target="_blank" rel="noopener" href="${esc(g.sourceUrl)}">Mở trang nguồn${g.kind === 'store' ? ' / tải về' : ''}</a>` : ''}
      <a class="btn" target="_blank" rel="noopener" href="${esc(gp)}">Tìm trên Google Play</a>
      <button class="btn" data-action="fav-game" data-id="${esc(id)}" data-reopen="1">${st.fav ? '★ Bỏ yêu thích' : '☆ Yêu thích'}</button>
      <button class="btn" data-action="played" data-id="${esc(id)}">${st.played ? '✔ Đã chơi (bỏ)' : 'Đánh dấu đã chơi'}</button>
    </div>`);
}

function jobDialog(id) {
  const j = findJob(id); if (!j) return;
  const st = app.user.job(id);
  const m = matchOf(j);
  const fr = freshness(j.datePosted);
  const list = (arr) => (arr?.length ? `<ul class="tight">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  openDlg(`
    <h3 class="title">${esc(j.title)}</h3>
    <p class="sub">${esc(j.company)} · ${esc((j.locations || []).join(', '))}</p>
    <div class="chips">${deadlineChip(j, st)}${(j.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>
    <ul class="tight">
      <li>💰 Lương: ${esc(formatSalary(j.salary))}</li>
      <li>Kinh nghiệm: ${j.expMonths != null ? `${+(j.expMonths / 12).toFixed(1)} năm` : 'không công bố'}</li>
      <li>Loại hình: ${esc(EMPLOYMENT_LABEL[j.employmentType] || j.employmentType || 'không công bố')}</li>
      <li>Ngày đăng: ${fmtDate(j.datePosted) || 'không rõ'} (${esc(fr.label)}) · Hạn ứng tuyển: ${fmtDate(j.validThrough) || 'không công bố'}</li>
    </ul>
    ${j.requirements?.degree?.length ? `<b>Bằng cấp (trích từ tin)</b>${list(j.requirements.degree)}` : ''}
    ${j.requirements?.certs?.length ? `<b>Chứng chỉ (trích từ tin)</b>${list(j.requirements.certs)}` : ''}
    <b>Mô tả công việc</b><pre>${esc(j.description || 'Không có mô tả.')}</pre>
    <p class="kv">Nguồn: ${esc(j.source || '')} · ${esc(j.verification || 'Chưa xác minh')}${j.verifiedAt ? ` · xác minh ${fmtDateTime(j.verifiedAt)}` : ''}</p>
    <div class="actions">
      ${safeUrl(j.sourceUrl) ? `<a class="btn" target="_blank" rel="noopener" href="${esc(j.sourceUrl)}">Mở tin tuyển dụng gốc</a>` : ''}
      <button class="btn" data-action="fav-job" data-id="${esc(id)}" data-reopen="1">${st.fav ? '★ Bỏ lưu' : '☆ Lưu tin'}</button>
    </div>
    <h4>Theo dõi ứng tuyển</h4>
    <label>Trạng thái</label><select data-jobfield="status" data-id="${esc(id)}">${JOB_STATUSES.map(([k, l]) => `<option value="${k}" ${(st.status || 'none') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Hạn nộp CV của bạn</label><input type="date" data-jobfield="deadline" data-id="${esc(id)}" value="${esc(st.deadline || '')}">
    <label>Ghi chú</label><textarea data-jobfield="note" data-id="${esc(id)}">${esc(st.note || '')}</textarea>
    <h4>Mức phù hợp với CV ${m.hasProfile ? `<span class="score">${m.score}%</span>` : ''}</h4>
    ${m.hasProfile ? `
      <p class="kv">Ước tính theo quy tắc minh bạch (không phải AI), chỉ dựa trên chữ có trong CV của bạn.</p>
      ${m.met.length ? `<b class="src-ok">Đã đáp ứng</b>${list(m.met)}` : ''}
      ${m.missing.length ? `<b class="src-bad">Còn thiếu / chưa thể hiện</b>${list(m.missing)}` : ''}
      <b>Lý do đánh giá</b>${list(m.reasons)}
      <b>Gợi ý chỉnh CV</b>${list(cvSuggestions(j, m))}
      <div class="actions">
        <button class="btn" data-action="cover" data-id="${esc(id)}">Soạn thư ứng tuyển</button>
        <button class="btn" data-action="email" data-id="${esc(id)}">Soạn email</button>
        <button class="btn" data-action="aiprompt" data-id="${esc(id)}">Sao chép prompt cho AI</button>
      </div>` : '<p class="kv">Nhập hồ sơ/CV ở tab Hồ sơ để xem đối chiếu.</p>'}
    <div id="draft"></div>`);
}

function draftBox(title, text) {
  $('#draft').innerHTML = `<h4>${esc(title)}</h4><p class="kv">Bản nháp để bạn tự xem lại và chỉnh sửa. Ứng dụng không tự gửi.</p><textarea id="draft-text" style="min-height:240px">${esc(text)}</textarea><div class="actions"><button class="btn" data-action="copy-draft">Sao chép</button></div>`;
  $('#draft').scrollIntoView?.({ block: 'nearest' });
}

function manualDialog(type, prefill = {}) {
  openDlg(`<h3>Thêm mục thủ công</h3>
    <p class="kv">Dùng khi nguồn không tự lấy được. Mục này đánh dấu “Chưa xác minh”.</p>
    <label>Loại</label><select id="m-type"><option value="game" ${type === 'game' ? 'selected' : ''}>Game</option><option value="job" ${type === 'job' ? 'selected' : ''}>Việc làm</option></select>
    <label>Tên game / chức danh</label><input id="m-name" value="${esc(prefill.name || '')}">
    <label>Công ty (việc làm) / nhà phát hành (game)</label><input id="m-org">
    <label>Địa điểm (việc làm, cách nhau dấu phẩy)</label><input id="m-loc">
    <label>Liên kết</label><input id="m-url" type="url" value="${esc(prefill.url || '')}">
    <label>Ngày phát hành dự kiến (game) / hạn ứng tuyển (việc làm)</label><input id="m-date" type="date">
    <label>Nền tảng (game)</label><select id="m-plat"><option>Android</option><option>iOS</option></select>
    <div class="actions"><button class="btn pri" data-action="save-manual">Lưu</button></div>`);
}

function notifDialog() {
  openDlg(`<h3>Thông báo</h3>${app.notifs.length ? app.notifs.map((n) => `<div class="card"><b>${esc(n.title)}</b><div class="sub" style="white-space:pre-line">${esc(n.body)}</div><div class="kv">${fmtDateTime(n.at)}${n.url ? ` · <a target="_blank" rel="noopener" href="${esc(n.url)}">Mở</a>` : ''}</div></div>`).join('') : empty('Chưa có thông báo.')}`);
  app.notifs.forEach((n) => { n.read = true; });
  app.store.set('notifs', app.notifs); updateBadge();
}

// ---------------- Điều hướng & sự kiện ----------------
const TITLES = { home: 'Trang chủ', games: 'Game mới', jobs: 'Việc làm môi trường/HSE', saved: 'Đã lưu', profile: 'Hồ sơ & cài đặt' };
function route() {
  const tab = (location.hash.replace('#', '') || 'home');
  const name = views[tab] ? tab : 'home';
  $('#title').textContent = TITLES[name];
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  $('#view').innerHTML = views[name]();
  if (name === 'games') gamesList();
  if (name === 'jobs') jobsList();
  window.scrollTo(0, 0);
}
function rerender() {
  const y = window.scrollY; const d = $('#dlg');
  const tab = location.hash.replace('#', '') || 'home';
  if (tab === 'games' || tab === 'jobs') { (tab === 'games' ? gamesList : jobsList)(); } else { route(); window.scrollTo(0, y); }
  void d;
}

async function saveProfile() {
  const p = {};
  document.querySelectorAll('[data-profile]').forEach((el) => { p[el.dataset.profile] = el.value; });
  app.profile = p; await app.store.set('profile', p);
  toast('Đã lưu hồ sơ');
  await processNotifications();
}

const actions = {
  close: closeDlg,
  'open-notifs': notifDialog,
  refresh: async () => { toast('Đang làm mới…'); await loadData(true); await processNotifications(); route(); toast(app.data.loadError ? 'Làm mới thất bại' : 'Đã làm mới dữ liệu'); },
  'open-game': (el) => gameDialog(el.dataset.id),
  'open-job': (el) => jobDialog(el.dataset.id),
  'fav-game': async (el) => { const g = findGame(el.dataset.id); const st = app.user.game(el.dataset.id); await app.user.patchGame(el.dataset.id, { fav: !st.fav }, g); if (el.dataset.reopen) gameDialog(el.dataset.id); rerender(); },
  played: async (el) => { const g = findGame(el.dataset.id); const st = app.user.game(el.dataset.id); await app.user.patchGame(el.dataset.id, { played: !st.played }, g); gameDialog(el.dataset.id); rerender(); },
  'fav-job': async (el) => { const j = findJob(el.dataset.id); const st = app.user.job(el.dataset.id); await app.user.patchJob(el.dataset.id, { fav: !st.fav }, j); if (el.dataset.reopen) jobDialog(el.dataset.id); rerender(); },
  'game-seg': (el) => { app.gameSeg = el.dataset.k; route(); },
  'game-plat': (el) => { app.filters.games.platform = el.dataset.k; route(); },
  more: (el) => { app.limit[el.dataset.k] += 40; rerender(); },
  'add-manual': (el) => manualDialog(el.dataset.type),
  'save-manual': async () => {
    const type = $('#m-type').value; const name = $('#m-name').value.trim();
    if (!name) { toast('Cần nhập tên/chức danh'); return; }
    const url = $('#m-url').value.trim(); const date = $('#m-date').value; const now = new Date().toISOString();
    const base = { id: `manual:${Date.now()}`, name, source: 'Nhập thủ công', sourceUrl: safeUrl(url), firstSeenAt: now, updatedAt: now };
    if (type === 'game') app.manual.games.unshift({ ...base, kind: 'manual', status: date && Date.parse(date) > Date.now() ? 'upcoming' : 'released', platforms: [$('#m-plat').value], releaseDate: date || null, developer: $('#m-org').value, description: 'Mục nhập thủ công – chưa xác minh.' });
    else app.manual.jobs.unshift({ ...base, title: name, company: $('#m-org').value, locations: $('#m-loc').value.split(',').map((s) => s.trim()).filter(Boolean), validThrough: date || null, datePosted: now.slice(0, 10), salary: null, expMonths: null, description: 'Mục nhập thủ công – chưa xác minh.', verification: 'Chưa xác minh (nhập thủ công)', relevance: 100, tags: [] });
    await app.store.set('manual', app.manual); closeDlg(); route(); toast('Đã thêm');
  },
  'save-profile': saveProfile,
  cover: (el) => { const j = findJob(el.dataset.id); draftBox('Thư ứng tuyển (bản nháp)', coverLetter(j, app.profile, matchOf(j))); },
  email: (el) => { const j = findJob(el.dataset.id); const e = emailDraft(j, app.profile, matchOf(j)); draftBox('Email (bản nháp)', `Tiêu đề: ${e.subject}\n\n${e.body}`); },
  aiprompt: async (el) => { const j = findJob(el.dataset.id); await navigator.clipboard?.writeText(aiPrompt(j, app.profile)).catch(() => {}); draftBox('Prompt cho trợ lý AI (đã sao chép nếu trình duyệt cho phép)', aiPrompt(j, app.profile)); },
  'copy-draft': async () => { const t = $('#draft-text'); try { await navigator.clipboard.writeText(t.value); toast('Đã sao chép'); } catch { t.select(); toast('Hãy bấm giữ để sao chép'); } },
  export: () => {
    const blob = new Blob([JSON.stringify({ version: 1, at: new Date().toISOString(), state: app.user.raw(), profile: app.profile, settings: app.settings, manual: app.manual }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'game-job-backup.json'; a.click();
  },
  wipe: async () => { if (!confirm('Xóa toàn bộ dữ liệu cá nhân (hồ sơ, đã lưu, ghi chú)?')) return; for (const k of await app.store.keys()) await app.store.del(k); location.reload(); },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  e.preventDefault(); e.stopPropagation();
  actions[el.dataset.action]?.(el);
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.filter) {
    const [scope, key] = el.dataset.filter.split('.');
    app.filters[scope][key] = el.type === 'checkbox' ? el.checked : el.value;
    app.limit[scope] = 40;
    (scope === 'games' ? gamesList : jobsList)();
  }
});
document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset.jobfield) {
    await app.user.patchJob(el.dataset.id, { [el.dataset.jobfield]: el.value }, findJob(el.dataset.id));
    toast('Đã lưu'); rerender();
  }
  if (el.dataset.setting) {
    const k = el.dataset.setting; const v = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? Number(el.value) : el.value);
    if (k === 'notify' && v && 'Notification' in window && Notification.permission !== 'granted') {
      const r = await Notification.requestPermission();
      if (r !== 'granted') { el.checked = false; toast('Bạn chưa cấp quyền thông báo'); return; }
      await registerPeriodic();
    }
    app.settings[k] = v; await app.store.set('settings', app.settings);
    if (k === 'defLocation') app.filters.jobs.location = v;
    toast('Đã lưu cài đặt');
  }
  if (el.id === 'cvfile' && el.files[0]) {
    const text = await el.files[0].text(); $('#p-cvText').value = text; toast('Đã nạp CV, bấm “Lưu hồ sơ”');
  }
  if (el.dataset.import !== undefined && el.files[0]) {
    try {
      const b = JSON.parse(await el.files[0].text());
      await app.store.set('state', b.state); await app.store.set('profile', b.profile || {}); await app.store.set('settings', b.settings || app.settings); await app.store.set('manual', b.manual || { games: [], jobs: [] });
      location.reload();
    } catch { toast('Tệp sao lưu không hợp lệ'); }
  }
});
window.addEventListener('hashchange', route);

async function registerPeriodic() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) await reg.periodicSync.register('check-updates', { minInterval: 12 * 3600 * 1000 });
  } catch { /* không hỗ trợ */ }
}

// ---------------- Khởi động ----------------
async function init() {
  app.store = await createStore();
  app.user = createUserState(app.store);
  await app.user.load();
  app.profile = (await app.store.get('profile')) || {};
  app.settings = { ...app.settings, ...((await app.store.get('settings')) || {}) };
  app.manual = (await app.store.get('manual')) || app.manual;
  app.notifs = (await app.store.get('notifs')) || [];
  app.seen = (await app.store.get('seen')) || null;
  if (app.settings.defLocation) app.filters.jobs.location = app.settings.defLocation;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await loadData();
  await processNotifications();
  route();
  const q = new URLSearchParams(location.search);
  if (q.has('share_url') || q.has('share_text') || q.has('share_title')) {
    const url = (q.get('share_url') || q.get('share_text') || '').match(/https?:\/\/\S+/)?.[0] || '';
    manualDialog(/job|tuyen|viec|career|topcv|vietnamworks/i.test(url) ? 'job' : 'game', { name: q.get('share_title') || '', url });
  }
}
init();




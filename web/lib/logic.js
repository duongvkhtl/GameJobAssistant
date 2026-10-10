// Logic thuần (không phụ thuộc DOM) – dùng chung cho ứng dụng, bộ thu thập dữ liệu và kiểm thử.

export function stripDiacritics(s = '') {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
}
export const norm = (s) => stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim();

export function htmlToText(html = '') {
  return String(html)
    .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// ---------- Việc làm: mức liên quan tới lĩnh vực môi trường/HSE ----------
const TITLE_RX = [
  /\b(hse|ehs|ehss|hsse)\b/i, /\bsafety\b/i, /\benvironment(al)?\b/i, /\bsustainab/i, /\besg\b/i,
  /an toan|moi truong|bao ho lao dong|atvsld|phong chay|pccc|nuoc thai|chat thai|khi thai|xu ly nuoc|phat trien ben vung|ben vung|quan trac|iso ?14001|iso ?45001|ve sinh lao dong|bao ve moi truong|carbon/,
];
const BODY_RX = [
  /iso ?14001/, /iso ?45001/, /\b(hse|ehs)\b/i, /an toan lao dong|an toan ve sinh lao dong|atvsld/, /quan ly moi truong|bao ve moi truong/,
  /xu ly nuoc thai|chat thai|khi thai|quan trac moi truong/, /\besg\b/i, /phat trien ben vung/,
];

/** Trả về điểm 0..100: 0 nghĩa là không thuộc lĩnh vực quan tâm. */
export function jobRelevance(job) {
  const title = job.title || '';
  const t = norm(title);
  let score = 0;
  for (const rx of TITLE_RX) if (rx.test(title) || rx.test(t)) score += 60;
  if (/\bSHE\b/.test(title)) score += 60; // phân biệt với đại từ tiếng Anh: chỉ nhận SHE viết hoa trong tiêu đề
  const body = norm(`${job.description || ''} ${job.industry || ''}`);
  for (const rx of BODY_RX) if (rx.test(body)) score += 8;
  if (/an toan lao dong|moi truong|hse|ehs/.test(norm(job.industry || ''))) score += 10;
  return Math.min(100, score);
}

export function categorizeJob(job) {
  const txt = norm(`${job.title} ${job.industry || ''}`);
  const tags = [];
  if (/\b(hse|ehs|she|hsse|ehss)\b/.test(txt)) tags.push('HSE/EHS');
  if (/an toan|bao ho lao dong|atvsld|phong chay|pccc/.test(txt)) tags.push('An toàn lao động');
  if (/nuoc thai|chat thai|khi thai|xu ly nuoc|quan trac/.test(txt)) tags.push('Chất thải/Nước thải');
  if (/iso ?14001|iso ?45001|iso/.test(txt)) tags.push('ISO');
  if (/esg|ben vung|sustainab|carbon/.test(txt)) tags.push('ESG/Bền vững');
  if (/moi truong|environment/.test(txt) && !tags.includes('Chất thải/Nước thải')) tags.push('Môi trường');
  return tags;
}

/** Trích thông tin yêu cầu (bằng cấp/chứng chỉ) từ mô tả – chỉ lấy những dòng có thật trong tin. */
export function extractRequirements(descText = '') {
  const lines = descText.split(/\n+/).map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
  const degree = lines.filter((l) => /tot nghiep|cao dang|dai hoc|trung cap|bang cap|chuyen nganh/.test(norm(l))).slice(0, 3);
  const certs = lines.filter((l) => /chung chi|chung nhan|iso ?\d{4,5}|huan luyen|giay chung nhan/.test(norm(l))).slice(0, 4);
  return { degree, certs };
}

export function formatSalary(s) {
  if (!s || (s.min == null && s.max == null)) return 'Thỏa thuận / không công bố';
  const f = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)} triệu` : `${n.toLocaleString('vi-VN')}`);
  const unit = s.unit === 'YEAR' ? '/năm' : s.unit === 'HOUR' ? '/giờ' : '/tháng';
  const cur = s.currency && s.currency !== 'VND' ? ` ${s.currency}` : '';
  if (s.min != null && s.max != null && s.min !== s.max) return `${f(s.min)} - ${f(s.max)}${cur} ${unit}`;
  return `${f(s.max ?? s.min)}${cur} ${unit}`;
}

export function daysUntil(dateStr, now = Date.now()) {
  if (!dateStr) return null;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now) / 86400000);
}

export function freshness(iso, now = Date.now()) {
  if (!iso) return { label: 'Không rõ', level: 'unknown' };
  const d = Math.floor((now - Date.parse(iso)) / 86400000);
  if (d <= 0) return { label: 'Hôm nay', level: 'fresh' };
  if (d <= 3) return { label: `${d} ngày trước`, level: 'fresh' };
  if (d <= 14) return { label: `${d} ngày trước`, level: 'ok' };
  return { label: `${d} ngày trước`, level: 'old' };
}

// ---------- Lọc / sắp xếp ----------
export function filterJobs(jobs, f = {}, now = Date.now()) {
  const q = f.q ? norm(f.q) : '';
  return jobs.filter((j) => {
    if (q && !norm(`${j.title} ${j.company} ${j.locations?.join(' ')} ${j.description || ''}`).includes(q)) return false;
    if (f.location && !(j.locations || []).some((l) => norm(l).includes(norm(f.location)))) return false;
    if (f.maxExpMonths != null && f.maxExpMonths !== '' && j.expMonths != null && j.expMonths > +f.maxExpMonths) return false;
    if (f.minSalary && !(j.salary && (j.salary.max ?? j.salary.min ?? 0) >= +f.minSalary)) return false;
    if (f.postedWithinDays && j.datePosted && (now - Date.parse(j.datePosted)) / 86400000 > +f.postedWithinDays) return false;
    if (f.tag && !(j.tags || []).includes(f.tag)) return false;
    if (f.hideExpired && j.validThrough && Date.parse(j.validThrough) < now) return false;
    if (f.employmentType && j.employmentType !== f.employmentType) return false;
    return true;
  });
}

export function sortJobs(jobs, by = 'date', match = {}) {
  const a = [...jobs];
  if (by === 'salary') a.sort((x, y) => (y.salary?.max ?? y.salary?.min ?? 0) - (x.salary?.max ?? x.salary?.min ?? 0));
  else if (by === 'deadline') a.sort((x, y) => (Date.parse(x.validThrough) || 9e15) - (Date.parse(y.validThrough) || 9e15));
  else if (by === 'match') a.sort((x, y) => (match[y.id]?.score ?? -1) - (match[x.id]?.score ?? -1));
  else a.sort((x, y) => (Date.parse(y.datePosted) || 0) - (Date.parse(x.datePosted) || 0));
  return a;
}

export function filterGames(games, f = {}) {
  const q = f.q ? norm(f.q) : '';
  return games.filter((g) => {
    if (q && !norm(`${g.name} ${g.genre || ''} ${g.developer || ''}`).includes(q)) return false;
    if (f.genre && g.genre !== f.genre) return false;
    if (f.platform && !(g.platforms || []).includes(f.platform)) return false;
    if (f.status && g.status !== f.status) return false;
    if (f.kind && g.kind !== f.kind) return false;
    return true;
  });
}

export function sortGames(games, by = 'release') {
  const a = [...games];
  if (by === 'updated') a.sort((x, y) => (Date.parse(y.updatedAt) || 0) - (Date.parse(x.updatedAt) || 0));
  else if (by === 'name') a.sort((x, y) => x.name.localeCompare(y.name, 'vi'));
  else a.sort((x, y) => (Date.parse(y.releaseDate || y.announcedAt) || 0) - (Date.parse(x.releaseDate || x.announcedAt) || 0));
  return a;
}

// ---------- Tin tức game: phân loại trạng thái theo từ khóa trong tiêu đề/tóm tắt ----------
const NEWS_RULES = [
  ['preregister', /pre-?regist|pre-?order|dang ky truoc/],
  ['beta', /\b(closed|open)? ?beta\b|alpha test|soft[- ]?launch|soft[- ]?launches|playtest|cbt\b|test(ing)? (phase|region)/],
  ['upcoming', /release date|launch(es|ing)? (on|in|this|next|globally|worldwide)|coming (to|soon)|arrives? (on|in)|announced|announces|revealed|reveals|trailer|set to (launch|release)|will (launch|release)|out (on|this|next)/],
  ['released', /now (available|out|live)|out now|has (launched|released)|(launched|released) (globally|worldwide|today)|available now/],
];
export function classifyNewsStatus(text) {
  const t = norm(text);
  for (const [k, rx] of NEWS_RULES) if (rx.test(t)) return k;
  return null;
}
export const GAME_NEWS_FILTER = /mobile|android|ios|iphone|\bapp\b|gacha|rpg|soft[- ]?launch|pre-?regist|\bbeta\b|launch|release/i;
export const STATUS_LABEL = {
  released: 'Đã phát hành',
  preregister: 'Đăng ký trước',
  beta: 'Thử nghiệm / Soft launch',
  upcoming: 'Sắp ra mắt (tin công bố)',
};

// ---------- Trùng lặp ----------
export function dedupe(items, keyFn) {
  const seen = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!seen.has(k)) seen.set(k, it);
  }
  return [...seen.values()];
}
export const jobDedupeKey = (j) => norm(`${j.title}|${j.company}|${(j.locations || [])[0] || ''}`);
export const gameDedupeKey = (g) => norm(g.name).replace(/[^a-z0-9]+/g, '');

// ---------- Chuẩn hóa địa điểm: quận/huyện -> tỉnh/thành (để lọc theo tỉnh/thành đúng) ----------
const DISTRICTS = {
  'Hồ Chí Minh': 'thu duc,tan binh,binh thanh,go vap,phu nhuan,tan phu,binh tan,binh chanh,hoc mon,cu chi,nha be,can gio,quan 1,quan 2,quan 3,quan 4,quan 5,quan 6,quan 7,quan 8,quan 9,quan 10,quan 11,quan 12,tp hcm,tphcm,tp ho chi minh,ho chi minh city,sai gon,ho chi minh',
  'Hà Nội': 'cau giay,thanh xuan,hoang mai,ha dong,dong da,ba dinh,hai ba trung,long bien,nam tu liem,bac tu liem,tay ho,hoan kiem,gia lam,dong anh,soc son,thanh tri,thach that,hoai duc,hanoi,ha noi',
  'Đồng Nai': 'bien hoa,long thanh,nhon trach,trang bom,dong nai',
  'Bình Dương': 'thuan an,di an,thu dau mot,ben cat,tan uyen,binh duong',
  'Bà Rịa Vũng Tàu': 'vung tau,phu my,ba ria,ba ria vung tau',
  'Nam Định': 'y yen,nam dinh',
  'Hải Phòng': 'hai phong',
};
const DISTRICT_MAP = new Map(Object.entries(DISTRICTS).flatMap(([prov, list]) => list.split(',').map((d) => [d, prov])));
export function normalizeLocation(loc) {
  const k = norm(loc).replace(/\./g, '').replace(/^(thanh pho|tinh|huyen)\s+/, '').replace(/^tp\s+/, 'tp ');
  return DISTRICT_MAP.get(k) || String(loc).trim();
}
export const EMPLOYMENT_LABEL = { FULL_TIME: 'Toàn thời gian', PART_TIME: 'Bán thời gian', CONTRACTOR: 'Hợp đồng', TEMPORARY: 'Thời vụ', INTERN: 'Thực tập', INTERNSHIP: 'Thực tập', OTHER: 'Khác' };


// Nguồn việc làm: 123job.vn
// - robots.txt chỉ chặn /ajax và /apply (đã kiểm tra 10/2026) -> trang tìm kiếm & chi tiết được phép đọc.
// - Trang chi tiết có JSON-LD JobPosting (+ lương/kinh nghiệm trong HTML). Không có thì để trống, không suy đoán.
// - Nhẹ nhàng: 1 request / 2 giây, lọc theo tiêu đề (slug) trước khi tải chi tiết, tối đa MAX_DETAIL, tự ngắt khi nguồn lỗi liên tiếp.
import { getText } from '../http.mjs';
import { htmlToText, jobRelevance, categorizeJob, extractRequirements } from '../../web/lib/logic.js';

const BASE = 'https://123job.vn';
export const SOURCE_ID = 'job123';
export const KEYWORDS = ['hse', 'ehs', 'an toàn lao động', 'môi trường', 'iso 14001', 'iso 45001', 'xử lý nước thải', 'chất thải', 'esg', 'phát triển bền vững', 'quan trắc', 'pccc'];
const MAX_DETAIL = 80;
const HTTP = { delay: 3500, retries: 0, timeout: 20000 };
const MAX_CONSECUTIVE_FAILS = 3;

const idFromUrl = (u) => u.match(/\/viec-lam\/[^/?]*-([A-Za-z0-9]+)(?:\?|$)/)?.[1] || null;

export function parseSearchHtml(html) {
  const out = new Map();
  for (const m of html.matchAll(/href="(https:\/\/123job\.vn\/viec-lam\/([^"?\/]+))(?:\?[^"]*)?"/g)) {
    const slug = m[2].replace(/-[A-Za-z0-9]{8,12}$/, '');
    out.set(m[1], { url: m[1], name: slug.replace(/-/g, ' ') });
  }
  return [...out.values()];
}

function parseValue(html, label) {
  const m = html.match(new RegExp(`<span[^>]*>${label}</span></div><div class="value[^"]*"><span>([^<]*)</span>`));
  return m ? htmlToText(m[1]).trim() : '';
}

export function parseSalaryText(t = '') {
  const s = t.toLowerCase();
  const nums = [...s.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((x) => parseFloat(x[1].replace(',', '.')));
  if (!nums.length || !/tri[eệ]u|usd|\$/.test(s)) return null;
  const mult = /usd|\$/.test(s) ? 1 : 1e6;
  const cur = /usd|\$/.test(s) ? 'USD' : 'VND';
  if (/tr[eê]n|từ|tu\b|>=/.test(s) && nums.length === 1) return { min: nums[0] * mult, max: null, currency: cur, unit: 'MONTH' };
  if (/d[uư][oớ]i|up to|tối đa/.test(s) && nums.length === 1) return { min: null, max: nums[0] * mult, currency: cur, unit: 'MONTH' };
  if (nums.length >= 2) return { min: nums[0] * mult, max: nums[1] * mult, currency: cur, unit: 'MONTH' };
  return { min: nums[0] * mult, max: nums[0] * mult, currency: cur, unit: 'MONTH' };
}

export function parseExperienceMonths(t = '') {
  const s = t.toLowerCase();
  if (/kh[oô]ng y[eê]u c[aầ]u|ch[uư]a c[oó] kinh nghi[eệ]m|kh[oô]ng c[aầ]n/.test(s)) return 0;
  if (/d[uư][oớ]i 1 n[aă]m/.test(s)) return 0;
  const n = s.match(/(\d+(?:[.,]\d+)?)/);
  return n && /n[aă]m/.test(s) ? Math.round(parseFloat(n[1].replace(',', '.')) * 12) : null;
}

export function parseJobPage(html, url) {
  let data = null;
  for (const m of html.matchAll(/<script type=["']?application\/ld\+json["']?>\s*([\s\S]*?)\s*<\/script>/g)) {
    try { const o = JSON.parse(m[1]); if (o['@type'] === 'JobPosting') { data = o; break; } } catch { /* tiếp */ }
  }
  if (!data) return null;
  const loc = data.jobLocation?.address;
  const locations = [...new Set([loc?.addressRegion || loc?.addressLocality].filter(Boolean))].slice(0, 1);
  const description = htmlToText(data.description || '').replace(/([.;:])\s*-\s+(?=\S)/g, '$1\n- ');
  const salaryText = parseValue(html, 'Mức lương');
  const expText = parseValue(html, 'Kinh nghiệm yêu cầu');
  const id = idFromUrl(url);
  const job = {
    id: `${SOURCE_ID}:${id}`,
    source: '123job.vn',
    sourceUrl: url,
    title: (data.title || '').trim(),
    company: data.hiringOrganization?.name || '',
    companyLogo: data.hiringOrganization?.logo || null,
    locations,
    salary: parseSalaryText(salaryText),
    salaryText: salaryText || null,
    expMonths: parseExperienceMonths(expText),
    employmentType: [].concat(data.employmentType || [])[0] || null,
    industry: data.industry || '',
    datePosted: data.datePosted || null,
    validThrough: data.validThrough ? (data.validThrough.length === 10 ? `${data.validThrough}T23:59:59+07:00` : data.validThrough) : null,
    description: description.slice(0, 6000),
  };
  job.requirements = extractRequirements(description);
  job.tags = categorizeJob(job);
  job.relevance = jobRelevance(job);
  return job;
}

export async function fetchJobs(previous = new Map(), log = console.log) {
  const cands = new Map();
  const errors = [];
  let fails = 0;
  outer: for (const kw of KEYWORDS) {
    for (let p = 1; p <= 2; p++) {
      try {
        const items = await parseSearchHtmlFetch(kw, p);
        fails = 0;
        for (const it of items) {
          const id = idFromUrl(it.url);
          if (id && !cands.has(id) && jobRelevance({ title: it.name }) >= 45) cands.set(id, it);
        }
        if (items.length < 20) break;
      } catch (e) {
        errors.push(`search "${kw}" p${p}: ${e.message}`);
        if (++fails >= MAX_CONSECUTIVE_FAILS) { errors.push('Nguồn không phản hồi liên tiếp – dừng để không gây tải.'); break outer; }
        break;
      }
    }
  }
  log(`[123job] ${cands.size} tin có tiêu đề liên quan`);
  const now = new Date().toISOString();
  const jobs = [];
  let fetched = 0; fails = 0;
  for (const [id, { url }] of cands) {
    const prev = previous.get(`${SOURCE_ID}:${id}`);
    if (prev?.verifiedAt && Date.now() - Date.parse(prev.verifiedAt) < 3 * 86400000) { jobs.push(prev); continue; }
    if (fetched >= MAX_DETAIL) { if (prev) jobs.push(prev); continue; }
    try {
      const job = parseJobPage(await getText(url, HTTP), url);
      fetched++; fails = 0;
      if (!job) { errors.push(`không có JobPosting: ${url}`); continue; }
      Object.assign(job, { firstSeenAt: prev?.firstSeenAt || now, fetchedAt: now, verifiedAt: now, verification: 'Dữ liệu đọc trực tiếp từ trang tuyển dụng gốc (JSON-LD JobPosting)' });
      jobs.push(job);
    } catch (e) {
      errors.push(`detail ${url}: ${e.message}`);
      if (prev) jobs.push(prev);
      if (/429/.test(e.message)) { errors.push('Nguồn báo quá tải (429) – dừng, sẽ tiếp tục ở lần chạy sau.'); break; }
      if (++fails >= MAX_CONSECUTIVE_FAILS) { errors.push('Nguồn không phản hồi liên tiếp – dừng.'); break; }
    }
  }
  log(`[123job] tải ${fetched} trang chi tiết, ${jobs.length} tin, ${errors.length} lỗi`);
  return { jobs, errors };
}

async function parseSearchHtmlFetch(kw, page) {
  return parseSearchHtml(await getText(`${BASE}/tuyen-dung?q=${encodeURIComponent(kw)}&page=${page}`, HTTP));
}



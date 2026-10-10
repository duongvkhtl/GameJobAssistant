// Nguồn việc làm: CareerLink.vn
// - Robots.txt cho phép /vieclam/tim-kiem-viec-lam và /tim-viec-lam/* (đã kiểm tra).
// - Trang chi tiết có JSON-LD chuẩn schema.org/JobPosting -> dữ liệu có cấu trúc, không cần vượt cơ chế bảo vệ nào.
// - Rất nhẹ nhàng: 1 request / 2 giây, chỉ tải trang chi tiết của tin có TIÊU ĐỀ liên quan, tối đa MAX_DETAIL mỗi lần,
//   tin đã tải được dùng lại 3 ngày. Nếu bị chặn/timeout liên tiếp thì dừng ngay và giữ dữ liệu cũ (không cố vượt qua).
import { getText } from '../http.mjs';
import { htmlToText, jobRelevance, categorizeJob, extractRequirements } from '../../web/lib/logic.js';

const BASE = 'https://www.careerlink.vn';
export const SOURCE_ID = 'careerlink';
export const KEYWORDS = [
  'HSE', 'EHS', 'an toàn lao động', 'môi trường', 'ISO 14001', 'ISO 45001',
  'xử lý nước thải', 'quản lý chất thải', 'ESG', 'phát triển bền vững', 'quan trắc môi trường', 'PCCC',
];
const MAX_DETAIL = 80;
const DELAY = 2000;
const MAX_CONSECUTIVE_FAILS = 3;
const HTTP = { delay: DELAY, retries: 1, timeout: 20000 };

const jobIdFromUrl = (u) => u.match(/\/(\d+)(?:\?|$)/)?.[1] || null;

export function parseSearchHtml(html) {
  const out = [];
  for (const m of html.matchAll(/"name":"([^"]*)","url":"(https:\/\/www\.careerlink\.vn\/tim-viec-lam\/[^"]+\/\d+)"/g)) {
    out.push({ name: JSON.parse(`"${m[1]}"`).trim(), url: m[2] });
  }
  return out;
}

async function searchItems(keyword, page) {
  return parseSearchHtml(await getText(`${BASE}/vieclam/tim-kiem-viec-lam?keyword=${encodeURIComponent(keyword)}&page=${page}`, HTTP));
}

export function parseJobPosting(html, url) {
  for (const m of html.matchAll(/<script type=['"]application\/ld\+json['"]>\s*([\s\S]*?)\s*<\/script>/g)) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    if (data['@type'] !== 'JobPosting') continue;
    const sal = data.baseSalary?.value;
    const locs = [].concat(data.jobLocation || []).map((l) => l?.address?.addressLocality || l?.address?.addressRegion).filter(Boolean);
    const description = htmlToText(data.description || '');
    const job = {
      id: `${SOURCE_ID}:${data.identifier?.value || jobIdFromUrl(url)}`,
      source: 'CareerLink',
      sourceUrl: url,
      title: (data.title || '').trim(),
      company: data.hiringOrganization?.name || '',
      companyLogo: data.hiringOrganization?.logo || null,
      locations: [...new Set(locs)],
      salary: sal && (sal.minValue != null || sal.maxValue != null)
        ? { min: sal.minValue ?? null, max: sal.maxValue ?? null, currency: data.baseSalary.currency || 'VND', unit: sal.unitText || 'MONTH' }
        : null,
      expMonths: data.experienceRequirements?.monthsOfExperience != null ? Number(data.experienceRequirements.monthsOfExperience) : null,
      employmentType: [].concat(data.employmentType || [])[0] || null,
      industry: data.industry || '',
      datePosted: data.datePosted || null,
      validThrough: data.validThrough || null,
      description: description.slice(0, 6000),
    };
    job.requirements = extractRequirements(description);
    job.tags = categorizeJob(job);
    job.relevance = jobRelevance(job);
    return job;
  }
  return null;
}

/** previous: Map id -> job đã có (giữ firstSeen, tái sử dụng tin tải trong 3 ngày gần nhất). */
export async function fetchJobs(previous = new Map(), log = console.log) {
  const cands = new Map(); // id -> {url,name}
  const errors = [];
  let fails = 0;
  outer: for (const kw of KEYWORDS) {
    for (let p = 1; p <= 2; p++) {
      try {
        const items = await searchItems(kw, p);
        fails = 0;
        for (const it of items) {
          const id = jobIdFromUrl(it.url);
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
  log(`[careerlink] ${cands.size} tin có tiêu đề liên quan`);

  const now = new Date().toISOString();
  const jobs = [];
  let fetched = 0;
  fails = 0;
  for (const [id, { url }] of cands) {
    const prev = previous.get(`${SOURCE_ID}:${id}`);
    if (prev?.verifiedAt && Date.now() - Date.parse(prev.verifiedAt) < 3 * 86400000) { jobs.push(prev); continue; }
    if (fetched >= MAX_DETAIL) { if (prev) jobs.push(prev); continue; }
    try {
      const html = await getText(url, HTTP);
      fetched++; fails = 0;
      const job = parseJobPosting(html, url);
      if (!job) { errors.push(`không có JobPosting: ${url}`); continue; }
      job.firstSeenAt = prev?.firstSeenAt || now;
      job.fetchedAt = now;
      job.verifiedAt = now;
      job.verification = 'Dữ liệu đọc trực tiếp từ trang tuyển dụng gốc (JSON-LD JobPosting)';
      jobs.push(job);
    } catch (e) {
      errors.push(`detail ${url}: ${e.message}`);
      if (prev) jobs.push(prev);
      if (++fails >= MAX_CONSECUTIVE_FAILS) { errors.push('Nguồn không phản hồi liên tiếp – dừng.'); break; }
    }
  }
  log(`[careerlink] tải ${fetched} trang chi tiết, ${jobs.length} tin, ${errors.length} lỗi`);
  return { jobs, errors };
}

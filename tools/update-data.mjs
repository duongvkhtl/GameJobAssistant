// Thu thập dữ liệu -> web/data/{games,jobs,meta}.json. Chạy: node tools/update-data.mjs [games|jobs]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fetchAppleGames } from './sources/itunes.mjs';
import { fetchGameNews } from './sources/rss.mjs';
import { fetchJobs as fetchCareerLink } from './sources/careerlink.mjs';
import { fetchJobs as fetchJob123 } from './sources/job123.mjs';
import { dedupe, jobDedupeKey, gameDedupeKey, jobRelevance, categorizeJob, normalizeLocation } from '../web/lib/logic.js';

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'data');
const only = process.argv[2];
const nowIso = new Date().toISOString();

async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(path.join(DATA, name), 'utf8')); } catch { return fallback; }
}
const write = (name, obj) => writeFile(path.join(DATA, name), JSON.stringify(obj, null, 1), 'utf8');

await mkdir(DATA, { recursive: true });
const meta = await readJson('meta.json', { sources: {} });
const MIN_RELEVANCE = 30;

if (!only || only === 'games') {
  const prev = await readJson('games.json', { items: [] });
  const prevById = new Map(prev.items.map((g) => [g.id, g]));
  const [apple, rss] = await Promise.all([fetchAppleGames(), fetchGameNews()]);
  let items = [...apple.games, ...rss.news].map((g) => ({ ...g, firstSeenAt: prevById.get(g.id)?.firstSeenAt || nowIso, fetchedAt: nowIso }));
  // Nếu một nguồn lỗi hoàn toàn, giữ dữ liệu cũ của nguồn đó thay vì làm trống danh sách.
  if (!apple.games.length) items.push(...prev.items.filter((g) => g.kind === 'store'));
  if (!rss.news.length) items.push(...prev.items.filter((g) => g.kind === 'news'));
  items = dedupe(items, (g) => (g.kind === 'store' ? gameDedupeKey(g) : g.id));
  const cutoff = Date.now() - 120 * 86400000;
  items = items.filter((g) => !(g.kind === 'news' && Date.parse(g.announcedAt) < cutoff));
  await write('games.json', { generatedAt: nowIso, items });
  meta.sources.apple = { name: 'Apple iTunes API', ok: apple.games.length > 0, count: apple.games.length, at: nowIso, errors: apple.errors.slice(0, 5), note: 'API công khai chính thức; chỉ iOS (App Store VN).' };
  meta.sources.news = { name: 'Pocket Gamer + TouchArcade RSS', ok: rss.news.length > 0, count: rss.news.length, at: nowIso, errors: rss.errors.slice(0, 5), note: 'Tin báo chí; ngày là ngày đăng tin, không phải ngày phát hành.' };
}

if (!only || only === 'jobs') {
  const prev = await readJson('jobs.json', { items: [] });
  const prevMap = new Map(prev.items.map((j) => [j.id, j]));
  const sources = [
    ['careerlink', 'CareerLink.vn', fetchCareerLink, 'JSON-LD JobPosting trên trang công khai, robots.txt cho phép, tốc độ thấp.'],
    ['job123', '123job.vn', fetchJob123, 'JSON-LD JobPosting + thông tin lương/kinh nghiệm trên trang công khai, robots.txt cho phép, tốc độ thấp.'],
  ];
  let all = [];
  for (const [id, name, fn, note] of sources) {
    let res;
    try { res = await fn(prevMap); } catch (e) { res = { jobs: [], errors: [e.message] }; }
    // Nguồn lỗi hoàn toàn: giữ lại tin cũ của nguồn đó
    // Giữ lại tin cũ của nguồn này dù lần quét này không thấy (nguồn có thể đang giới hạn tốc độ); tin hết hạn bị lọc bên dưới.
    const got = new Set(res.jobs.map((j) => j.id));
    const kept = [...res.jobs, ...prev.items.filter((j) => j.id.startsWith(`${id}:`) && !got.has(j.id))];
    all.push(...kept);
    meta.sources[id] = { name, ok: res.jobs.length > 0, count: kept.filter((j) => j.relevance >= MIN_RELEVANCE).length, at: nowIso, errors: res.errors.slice(0, 5), note };
  }
  for (const j of all) { j.relevance = jobRelevance(j); j.tags = categorizeJob(j); j.locations = [...new Set((j.locations || []).map(normalizeLocation))]; } // chấm lại theo quy tắc mới nhất
  let items = all.filter((j) => j.relevance >= MIN_RELEVANCE).sort((a, b) => b.relevance - a.relevance);
  items = dedupe(items, jobDedupeKey);
  // Bỏ tin đã hết hạn quá 14 ngày
  items = items.filter((j) => !j.validThrough || Date.parse(j.validThrough) > Date.now() - 14 * 86400000);
  await write('jobs.json', { generatedAt: nowIso, items });
}
meta.generatedAt = nowIso;
await write('meta.json', meta);
console.log('Xong:', Object.entries(meta.sources).map(([k, v]) => `${k}=${v.count}${v.ok ? '' : '(LỖI)'}`).join(' '));




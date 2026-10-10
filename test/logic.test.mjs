import test from 'node:test';
import assert from 'node:assert/strict';
import { norm, htmlToText, jobRelevance, categorizeJob, filterJobs, sortJobs, filterGames, sortGames, classifyNewsStatus, dedupe, jobDedupeKey, formatSalary, daysUntil, freshness } from '../web/lib/logic.js';
import { matchJob, coverLetter, emailDraft } from '../web/lib/match.js';
import { computeNotifications } from '../web/lib/notify.js';
import { createMemoryStore, createUserState } from '../web/lib/db.js';
import { parseRss } from '../tools/sources/rss.mjs';

const NOW = Date.parse('2026-10-10T00:00:00Z');
const jobs = [
  { id: 'a', title: 'Nhân viên HSE', company: 'Công ty A', locations: ['Hồ Chí Minh'], salary: { min: 15e6, max: 20e6, unit: 'MONTH' }, expMonths: 24, datePosted: '2026-10-08', validThrough: '2026-10-12T00:00:00Z', tags: ['HSE/EHS'], description: 'Yêu cầu ISO 45001, chứng chỉ an toàn lao động, tiếng Anh', relevance: 90 },
  { id: 'b', title: 'Kỹ sư môi trường', company: 'Công ty B', locations: ['Hà Nội'], salary: null, expMonths: 60, datePosted: '2026-09-01', validThrough: '2026-09-30T00:00:00Z', tags: ['Môi trường'], description: 'Xử lý nước thải, ISO 14001', relevance: 80 },
  { id: 'c', title: 'Chuyên viên ESG', company: 'Công ty C', locations: ['Hồ Chí Minh', 'Đồng Nai'], salary: { min: 25e6, max: 30e6 }, expMonths: 36, datePosted: '2026-10-09', validThrough: null, tags: ['ESG/Bền vững'], description: 'Báo cáo phát triển bền vững ESG', relevance: 70 },
];

test('norm bỏ dấu tiếng Việt', () => assert.equal(norm('Đồng Nai – Hồ Chí Minh'), 'dong nai – ho chi minh'));
test('htmlToText', () => assert.equal(htmlToText('<p>A &amp; B</p><p>- C</p>'), 'A & B\n- C'));

test('jobRelevance: HSE cao, vị trí kho thấp', () => {
  assert.ok(jobRelevance({ title: 'Nhân viên HSE', description: '' }) >= 45);
  assert.ok(jobRelevance({ title: 'An toàn lao động', description: 'ISO 45001' }) >= 45);
  assert.equal(jobRelevance({ title: 'Giám sát kho', description: 'quản lý kho hàng' }), 0);
  assert.equal(jobRelevance({ title: 'Sales Executive', description: 'she will report' }), 0, 'đại từ she không được tính là SHE');
  assert.ok(jobRelevance({ title: 'SHE Officer', description: '' }) >= 45);
});
test('categorizeJob', () => {
  assert.deepEqual(categorizeJob({ title: 'Kỹ sư xử lý nước thải', industry: '' }), ['Chất thải/Nước thải', 'Môi trường'].filter((t) => t !== 'Môi trường'));
  assert.ok(categorizeJob({ title: 'HSE Manager ISO 45001' }).includes('HSE/EHS'));
});

test('filterJobs: địa điểm, kinh nghiệm, lương, ngày đăng, hết hạn', () => {
  assert.deepEqual(filterJobs(jobs, { location: 'hồ chí minh' }, NOW).map((j) => j.id), ['a', 'c']);
  assert.deepEqual(filterJobs(jobs, { maxExpMonths: 24 }, NOW).map((j) => j.id), ['a']);
  assert.deepEqual(filterJobs(jobs, { minSalary: 25e6 }, NOW).map((j) => j.id), ['c']);
  assert.deepEqual(filterJobs(jobs, { postedWithinDays: 3 }, NOW).map((j) => j.id), ['a', 'c']);
  assert.deepEqual(filterJobs(jobs, { hideExpired: true }, NOW).map((j) => j.id), ['a', 'c']);
  assert.deepEqual(filterJobs(jobs, { q: 'nuoc thai' }, NOW).map((j) => j.id), ['b']);
  assert.deepEqual(filterJobs(jobs, { tag: 'ESG/Bền vững' }, NOW).map((j) => j.id), ['c']);
});
test('sortJobs', () => {
  assert.deepEqual(sortJobs(jobs, 'date').map((j) => j.id), ['c', 'a', 'b']);
  assert.deepEqual(sortJobs(jobs, 'salary').map((j) => j.id), ['c', 'a', 'b']);
  assert.deepEqual(sortJobs(jobs, 'deadline').map((j) => j.id), ['b', 'a', 'c']);
});

const games = [
  { id: '1', name: 'Hero Quest', genre: 'Role Playing', platforms: ['iOS'], status: 'released', releaseDate: '2026-09-01', updatedAt: '2026-09-02', kind: 'store' },
  { id: '2', name: 'Puzzle Pop', genre: 'Puzzle', platforms: ['Android'], status: 'upcoming', releaseDate: '2026-11-01', updatedAt: '2026-10-01', kind: 'store' },
];
test('filter/sort game', () => {
  assert.deepEqual(filterGames(games, { q: 'hero' }).map((g) => g.id), ['1']);
  assert.deepEqual(filterGames(games, { genre: 'Puzzle' }).map((g) => g.id), ['2']);
  assert.deepEqual(filterGames(games, { platform: 'Android' }).map((g) => g.id), ['2']);
  assert.deepEqual(filterGames(games, { status: 'upcoming' }).map((g) => g.id), ['2']);
  assert.deepEqual(sortGames(games, 'release').map((g) => g.id), ['2', '1']);
  assert.deepEqual(sortGames(games, 'name').map((g) => g.id), ['1', '2']);
});

test('classifyNewsStatus', () => {
  assert.equal(classifyNewsStatus('Game X opens pre-registration on Android'), 'preregister');
  assert.equal(classifyNewsStatus('Game X soft launches in the Philippines'), 'beta');
  assert.equal(classifyNewsStatus('Game X is now available worldwide'), 'released');
  assert.equal(classifyNewsStatus('Review: a great game'), null);
});
test('parseRss', () => {
  const xml = '<rss><channel><item><title><![CDATA[Foo &amp; Bar]]></title><link>https://x/y</link><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Hello</p>]]></description></item></channel></rss>';
  const [it] = parseRss(xml);
  assert.equal(it.title, 'Foo & Bar'); assert.equal(it.link, 'https://x/y'); assert.equal(it.summary, 'Hello');
});
test('dedupe', () => {
  const a = { title: 'HSE', company: 'X', locations: ['HCM'] };
  assert.equal(dedupe([a, { ...a }, { ...a, company: 'Y' }], jobDedupeKey).length, 2);
});
test('format & ngày', () => {
  assert.equal(formatSalary(null), 'Thỏa thuận / không công bố');
  assert.match(formatSalary({ min: 13e6, max: 15e6, unit: 'MONTH' }), /13 triệu - 15 triệu .*tháng/);
  assert.equal(daysUntil('2026-10-12T00:00:00Z', NOW), 2);
  assert.equal(freshness('2026-10-09', NOW).level, 'fresh');
  assert.equal(freshness(null).level, 'unknown');
});

const profile = { name: 'Nguyễn Văn A', years: '3', title: 'Cán bộ HSE', skills: 'ISO 45001, đánh giá rủi ro JSA, tiếng Anh giao tiếp', locations: 'Hồ Chí Minh', cvText: 'Có chứng chỉ huấn luyện an toàn lao động nhóm 4.' };
test('matchJob: đáp ứng/thiếu minh bạch, không bịa', () => {
  const m = matchJob(jobs[0], profile);
  assert.ok(m.hasProfile);
  assert.ok(m.met.includes('ISO 45001') && m.met.includes('Tiếng Anh'));
  assert.ok(!m.met.includes('ISO 14001'));
  const m2 = matchJob(jobs[1], profile);
  assert.ok(m2.missing.includes('ISO 14001') && m2.missing.includes('Xử lý nước thải'));
  assert.ok(m.score > m2.score);
  assert.ok(m.reasons.some((r) => /Địa điểm khớp/.test(r)));
});
test('matchJob không có hồ sơ → score null', () => assert.equal(matchJob(jobs[0], {}).score, null));
test('thư ứng tuyển chỉ chứa thông tin có thật', () => {
  const m = matchJob(jobs[0], profile);
  const txt = coverLetter(jobs[0], profile, m);
  assert.match(txt, /Nguyễn Văn A/); assert.match(txt, /ISO 45001/);
  assert.doesNotMatch(txt, /ISO 14001/);
  assert.match(emailDraft(jobs[0], profile, m).subject, /Nhân viên HSE/);
});

test('computeNotifications', () => {
  const g = [{ id: 'g1', kind: 'store', name: 'New', releaseDate: '2026-10-11' }, { id: 'g2', kind: 'store', name: 'Old', releaseDate: '2026-10-01' }];
  const state = { games: { g1: { fav: true } }, jobs: { a: { fav: true } } };
  const first = computeNotifications({ games: g, jobs }, state, null, {}, NOW);
  assert.ok(!first.some((n) => n.type === 'job' || n.id.startsWith('newgames')), 'lần đầu không báo hàng loạt');
  assert.ok(first.some((n) => n.id.startsWith('favgame:g1')));
  assert.ok(first.some((n) => n.id.startsWith('deadline:a')));
  const next = computeNotifications({ games: g, jobs }, state, { games: ['g2'], jobs: ['b'] }, {}, NOW);
  assert.ok(next.some((n) => n.id.startsWith('newgames')));
  assert.ok(next.some((n) => n.id.startsWith('newjobs') && n.body.includes('Nhân viên HSE')));
  const none = computeNotifications({ games: g, jobs }, state, { games: ['g1', 'g2'], jobs: ['a', 'b', 'c'] }, {}, NOW);
  assert.ok(!none.some((n) => n.id.startsWith('newgames') || n.id.startsWith('newjobs')));
});

test('trạng thái người dùng: yêu thích, ứng tuyển, ghi chú, snapshot', async () => {
  const store = createMemoryStore();
  const u = createUserState(store);
  await u.load();
  await u.patchJob('a', { fav: true, status: 'to_apply', note: 'gọi HR', deadline: '2026-10-20' }, jobs[0]);
  await u.patchGame('1', { played: true }, games[0]);
  const u2 = createUserState(store); await u2.load();
  assert.equal(u2.job('a').status, 'to_apply'); assert.equal(u2.job('a').note, 'gọi HR');
  assert.equal(u2.job('a').snapshot.title, 'Nhân viên HSE');
  assert.equal(u2.savedJobs().length, 1); assert.equal(u2.savedGames().length, 1);
  await u2.patchJob('a', { status: 'applied' });
  assert.equal(u2.job('a').snapshot.title, 'Nhân viên HSE', 'snapshot giữ nguyên khi chỉ đổi trạng thái');
});

import { normalizeLocation } from '../web/lib/logic.js';
test('normalizeLocation: quận/huyện → tỉnh/thành, giữ nguyên nếu không biết', () => {
  assert.equal(normalizeLocation('Tân Bình'), 'Hồ Chí Minh');
  assert.equal(normalizeLocation('Cầu Giấy'), 'Hà Nội');
  assert.equal(normalizeLocation('Ý Yên'), 'Nam Định');
  assert.equal(normalizeLocation('Long An'), 'Long An');
  assert.equal(normalizeLocation('TP.HCM'), 'Hồ Chí Minh');
});

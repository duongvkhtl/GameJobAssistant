import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJobPage, parseSearchHtml, parseSalaryText, parseExperienceMonths } from '../tools/sources/job123.mjs';

// Mẫu HTML thật của 123job.vn (đọc ngày 10/10/2026), đã rút gọn.
const detail = readFileSync(new URL('./fixtures/123job-detail.html', import.meta.url), 'utf8');
const search = readFileSync(new URL('./fixtures/123job-search.html', import.meta.url), 'utf8');

test('parseJobPage đọc JSON-LD thật; lương "Đang cập nhật" → null (không bịa)', () => {
  const j = parseJobPage(detail, 'https://123job.vn/viec-lam/ky-thuat-vien-hse-yreJzXpZqz');
  assert.equal(j.id, 'job123:yreJzXpZqz');
  assert.equal(j.title, 'Kỹ thuật viên HSE');
  assert.equal(j.company, 'BAF Viet Nam');
  assert.deepEqual(j.locations, ['Hồ Chí Minh']);
  assert.equal(j.salary, null);
  assert.equal(j.salaryText, 'Đang cập nhật');
  assert.equal(j.expMonths, null);
  assert.match(j.validThrough, /^2026-11-05T23:59:59/);
  assert.ok(j.relevance >= 60);
  assert.ok(!/<p>|<br>/.test(j.description));
});
test('parseSearchHtml', () => {
  const r = parseSearchHtml(search);
  assert.ok(r.length >= 3);
  assert.ok(r.every((x) => x.url.startsWith('https://123job.vn/viec-lam/') && !x.url.includes('?')));
  assert.ok(r.every((x) => !/[A-Z]/.test(x.name)), 'slug đã bỏ mã tin');
});
test('parseSalaryText / parseExperienceMonths', () => {
  assert.deepEqual(parseSalaryText('12 - 15 triệu'), { min: 12e6, max: 15e6, currency: 'VND', unit: 'MONTH' });
  assert.deepEqual(parseSalaryText('Trên 20 triệu'), { min: 20e6, max: null, currency: 'VND', unit: 'MONTH' });
  assert.equal(parseSalaryText('Thỏa thuận'), null);
  assert.equal(parseSalaryText('Đang cập nhật'), null);
  assert.equal(parseExperienceMonths('2 năm'), 24);
  assert.equal(parseExperienceMonths('Không yêu cầu'), 0);
  assert.equal(parseExperienceMonths('Cập nhật'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJobPosting, parseSearchHtml } from '../tools/sources/careerlink.mjs';
import { jobRelevance } from '../web/lib/logic.js';

// Mẫu rút từ phản hồi thật của CareerLink (đọc ngày 10/10/2026), rút gọn phần mô tả.
const LD = {
  '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Nhân Viên Giám Sát An Toàn Lao Động',
  description: '<p>- Đảm bảo hoạt động thi công tuân thủ An toàn lao động, Vệ sinh lao động và Bảo vệ môi trường (HSE);</p><p>- Tối thiểu 1 – 2 năm kinh nghiệm giám sát an toàn.</p><p>- Có chứng chỉ nghiệp vụ an toàn lao động.</p><p>- Tốt nghiệp Cao đẳng trở lên</p>',
  identifier: { '@type': 'PropertyValue', name: 'CareerLink', value: 3631789 }, datePosted: '2026-09-24',
  hiringOrganization: { '@type': 'Organization', name: 'CÔNG TY TNHH THIẾT KẾ VÀ XÂY DỰNG P.H.A' },
  validThrough: '2026-10-24T23:59:59+00:00',
  baseSalary: { '@type': 'MonetaryAmount', currency: 'VND', value: { '@type': 'QuantitativeValue', minValue: 13000000, unitText: 'MONTH', maxValue: 15000000 } },
  experienceRequirements: { '@type': 'OccupationalExperienceRequirements', monthsOfExperience: '12' },
  employmentType: 'FULL_TIME', industry: 'Xây dựng, Môi trường / Xử lý chất thải, An Toàn Lao Động',
  jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Hồ Chí Minh', addressRegion: 'Hồ Chí Minh' } }, { '@type': 'Place', address: { addressLocality: 'Đồng Nai', addressRegion: 'Đồng Nai' } }],
};
const html = `<html><script type='application/ld+json'>{"@type":"BreadcrumbList"}</script>\n<script type='application/ld+json'>\n${JSON.stringify(LD)}\n</script></html>`;

test('parseJobPosting đọc đúng JSON-LD', () => {
  const j = parseJobPosting(html, 'https://www.careerlink.vn/tim-viec-lam/x/3631789');
  assert.equal(j.id, 'careerlink:3631789');
  assert.equal(j.title, 'Nhân Viên Giám Sát An Toàn Lao Động');
  assert.deepEqual(j.locations, ['Hồ Chí Minh', 'Đồng Nai']);
  assert.deepEqual(j.salary, { min: 13000000, max: 15000000, currency: 'VND', unit: 'MONTH' });
  assert.equal(j.expMonths, 12);
  assert.equal(j.validThrough, '2026-10-24T23:59:59+00:00');
  assert.ok(j.relevance >= 45);
  assert.ok(j.tags.includes('An toàn lao động'));
  assert.ok(j.requirements.degree.some((l) => /Cao đẳng/.test(l)));
  assert.ok(j.requirements.certs.some((l) => /chứng chỉ/.test(l)));
  assert.ok(!/<p>/.test(j.description));
});
test('parseJobPosting: không có JobPosting → null; không có lương → salary null', () => {
  assert.equal(parseJobPosting('<html></html>', 'u'), null);
  const ld = { ...LD }; delete ld.baseSalary; delete ld.experienceRequirements;
  const j = parseJobPosting(`<script type='application/ld+json'>${JSON.stringify(ld)}</script>`, 'https://x/1');
  assert.equal(j.salary, null); assert.equal(j.expMonths, null);
});
test('parseSearchHtml lấy tên + URL', () => {
  const s = '{"itemListElement":[{"@type":"ListItem","position":1,"item":{"@type":"WebPage","name":"GIÁM SÁT KHO/ WAREHOUSE SUPERVISOR","url":"https://www.careerlink.vn/tim-viec-lam/giam-sat-kho-warehouse-supervisor/3646546"}},{"@type":"ListItem","position":2,"item":{"@type":"WebPage","name":" Nhân Viên Tổng Vụ - HSE","url":"https://www.careerlink.vn/tim-viec-lam/nhan-vien-tong-vu-hse/3639269"}}]}';
  const r = parseSearchHtml(s);
  assert.equal(r.length, 2);
  assert.equal(r[1].name, 'Nhân Viên Tổng Vụ - HSE');
  assert.equal(jobRelevance({ title: r[0].name }), 0, 'tiêu đề kho bị loại trước khi tải chi tiết');
  assert.ok(jobRelevance({ title: r[1].name }) >= 45);
});

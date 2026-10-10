// Đối chiếu CV với tin tuyển dụng – quy tắc minh bạch, chạy cục bộ, không gọi dịch vụ AI ngoài, không tốn phí.
// Chỉ khẳng định "đáp ứng" khi cụm từ tương ứng THỰC SỰ xuất hiện trong CV người dùng nhập.
import { norm, formatSalary } from './logic.js';

// [id, nhãn, regex trên văn bản đã bỏ dấu + hạ chữ thường, trọng số]
export const CONCEPTS = [
  ['iso14001', 'ISO 14001', /iso ?14001/, 3],
  ['iso45001', 'ISO 45001', /iso ?45001|ohsas ?18001/, 3],
  ['iso9001', 'ISO 9001', /iso ?9001/, 1],
  ['atvsld', 'An toàn vệ sinh lao động', /an toan (ve sinh )?lao dong|atvsld|bao ho lao dong|osh\b|occupational (health|safety)/, 3],
  ['chungchi_atld', 'Chứng chỉ/huấn luyện ATVSLĐ', /chung chi.{0,30}(an toan|atvsld|bao ho)|huan luyen.{0,20}(an toan|atvsld)|giay chung nhan huan luyen/, 2],
  ['pccc', 'PCCC', /pccc|phong chay|chua chay/, 2],
  ['risk', 'Đánh giá rủi ro (JSA/HIRA)', /danh gia rui ro|\bjsa\b|\bhira\b|\bhirarc\b|risk assessment/, 2],
  ['incident', 'Điều tra sự cố/tai nạn', /dieu tra.{0,15}(su co|tai nan)|incident investigation|\bicam\b/, 2],
  ['waste', 'Quản lý chất thải', /chat thai|waste management|cttnh|chat thai nguy hai/, 3],
  ['wastewater', 'Xử lý nước thải', /nuoc thai|wwtp|xu ly nuoc|wastewater/, 3],
  ['air', 'Khí thải/không khí', /khi thai|bui|khong khi|emission/, 2],
  ['monitor', 'Quan trắc môi trường', /quan trac|lay mau|sampling/, 2],
  ['legal_env', 'Hồ sơ pháp lý môi trường (ĐTM/GPMT)', /\bdtm\b|danh gia tac dong moi truong|giay phep moi truong|\bgpmt\b|\bkhdt\b/, 3],
  ['esg', 'ESG / Phát triển bền vững', /\besg\b|ben vung|sustainab|carbon|gri\b/, 3],
  ['hse', 'HSE/EHS', /\b(hse|ehs|hsse|she)\b/, 3],
  ['chemical', 'Hóa chất (SDS/GHS)', /hoa chat|\bsds\b|\bmsds\b|\bghs\b/, 2],
  ['construction', 'An toàn công trường xây dựng', /cong truong|thi cong|xay dung|construction/, 1],
  ['english', 'Tiếng Anh', /tieng anh|english|toeic|ielts/, 1],
  ['office', 'Tin học văn phòng', /excel|word|powerpoint|ms office|tin hoc van phong/, 1],
  ['audit', 'Đánh giá nội bộ/audit', /audit|danh gia noi bo|danh gia vien|auditor/, 2],
  ['training', 'Huấn luyện/đào tạo', /huan luyen|dao tao|training/, 1],
];

function detect(textNorm) {
  const set = new Set();
  for (const [id, , rx] of CONCEPTS) if (rx.test(textNorm)) set.add(id);
  return set;
}

export function buildProfileText(p = {}) {
  return [p.title, p.summary, p.skills, p.certs, p.education, p.cvText].filter(Boolean).join('\n');
}

/**
 * @returns {{score:number, met:string[], missing:string[], extra:string[], reasons:string[], hasProfile:boolean}}
 */
export function matchJob(job, profile = {}) {
  const profText = buildProfileText(profile);
  if (!profText.trim()) return { score: null, met: [], missing: [], extra: [], reasons: ['Chưa có thông tin hồ sơ/CV.'], hasProfile: false };
  const jobText = norm(`${job.title}\n${job.description || ''}\n${job.industry || ''}`);
  const need = detect(jobText);
  const have = detect(norm(profText));
  const label = Object.fromEntries(CONCEPTS.map(([id, l]) => [id, l]));
  const weight = Object.fromEntries(CONCEPTS.map(([id, , , w]) => [id, w]));
  const met = [...need].filter((c) => have.has(c));
  const missing = [...need].filter((c) => !have.has(c));
  const extra = [...have].filter((c) => !need.has(c));
  const reasons = [];

  const totalW = [...need].reduce((s, c) => s + weight[c], 0);
  const metW = met.reduce((s, c) => s + weight[c], 0);
  const skillScore = totalW ? metW / totalW : 0.5;
  reasons.push(totalW
    ? `Kỹ năng/chứng chỉ: đáp ứng ${met.length}/${need.size} yêu cầu nhận diện được trong tin.`
    : 'Tin không nêu rõ yêu cầu kỹ năng nhận diện được → điểm kỹ năng để trung tính.');

  let expScore = 0.6;
  const years = profile.years === '' || profile.years == null ? null : Number(profile.years);
  if (job.expMonths != null && years != null && !Number.isNaN(years)) {
    const need12 = job.expMonths / 12;
    expScore = need12 <= 0 ? 1 : Math.min(1, years / need12);
    reasons.push(`Kinh nghiệm: tin yêu cầu ~${+need12.toFixed(1)} năm, hồ sơ ghi ${years} năm.`);
  } else if (job.expMonths == null) {
    reasons.push('Tin không công bố số năm kinh nghiệm.');
  } else {
    reasons.push('Hồ sơ chưa ghi số năm kinh nghiệm.');
  }

  let locScore = 0.6;
  const prefs = norm(profile.locations || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  if (prefs.length && (job.locations || []).length) {
    const ok = job.locations.some((l) => prefs.some((p) => norm(l).includes(p) || p.includes(norm(l))));
    locScore = ok ? 1 : 0;
    reasons.push(ok ? `Địa điểm khớp mong muốn (${job.locations.join(', ')}).` : `Địa điểm (${job.locations.join(', ')}) không nằm trong nơi bạn muốn làm.`);
  }

  let salScore = 0.6;
  const minSal = Number(profile.minSalary) || 0;
  if (minSal && job.salary) {
    const top = job.salary.max ?? job.salary.min ?? 0;
    salScore = top >= minSal ? 1 : 0.2;
    reasons.push(top >= minSal ? `Lương công bố (${formatSalary(job.salary)}) đạt mức tối thiểu bạn đặt.` : `Lương công bố (${formatSalary(job.salary)}) thấp hơn mức tối thiểu bạn đặt.`);
  } else if (minSal) {
    reasons.push('Tin không công bố lương nên chưa so sánh được.');
  }

  const score = Math.min(95, Math.round(100 * (0.55 * skillScore + 0.25 * expScore + 0.12 * locScore + 0.08 * salScore)));
  return {
    score,
    met: met.map((c) => label[c]),
    missing: missing.map((c) => label[c]),
    extra: extra.map((c) => label[c]),
    reasons,
    hasProfile: true,
  };
}

/** Gợi ý chỉnh CV: chỉ nhắc nhấn mạnh điều CÓ THẬT trong hồ sơ; điểm thiếu được nêu để bạn tự bổ sung nếu đúng sự thật. */
export function cvSuggestions(job, m) {
  const out = [];
  if (!m.hasProfile) return ['Hãy nhập thông tin hồ sơ/CV ở tab Hồ sơ để nhận gợi ý.'];
  if (m.met.length) out.push(`Đưa lên đầu CV các nội dung đã có và khớp tin: ${m.met.join(', ')}. Nêu dự án/số liệu cụ thể (nếu có) thay vì chỉ liệt kê.`);
  if (m.missing.length) out.push(`Tin nhắc tới nhưng CV chưa thể hiện: ${m.missing.join(', ')}. Chỉ bổ sung nếu bạn thực sự có kinh nghiệm/chứng chỉ đó; nếu chưa có, đừng ghi và cân nhắc nêu kế hoạch học/thi chứng chỉ trong thư xin việc.`);
  out.push(`Đặt chức danh mục tiêu gần với tiêu đề tin: "${job.title}".`);
  if (job.expMonths != null) out.push(`Tin yêu cầu khoảng ${+(job.expMonths / 12).toFixed(1)} năm kinh nghiệm – nêu rõ số năm và vị trí tương ứng.`);
  return out;
}

export function coverLetter(job, profile = {}, m) {
  const name = profile.name || '[Họ và tên]';
  const strengths = (m?.met || []);
  const lines = [];
  lines.push(`Kính gửi Quý công ty ${job.company || '[Tên công ty]'},`);
  lines.push('');
  lines.push(`Tôi là ${name}, xin gửi thư này để ứng tuyển vị trí "${job.title}"${job.sourceUrl ? ` (nguồn: ${job.sourceUrl})` : ''}.`);
  if (profile.years !== '' && profile.years != null && profile.title) lines.push(`Tôi có ${profile.years} năm kinh nghiệm với vai trò ${profile.title}.`);
  else if (profile.title) lines.push(`Hiện tôi làm việc/định hướng ở vị trí ${profile.title}.`);
  if (profile.summary) lines.push(profile.summary.trim());
  if (strengths.length) lines.push(`Đối chiếu với yêu cầu của vị trí, hồ sơ của tôi có nội dung liên quan đến: ${strengths.join(', ')}.`);
  if (m?.missing?.length) lines.push(`[Lưu ý cho bạn trước khi gửi: tin còn nhắc tới ${m.missing.join(', ')} mà hồ sơ chưa thể hiện – chỉ thêm câu nói về các mục này nếu đúng sự thật.]`);
  lines.push('');
  lines.push('Tôi mong có cơ hội trao đổi trực tiếp để làm rõ hơn về năng lực và sự phù hợp với vị trí. Xin chân thành cảm ơn Quý công ty đã xem xét hồ sơ.');
  lines.push('');
  lines.push('Trân trọng,');
  lines.push(name);
  if (profile.phone || profile.email) lines.push([profile.phone, profile.email].filter(Boolean).join(' | '));
  return lines.join('\n');
}

export function emailDraft(job, profile = {}, m) {
  const name = profile.name || '[Họ và tên]';
  return {
    subject: `Ứng tuyển vị trí ${job.title} - ${name}`,
    body: `Kính gửi Bộ phận Tuyển dụng ${job.company || ''},\n\nTôi là ${name}, xin ứng tuyển vị trí "${job.title}". Hồ sơ/CV của tôi được đính kèm email này.\n${m?.met?.length ? `\nĐiểm phù hợp chính: ${m.met.join(', ')}.\n` : ''}\nRất mong nhận được phản hồi từ Quý công ty.\n\nTrân trọng,\n${name}${profile.phone ? `\n${profile.phone}` : ''}${profile.email ? `\n${profile.email}` : ''}`,
  };
}

/** Prompt để dán vào trợ lý AI bất kỳ (tùy chọn, do bạn tự quyết định có gửi dữ liệu hay không). */
export function aiPrompt(job, profile = {}) {
  return `Bạn là cố vấn nghề nghiệp. Hãy đối chiếu CV với tin tuyển dụng dưới đây, nêu rõ yêu cầu đã đáp ứng/còn thiếu, đề xuất chỉnh CV. TUYỆT ĐỐI không bịa kinh nghiệm, bằng cấp, chứng chỉ không có trong CV.\n\n=== TIN TUYỂN DỤNG ===\n${job.title} - ${job.company}\nĐịa điểm: ${(job.locations || []).join(', ')}\n${job.description || ''}\n\n=== CV ===\n${buildProfileText(profile)}`;
}

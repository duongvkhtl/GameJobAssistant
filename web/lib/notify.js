// Tính danh sách thông báo từ dữ liệu mới + trạng thái người dùng (thuần logic, dễ kiểm thử).
import { daysUntil } from './logic.js';
import { matchJob } from './match.js';

export const MIN_JOB_RELEVANCE = 60;

/**
 * @param seen {games:string[], jobs:string[]} danh sách id đã thấy ở lần mở trước (null = lần đầu → không báo hàng loạt)
 * @returns {{id:string,type:string,title:string,body:string,url?:string}[]}
 */
export function computeNotifications({ games = [], jobs = [] }, state, seen, profile = {}, now = Date.now(), prefs = {}) {
  const out = [];
  const seenG = new Set(seen?.games || []);
  const seenJ = new Set(seen?.jobs || []);
  const first = !seen;

  if (!first && prefs.newGames !== false) {
    const fresh = games.filter((g) => g.kind === 'store' && !seenG.has(g.id));
    if (fresh.length) {
      out.push({ id: `newgames:${fresh[0].id}:${fresh.length}`, type: 'game', title: `${fresh.length} game mới`, body: fresh.slice(0, 3).map((g) => g.name).join(', ') });
    }
  }

  // Game yêu thích sắp phát hành (ngày thật từ App Store) trong 3 ngày tới hoặc vừa phát hành
  for (const g of games) {
    const st = state.games?.[g.id];
    if (!st?.fav || !g.releaseDate) continue;
    const d = daysUntil(g.releaseDate, now);
    if (d != null && d >= 0 && d <= 3) {
      out.push({ id: `favgame:${g.id}:${g.releaseDate}`, type: 'game', title: 'Game yêu thích sắp phát hành', body: `${g.name} – ${d === 0 ? 'hôm nay' : `còn ${d} ngày`} (${g.releaseDate})`, url: g.storeUrl });
    }
  }

  if (!first && prefs.newJobs !== false) {
    const hasProfile = !!(profile && (profile.cvText || profile.skills || profile.summary));
    const fresh = jobs.filter((j) => {
      if (seenJ.has(j.id) || j.relevance < MIN_JOB_RELEVANCE) return false;
      if (!hasProfile) return true;
      const m = matchJob(j, profile);
      return m.score == null || m.score >= (prefs.minMatch ?? 50);
    });
    if (fresh.length) {
      out.push({ id: `newjobs:${fresh[0].id}:${fresh.length}`, type: 'job', title: `${fresh.length} việc làm mới phù hợp`, body: fresh.slice(0, 3).map((j) => `${j.title} – ${j.company}`).join('\n') });
    }
  }

  // Hạn nộp CV của tin đã lưu/đánh dấu cần ứng tuyển
  for (const [id, st] of Object.entries(state.jobs || {})) {
    if (st.status === 'applied' || st.status === 'interview' || st.status === 'closed') continue;
    if (!st.fav && st.status !== 'to_apply') continue;
    const j = jobs.find((x) => x.id === id) || st.snapshot;
    const dl = st.deadline || j?.validThrough;
    const d = daysUntil(dl, now);
    if (d != null && d >= 0 && d <= 3) {
      out.push({ id: `deadline:${id}:${String(dl).slice(0, 10)}`, type: 'deadline', title: 'Sắp hết hạn nộp hồ sơ', body: `${j?.title || id} – ${d === 0 ? 'hết hạn hôm nay' : `còn ${d} ngày`}`, url: j?.sourceUrl });
    }
  }
  return out;
}

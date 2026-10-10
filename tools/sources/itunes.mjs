// Nguồn game: Apple iTunes Search/Lookup API + RSS "ứng dụng mới" (API công khai, chính thức của Apple).
// Chỉ lấy game có releaseDate thật trong cửa sổ RECENT_DAYS. Không có điểm số tự tạo: chỉ dùng averageUserRating của Apple.
import { getJson } from '../http.mjs';

export const SOURCE_ID = 'apple';
const COUNTRY = 'vn';
const RECENT_DAYS = 120;
const SEARCH_TERMS = ['rpg', 'idle', 'strategy', 'puzzle', 'gacha', 'action', 'simulation', 'adventure', 'racing', 'card game', 'shooter', 'tower defense', 'casual', 'sports'];

function toGame(r) {
  const langs = r.languageCodesISO2A || [];
  return {
    id: `apple:${r.trackId}`,
    kind: 'store',
    name: r.trackName,
    icon: r.artworkUrl512 || r.artworkUrl100,
    genre: (r.genres || []).find((g) => !['Games', 'Entertainment'].includes(g)) || r.primaryGenreName,
    genres: r.genres || [],
    platforms: ['iOS'],
    releaseDate: r.releaseDate?.slice(0, 10) || null,
    releaseDateKind: 'release', // ngày phát hành thật trên App Store (khác với ngày công bố)
    // releaseDate ở tương lai = game đặt trước (pre-order) trên App Store
    status: Date.parse(r.releaseDate) > Date.now() ? 'upcoming' : 'released',
    regions: [`App Store ${COUNTRY.toUpperCase()}`],
    languages: langs,
    supportsVietnamese: langs.includes('VI'),
    description: (r.description || '').slice(0, 600),
    developer: r.sellerName || r.artistName,
    rating: r.averageUserRating ? { value: Math.round(r.averageUserRating * 10) / 10, count: r.userRatingCount || 0, by: 'App Store' } : null,
    price: r.formattedPrice || null,
    requirements: r.minimumOsVersion ? `iOS ${r.minimumOsVersion}+` : null,
    storeUrl: r.trackViewUrl?.split('?')[0],
    source: 'Apple App Store (iTunes API)',
    sourceUrl: r.trackViewUrl?.split('?')[0],
    updatedAt: r.currentVersionReleaseDate || r.releaseDate,
  };
}

async function lookup(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100).join(',');
    const j = await getJson(`https://itunes.apple.com/lookup?id=${chunk}&country=${COUNTRY}&entity=software`, { delay: 400 });
    out.push(...j.results);
  }
  return out;
}

export async function fetchAppleGames(log = console.log) {
  const errors = [];
  const byId = new Map();
  const cutoff = Date.now() - RECENT_DAYS * 86400000;

  // 1) Danh sách "mới" theo RSS của Apple (game = genre 6014)
  const ids = new Set();
  for (const feed of ['newfreeapplications', 'newpaidapplications']) {
    try {
      const j = await getJson(`https://itunes.apple.com/${COUNTRY}/rss/${feed}/limit=100/genre=6014/json`, { delay: 400 });
      for (const e of j.feed?.entry || []) ids.add(e.id?.attributes?.['im:id']);
    } catch (e) { errors.push(`rss ${feed}: ${e.message}`); }
  }
  try {
    for (const r of await lookup([...ids].filter(Boolean))) byId.set(r.trackId, r);
  } catch (e) { errors.push(`lookup: ${e.message}`); }

  // 2) Tìm kiếm theo thể loại để bổ sung
  for (const term of SEARCH_TERMS) {
    try {
      const j = await getJson(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${COUNTRY}&limit=200&genreId=6014`, { delay: 500 });
      for (const r of j.results) if (r.releaseDate && Date.parse(r.releaseDate) >= cutoff) byId.set(r.trackId, r);
      // (game đặt trước có releaseDate ở tương lai cũng nằm trong điều kiện trên)
    } catch (e) { errors.push(`search ${term}: ${e.message}`); }
  }

  const games = [...byId.values()]
    .filter((r) => r.kind === 'software' && (r.genres || []).includes('Games') && r.releaseDate && Date.parse(r.releaseDate) >= cutoff)
    .map(toGame);
  log(`[apple] ${games.length} game phát hành trong ${RECENT_DAYS} ngày, ${errors.length} lỗi`);
  return { games, errors };
}

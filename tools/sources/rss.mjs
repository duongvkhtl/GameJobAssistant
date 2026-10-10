// Nguồn tin game (ưu tiên Android): RSS công khai của Droid Gamers, Pocket Gamer, TouchArcade, Android Central, Android Authority.
// Lưu ý: đây là TIN BÁO CHÍ. Ngày hiển thị là ngày đăng tin, không phải ngày phát hành; khu vực/khả năng tải tại Việt Nam KHÔNG được xác minh.
import { getText } from '../http.mjs';
import { classifyNewsStatus, GAME_NEWS_FILTER, htmlToText } from '../../web/lib/logic.js';

// gameOnly: feed chuyên game; ngược lại bài phải có từ "game" mới giữ.
const FEEDS = [
  { id: 'droidgamers', name: 'Droid Gamers', url: 'https://www.droidgamers.com/feed/', gameOnly: true, defaultPlatform: 'Android' },
  { id: 'pocketgamer', name: 'Pocket Gamer', url: 'https://www.pocketgamer.com/rss/', gameOnly: true },
  { id: 'toucharcade', name: 'TouchArcade', url: 'https://toucharcade.com/feed/', gameOnly: true },
  { id: 'androidcentral', name: 'Android Central', url: 'https://www.androidcentral.com/feed', gameOnly: false },
  { id: 'androidauthority', name: 'Android Authority', url: 'https://www.androidauthority.com/feed/', gameOnly: false },
];

const unCdata = (s = '') => s.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1').trim();
const tag = (block, t) => {
  const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'));
  return m ? unCdata(m[1]) : '';
};

export function parseRss(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
    const b = m[1];
    const img = b.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) || b.match(/<enclosure[^>]*url="([^"]+)"/i) || tag(b, 'description').match(/<img[^>]*src="([^"]+)"/i);
    return {
      title: htmlToText(tag(b, 'title')),
      link: tag(b, 'link'),
      pubDate: tag(b, 'pubDate'),
      summary: htmlToText(tag(b, 'description')).slice(0, 400),
      image: img ? img[1] : null,
    };
  });
}

/** Nền tảng suy ra từ chữ trong tiêu đề/tóm tắt. Không nhắc tới → để trống (không đoán). */
export function detectPlatforms(text, defaultPlatform) {
  const t = text.toLowerCase();
  const p = [];
  if (/android|google play/.test(t)) p.push('Android');
  if (/\bios\b|iphone|ipad|app store/.test(t)) p.push('iOS');
  if (!p.length && defaultPlatform) p.push(defaultPlatform);
  return p;
}

/** Khu vực nêu trong tin (vd "soft launches in the Philippines") – chỉ trích nguyên văn khi có mẫu rõ ràng. */
export function detectRegion(text) {
  const m = text.match(/(?:soft[- ]?launch(?:es|ed)?|launch(?:es|ed)?|rolls? out|available|beta)\s+(?:in|for|across)\s+((?:the\s+)?[A-Z][A-Za-z]+(?:\s+(?:and\s+)?[A-Z][A-Za-z]+){0,3})/);
  return m ? m[1].trim() : null;
}

export async function fetchGameNews(log = console.log) {
  const errors = [];
  const news = [];
  for (const f of FEEDS) {
    try {
      const xml = await getText(f.url, { delay: 400 });
      const items = parseRss(xml);
      let kept = 0;
      for (const it of items) {
        if (!it.link || !it.title) continue;
        const text = `${it.title} ${it.summary}`;
        if (!f.gameOnly && !/\bgames?\b|gaming|\brpg\b|gacha/i.test(text)) continue;
        if (!GAME_NEWS_FILTER.test(text)) continue;
        if (/\b(review|best|top \d+|deal|sale|discount|how to|guide|vs\.?)\b/i.test(it.title) && !/pre-?regist|soft[- ]?launch|release date/i.test(text)) continue;
        const status = classifyNewsStatus(text);
        if (!status) continue;
        const d = Date.parse(it.pubDate);
        const platforms = detectPlatforms(text, f.defaultPlatform);
        news.push({
          id: `${f.id}:${it.link}`,
          kind: 'news',
          name: it.title,
          icon: it.image,
          status,
          platforms,
          platformNote: platforms.length ? 'Nền tảng suy ra từ nội dung tin' : 'Tin không nêu rõ nền tảng',
          regions: detectRegion(it.title + ' ' + it.summary) ? [`Nêu trong tin: ${detectRegion(it.title + ' ' + it.summary)}`] : [],
          announcedAt: Number.isNaN(d) ? null : new Date(d).toISOString().slice(0, 10),
          releaseDate: null, // không tự suy đoán ngày phát hành
          description: it.summary,
          source: f.name,
          sourceUrl: it.link,
          updatedAt: Number.isNaN(d) ? null : new Date(d).toISOString(),
        });
        kept++;
      }
      log(`[rss:${f.id}] ${items.length} bài, giữ ${kept}`);
    } catch (e) { errors.push(`${f.id}: ${e.message}`); }
  }
  return { news, errors };
}


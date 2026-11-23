import { decodeEntities, toPlainText } from './text.mjs';

const unwrap = (v = '') =>
  v.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();

function tagValue(block, tag) {
  const re = new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)<\/${tag}>`, 'i');
  const m = block.match(re);
  return m ? unwrap(m[1]) : '';
}

function tagAttr(block, tag, attr) {
  const re = new RegExp(String.raw`<${tag}\b[^>]*\b${attr}\s*=\s*"([^"]*)"`, 'i');
  const m = block.match(re);
  return m ? decodeEntities(m[1]) : '';
}

/**
 * Minimal RSS 2.0 / Atom reader. Deliberately regex based: all our feeds are
 * plain RSS and this keeps the project dependency free.
 */
export function parseFeed(xml) {
  const channelTitle = tagValue(xml.split(/<item[\s>]/i)[0] || '', 'title');

  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const items = blocks.map((b) => {
    const link =
      tagValue(b, 'link') || tagAttr(b, 'link', 'href') || tagValue(b, 'guid');
    const rawDate =
      tagValue(b, 'pubDate') ||
      tagValue(b, 'dc:date') ||
      tagValue(b, 'updated') ||
      tagValue(b, 'published');
    const descr = tagValue(b, 'description') || tagValue(b, 'summary') || '';
    const content =
      tagValue(b, 'content:encoded') || tagValue(b, 'content') || '';
    const image =
      tagAttr(b, 'enclosure', 'url') ||
      tagAttr(b, 'media:content', 'url') ||
      tagAttr(b, 'media:thumbnail', 'url') ||
      firstImgSrc(content) ||
      firstImgSrc(descr);

    return {
      title: toPlainText(tagValue(b, 'title')),
      link: link.trim(),
      publishedAt: toIso(rawDate),
      summary: toPlainText(descr || content),
      image: image || '',
      categories: [
        ...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi),
      ]
        .map((m) => toPlainText(unwrap(m[1])))
        .filter(Boolean),
    };
  });

  return { feedTitle: toPlainText(channelTitle), items };
}

function firstImgSrc(html = '') {
  const m = String(html).match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]) : '';
}

function toIso(raw = '') {
  if (!raw) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

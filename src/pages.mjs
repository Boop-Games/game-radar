import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const MAX_REPORT_BYTES = 512 * 1024;

// Optional `---` front matter at the top of a report. Only flat `key: value` lines are read.
function splitFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: text.slice(m[0].length) };
}

const firstHeading = (body) => body.match(/^#\s+(.+)$/m)?.[1].trim();

// First plain-text paragraph, skipping headings, tables, lists, quotes and code.
function firstParagraph(body) {
  for (const block of body.split(/\r?\n\s*\r?\n/)) {
    const t = block.trim();
    if (t && !/^(#|\||[-*>]\s|```|\d+\.\s|---)/.test(t)) return t.replace(/\s+/g, ' ').replace(/\*\*|`/g, '').slice(0, 240);
  }
  return '';
}

// The title is shown as the page heading, so drop a leading H1 that repeats it.
function stripLeadingTitle(body, title) {
  const m = body.match(/^#\s+(.+)\r?\n?/);
  return m && m[1].trim() === title ? body.slice(m[0].length).trimStart() : body;
}

const slugify = (s) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'report';

// Turns any markdown document into a Pages-tab entry. The only requirement is a non-empty body.
// Title and summary are taken from the overrides, then front matter, then the first H1 and first paragraph.
export function buildPage(markdown, overrides = {}, now = new Date()) {
  const text = String(markdown ?? '').replace(/^﻿/, '');
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new Error(`Report is larger than ${MAX_REPORT_BYTES / 1024} KB`);
  const { meta, body } = splitFrontMatter(text);
  if (!body.trim()) throw new Error('Report is empty');

  const title = (overrides.title || meta.title || firstHeading(body.trim()) || 'Untitled report').slice(0, 200);
  const markdownBody = stripLeadingTitle(body.trim(), title);
  return {
    slug: `${slugify(title)}-${now.getTime()}`,
    title,
    kind: overrides.kind || meta.kind || 'report',
    createdAt: now.toISOString(),
    summary: (overrides.summary || meta.summary || firstParagraph(body.trim())).slice(0, 300),
    markdown: markdownBody,
    source: overrides.source || meta.source || null,
    items: [],
  };
}

// `pagesFolder` is the `pages` directory inside the data folder.
export async function savePage(pagesFolder, page) {
  await mkdir(pagesFolder, { recursive: true });
  await writeFile(path.join(pagesFolder, `${page.slug}.json`), JSON.stringify(page, null, 2));
  return page;
}

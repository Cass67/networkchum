export type HtmlLink = {
  href: string;
  text: string;
};

const HREF_PATTERN =
  /<a\s+[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const SKIPPED_SCHEMES = /^(?:[?#]|javascript:|mailto:|tel:|data:)/i;

/**
 * Extracts anchor hrefs from an HTML directory listing (nginx/Apache
 * autoindex and similar). Returns null when the document contains no anchors
 * at all, which usually means the page is rendered client-side.
 */
export function parseHtmlDirectoryListing(html: string): HtmlLink[] | null {
  const links: HtmlLink[] = [];
  for (const match of html.matchAll(HREF_PATTERN)) {
    const href = match[1] ?? match[2] ?? match[3];
    if (!href) {
      continue;
    }
    if (SKIPPED_SCHEMES.test(href)) {
      continue;
    }
    if (href === "/" || href === "../" || href === "./") {
      continue;
    }
    links.push({ href, text: match[0] });
  }
  return links.length > 0 ? links : null;
}

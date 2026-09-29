import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Ctx } from "./ctx.js";
import { fail, ok } from "./helpers.js";

const PAGE_FETCH_CAP = 20;
const SEARCH_LIMIT = 5;
const EXCERPT_CHARS = 400;
const PAGE_MARKDOWN_CAP = 80_000;

export type DocPageBody = {
  slug: string;
  title: string;
  markdown: string;
};

export type RankedDocHit = {
  slug: string;
  title: string;
  score: number;
  excerpt: string;
};

type DocsManifest = {
  version?: string;
  current?: string;
  platform_version?: string;
  pages?: Array<{ slug?: string; title?: string }>;
};

type DocsPage = {
  version?: string;
  slug?: string;
  title?: string;
  markdown?: string;
};

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of query.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
  }
  return terms;
}

function countTerm(haystack: string, term: string): number {
  const h = haystack.toLowerCase();
  let n = 0;
  let i = 0;
  while (i < h.length) {
    const found = h.indexOf(term, i);
    if (found < 0) break;
    n += 1;
    i = found + term.length;
  }
  return n;
}

export function excerptAround(markdown: string, query: string, chars = EXCERPT_CHARS): string {
  const terms = queryTerms(query);
  const lower = markdown.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  const start = at < 0 ? 0 : Math.max(0, at - Math.floor(chars / 3));
  const slice = markdown.slice(start, start + chars).replace(/\s+/g, " ").trim();
  const prefix = start > 0 ? "…" : "";
  const suffix = start + chars < markdown.length ? "…" : "";
  return `${prefix}${slice}${suffix}`;
}

/** Title hits outweigh body hits. Pages with no hit are omitted. */
export function rankDocPages(pages: DocPageBody[], query: string, limit = SEARCH_LIMIT): RankedDocHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const ranked: RankedDocHit[] = [];
  for (const page of pages) {
    let score = 0;
    for (const term of terms) {
      score += countTerm(page.title, term) * 5;
      score += countTerm(page.markdown, term);
    }
    if (score <= 0) continue;
    ranked.push({
      slug: page.slug,
      title: page.title,
      score,
      excerpt: excerptAround(page.markdown, query),
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return ranked.slice(0, limit);
}

function docsQuery(version: string, page?: string): string {
  const params = new URLSearchParams();
  if (version) params.set("version", version);
  if (page) params.set("page", page);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

function clipMarkdown(markdown: string): { markdown: string; truncated: boolean } {
  if (markdown.length <= PAGE_MARKDOWN_CAP) return { markdown, truncated: false };
  return { markdown: `${markdown.slice(0, PAGE_MARKDOWN_CAP)}\n\n…`, truncated: true };
}

export function registerDocsTools(server: McpServer, ctx: Ctx): void {
  server.registerTool("yaaif_docs_search", {
    description:
      "Search product documentation for the current YAAIF version. Omit q to list pages. Omit version to use the docs shipped with this installation. Answer from these pages; do not invent product behavior.",
    inputSchema: {
      q: z.string().optional(),
      version: z.string().optional(),
    },
  }, async ({ q, version }) => {
    const requested = (version ?? "").trim();
    try {
      const manifest = await ctx.api.docsJSON<DocsManifest>(
        "GET",
        `/api/manifest${docsQuery(requested)}`,
      );
      const resolved = (manifest.version || manifest.current || requested).trim();
      const pages = (manifest.pages ?? [])
        .map((page) => ({ slug: (page.slug ?? "").trim(), title: (page.title ?? "").trim() }))
        .filter((page) => page.slug);
      const query = (q ?? "").trim();
      if (!query) {
        return ok(`Docs ${resolved}: ${pages.length} pages.`, {
          version: resolved,
          platform_version: manifest.platform_version ?? "",
          pages,
        });
      }
      const bodies = await Promise.all(
        pages.slice(0, PAGE_FETCH_CAP).map(async (page) => {
          const body = await ctx.api.docsJSON<DocsPage>(
            "GET",
            `/api/page${docsQuery(resolved, page.slug)}`,
          );
          return {
            slug: (body.slug || page.slug).trim(),
            title: (body.title || page.title).trim(),
            markdown: body.markdown ?? "",
          };
        }),
      );
      const matches = rankDocPages(bodies, query);
      return ok(
        matches.length
          ? `Docs ${resolved}: ${matches.length} match(es) for “${query}”.`
          : `Docs ${resolved}: no match for “${query}”.`,
        {
          version: resolved,
          platform_version: manifest.platform_version ?? "",
          query,
          matches,
        },
      );
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool("yaaif_docs_page", {
    description:
      "Read one product documentation page for the current YAAIF docs version, or a version you pass. Use a slug from yaaif_docs_search.",
    inputSchema: {
      page: z.string(),
      version: z.string().optional(),
    },
  }, async ({ page, version }) => {
    const slug = page.trim();
    if (!slug) return fail("page is required");
    const requested = (version ?? "").trim();
    try {
      const body = await ctx.api.docsJSON<DocsPage>(
        "GET",
        `/api/page${docsQuery(requested, slug)}`,
      );
      const markdown = body.markdown ?? "";
      const clipped = clipMarkdown(markdown);
      return ok(`Docs page ${body.slug || slug} (${body.version || requested || "current"}).`, {
        version: body.version || requested,
        slug: body.slug || slug,
        title: body.title ?? "",
        markdown: clipped.markdown,
        truncated: clipped.truncated,
      });
    } catch (e) {
      return fail(String(e));
    }
  });
}

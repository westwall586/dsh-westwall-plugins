import { parse as parseHtml } from 'node-html-parser';
import { z } from 'zod';
import type { RawItem } from '../../contract/types.ts';

export const githubTrendingExtraSchema = z.object({
  rank: z.number().int().positive(),
  stars: z.number().int().nonnegative(),
  starsToday: z.number().int().nonnegative(),
  forks: z.number().int().nonnegative(),
  language: z.string(),
});

export type GithubTrendingExtra = z.infer<typeof githubTrendingExtraSchema>;

const REPOSITORY_PATH = /^[^\s/]+\/[^\s/?#]+$/;
const STARS_TODAY = /([\d,]+)\s+stars?\s+today/;

function readCount(text: string | undefined, label: string, rank: number): number {
  const digits = (text ?? '').trim().replaceAll(',', '');
  if (!/^\d+$/.test(digits)) throw new Error(`trending row ${rank}: cannot read ${label} from ${JSON.stringify(text ?? '')}`);
  return Number(digits);
}

/**
 * Turns a GitHub Trending page into raw items. Pure: the caller owns the network and the fetch time.
 * A missing rank-required field throws, because a silent zero would look like a real trend.
 */
export function parse(html: string, fetchedAtIso: string): RawItem[] {
  const fetchedAt = new Date(fetchedAtIso);
  if (Number.isNaN(fetchedAt.getTime())) throw new Error(`invalid fetch timestamp: ${JSON.stringify(fetchedAtIso)}`);
  const publishedAt = fetchedAt.toISOString();

  return parseHtml(html)
    .querySelectorAll('article.Box-row')
    .map((article, index) => {
      const rank = index + 1;
      const href = article.querySelector('h2 a')?.getAttribute('href')?.trim() ?? '';
      const naturalKey = href.replace(/^\/+|\/+$/g, '');
      if (!REPOSITORY_PATH.test(naturalKey)) {
        throw new Error(`trending row ${rank}: unexpected repository link ${JSON.stringify(href)}`);
      }

      const metaText = article.querySelector('div.f6')?.textContent ?? article.text;
      const extra = githubTrendingExtraSchema.parse({
        rank,
        stars: readCount(article.querySelector('a[href$="/stargazers"]')?.textContent, 'stars', rank),
        starsToday: readCount(metaText.match(STARS_TODAY)?.[1], 'stars today', rank),
        forks: readCount(article.querySelector('a[href$="/forks"]')?.textContent, 'forks', rank),
        language: article.querySelector('[itemprop="programmingLanguage"]')?.textContent.trim() ?? '',
      });

      return {
        naturalKey,
        title: naturalKey,
        description: article.querySelector('p')?.textContent.trim() ?? '',
        url: `https://github.com/${naturalKey}`,
        publishedAt,
        extra,
      };
    });
}

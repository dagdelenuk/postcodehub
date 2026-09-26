import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Long-form editorial guides (school admissions, commute costs, comparing boroughs...) - unlike everything else on the
// site, these aren't derived from open data, they're hand-written explainers that point readers at the right
// PostcodeHub tool for their situation. Cross-linked onto relevant pages via src/lib/guides.ts's topic matching.
const guides = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/guides" }),
  schema: z.object({
    title: z.string(),
    /** Also used as the meta description and the card blurb on /guides/ and in Related Guides. */
    description: z.string(),
    /** e.g. ["schools", "admissions"], ["commute", "budget"] - matched against a page's topic in getGuidesForTopic(). */
    topics: z.array(z.string()),
    minutesToRead: z.number().int().positive(),
    lastReviewed: z.date(),
    /** Links into PostcodeHub's own tools relevant to this guide, e.g. { label: "Commute checker", href: "/commute/" }. */
    relatedTools: z
      .array(
        z.object({
          label: z.string(),
          href: z.string(),
        })
      )
      .default([]),
    /** Hides the guide from /guides/ and Related Guides without deleting the file - for drafts in progress. */
    draft: z.boolean().default(false),
  }),
});

export const collections = { guides };

import { getCollection, type CollectionEntry } from "astro:content";

export type Guide = CollectionEntry<"guides">;

async function loadPublishedGuides(): Promise<Guide[]> {
  const all = await getCollection("guides", ({ data }) => !data.draft);
  return all.sort((a, b) => b.data.lastReviewed.getTime() - a.data.lastReviewed.getTime());
}

/** Every published guide, newest-reviewed first - for the /guides/ index. */
export async function getAllGuides(): Promise<Guide[]> {
  return loadPublishedGuides();
}

/**
 * Guides tagged with the given topic (e.g. "schools", "commute"), newest-reviewed first, capped at `limit`. Simple
 * tag-overlap matching - the same "explainable, hand-tunable" spirit as src/lib/similar.ts's district matching, not
 * anything ML-based. Never throws - a topic with no guides yet just gets an empty array, same convention as
 * getBannerImages().
 */
export async function getGuidesForTopic(topic: string, limit = 3): Promise<Guide[]> {
  const guides = await loadPublishedGuides();
  return guides.filter((g) => g.data.topics.includes(topic)).slice(0, limit);
}

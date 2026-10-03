import { describe, expect, it } from "vitest";
import { contentRatingForNovel, matchesContentRating } from "../core/tagFilters";
import type { Novel } from "../core/types";

function novel(tags: string[], tagKeys: string[]): Novel {
  return {
    id: tagKeys.join("-") || "safe",
    title: "Sample",
    author: "",
    sourceId: "test",
    sourceName: "Test",
    tags,
    tagKeys,
    status: "ongoing",
    chapters: 1,
    language: "PT-BR",
    updatedAt: "",
    description: "",
    coverClass: "cover-c"
  };
}

describe("content rating filters", () => {
  it("classifies erotic, suggestive, mature and safe novels from normalized tags", () => {
    // "Adulto"/"Mature" is mature themes (Omniscient Reader has it), not sexual content.
    expect(contentRatingForNovel(novel(["Adulto"], ["genre.adult"]))).toBe("mature");
    expect(contentRatingForNovel(novel(["Mature"], ["genre.adult"]))).toBe("mature");
    // An explicit age mark and sexual tags stay erotic, even though "+18" shares the tag key.
    expect(contentRatingForNovel(novel(["+18"], ["genre.adult"]))).toBe("erotic");
    expect(contentRatingForNovel(novel(["Heavy Smut"], []))).toBe("erotic");
    expect(contentRatingForNovel(novel(["Ecchi"], ["genre.ecchi"]))).toBe("suggestive");
    expect(contentRatingForNovel(novel(["Fantasia"], ["genre.fantasy"]))).toBe("safe");
  });

  it("lets erotic tags win over suggestive tags", () => {
    const item = novel(["Ecchi", "Smut"], ["genre.ecchi"]);

    expect(contentRatingForNovel(item)).toBe("erotic");
    expect(matchesContentRating(item, "suggestive")).toBe(false);
    expect(matchesContentRating(item, "erotic")).toBe(true);
    // Suggestive wins over mature themes.
    expect(contentRatingForNovel(novel(["Adulto", "Harém"], ["genre.adult", "theme.harem"]))).toBe("suggestive");
  });
});

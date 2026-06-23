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
  it("classifies erotic, suggestive and safe novels from normalized tags", () => {
    expect(contentRatingForNovel(novel(["Adulto"], ["genre.adult"]))).toBe("erotic");
    expect(contentRatingForNovel(novel(["Ecchi"], ["genre.ecchi"]))).toBe("suggestive");
    expect(contentRatingForNovel(novel(["Fantasia"], ["genre.fantasy"]))).toBe("safe");
  });

  it("lets erotic tags win over suggestive tags", () => {
    const item = novel(["Ecchi", "Adulto"], ["genre.ecchi", "genre.adult"]);

    expect(contentRatingForNovel(item)).toBe("erotic");
    expect(matchesContentRating(item, "suggestive")).toBe(false);
    expect(matchesContentRating(item, "erotic")).toBe(true);
  });
});

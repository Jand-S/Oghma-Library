import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryItem, Novel } from "../core/types";
import {
  concealedCoverUrls,
  CoverPrivacyProvider,
  coverSettingsKey,
  resetCoverSettingsCache,
  updateCoverSettings,
  useCoverControls
} from "../app/coverPrivacy";
import { Cover } from "../ui";

function novel(partial: Partial<Novel> & Pick<Novel, "id" | "title">): Novel {
  return {
    author: "Autor", sourceId: "cn", sourceName: "Central Novel", tags: [], tagKeys: [], status: "ongoing",
    chapters: 10, language: "pt-BR", updatedAt: "", description: "", coverClass: "cover-a", ...partial
  };
}

const adult = novel({ id: "cn:adulto", title: "Adulto", tagKeys: ["genre.erotic"], coverUrl: "https://c/adulto.jpg", aliases: ["cn:adulto-velho"] });
const plain = novel({ id: "cn:livre", title: "Livre", tagKeys: ["genre.fantasy"], coverUrl: "https://c/livre.jpg" });
const downloaded = { id: "local-1", novelId: "cn:adulto-velho", title: "Adulto", coverUrl: "asset://local/adulto.jpg" } as LibraryItem;

beforeEach(() => {
  window.localStorage.removeItem(coverSettingsKey);
  resetCoverSettingsCache();
});
afterEach(() => resetCoverSettingsCache());

describe("which covers are covered", () => {
  it("covers +18 novels, also a downloaded book's local cover, and follows the reader's choices", () => {
    const settings = { hideAdult: true, overrides: {} };
    expect([...concealedCoverUrls([adult, plain], [downloaded], settings)]).toEqual(["https://c/adulto.jpg", "asset://local/adulto.jpg"]);
    expect(concealedCoverUrls([adult, plain], [downloaded], { ...settings, hideAdult: false }).size).toBe(0);
    const choices = { hideAdult: true, overrides: { "cn:adulto": "show" as const, "cn:livre": "hide" as const } };
    expect([...concealedCoverUrls([adult, plain], [downloaded], choices)]).toEqual(["https://c/livre.jpg"]);
  });
});

function Toggle({ id }: { id: string }) {
  const covers = useCoverControls();
  return <button type="button" onClick={() => covers.toggle(id)}>{covers.isHidden(id) ? "coberta" : "visível"}</button>;
}

describe("Cover with the eye", () => {
  it("blurs a +18 cover; the eye shows it without opening the card", () => {
    const open = vi.fn();
    render(
      <CoverPrivacyProvider catalog={[adult, plain]} library={[]}>
        <button type="button" onClick={open}><Cover src={adult.coverUrl} title={adult.title} /></button>
        <Cover src={plain.coverUrl} title={plain.title} />
      </CoverPrivacyProvider>
    );
    expect(screen.getAllByTestId("cover-reveal")).toHaveLength(1);
    expect(screen.getByAltText("Capa coberta de Adulto")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cover-reveal"));
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByTestId("cover-reveal")).toBeNull();
    expect(screen.getByAltText("Adulto")).toBeTruthy();
  });

  it("keeps a per-book choice and the Ajustes switch", () => {
    render(
      <CoverPrivacyProvider catalog={[adult, plain]} library={[]}>
        <Toggle id="cn:adulto" />
        <Cover src={adult.coverUrl} title={adult.title} />
      </CoverPrivacyProvider>
    );
    fireEvent.click(screen.getByText("coberta"));
    expect(screen.getByText("visível")).toBeTruthy();
    expect(screen.queryByTestId("cover-reveal")).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(coverSettingsKey)!).overrides).toEqual({ "cn:adulto": "show" });

    fireEvent.click(screen.getByText("visível"));
    expect(screen.getByTestId("cover-reveal")).toBeTruthy();
    act(() => updateCoverSettings((state) => ({ ...state, hideAdult: false })));
    expect(screen.queryByTestId("cover-reveal")).toBeNull();
  });
});

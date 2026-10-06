import { createContext, useContext } from "react";
import type { BookSnapshot, Novel } from "../../core/types";
import { socialStrings as t } from "../../strings/social";
import type { SocialController } from "./useSocial";

/**
 * What the right side of Amigos shows: a conversation (`chat`), a friend's profile (`friend`,
 * opened from the conversation header or the right-click menu) or the received recommendations.
 */
export type SocialPlace = { pane?: "recommendations"; friend?: string; chat?: string };

export type SharedBook = { novelId: string; snapshot: BookSnapshot };

/** What the social screens need from the rest of the app (catalog, library, navigation). */
export type SocialEnv = {
  social: SocialController;
  /** What is open now (after the fallback when nothing was asked). */
  place: SocialPlace;
  /** The catalog novel for an id (aliases followed); undefined when its source left. */
  resolve: (novelId: string) => Novel | undefined;
  /** Already in the reader's library (by the catalog's current id). */
  inLibrary: (novelId: string) => boolean;
  addToLibrary: (novel: Novel) => void;
  /** Opens the novel's panel in Buscar. */
  openBook: (novel: Novel) => void;
  /** `replace`: no new history step (the automatic first choice). */
  go: (place: Partial<SocialPlace>, options?: { replace?: boolean }) => void;
  /** "Indicar a um amigo…" for a book. */
  recommend: (book: SharedBook) => void;
  /** Catalog books of the reader's library, for "Livro da biblioteca" in a conversation. */
  libraryBooks: () => SharedBook[];
  /** Catalog search by title/author, for "Buscar no catálogo" in a conversation. */
  searchCatalog: (query: string) => SharedBook[];
};

export const SocialEnvContext = createContext<SocialEnv | null>(null);

export function useSocialEnv(): SocialEnv {
  const env = useContext(SocialEnvContext);
  if (!env) throw new Error("SocialEnvContext missing");
  return env;
}

/** A catalog novel as the snapshot a message carries (shows even if the source leaves). */
export function snapshotOfNovel(novel: Novel): BookSnapshot {
  return {
    novelId: novel.id,
    title: novel.title,
    author: novel.author || undefined,
    sourceId: novel.sourceId,
    sourceName: novel.sourceName,
    coverUrl: novel.coverUrl,
    chapters: novel.chapters,
    description: novel.description?.slice(0, 600)
  };
}

const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "14:32" today, "ontem", "3 de out." before that. */
export function shortWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) return timeFormat.format(date);
  if (date.getTime() >= startOfToday - 86_400_000) return "ontem";
  return dayFormat.format(date);
}

export function longDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** A server error code as a sentence for the reader. */
export function errorMessage(error: string): string {
  if (error === "not_found") return t.notFound;
  if (error === "already_friends") return t.alreadyFriends;
  if (error === "rate_limited") return t.rateLimited;
  if (error === "network") return t.networkError;
  return t.genericError;
}

/** A chapter count from a snapshot another app wrote (ignores anything that is not a number). */
export function chapterCount(value: unknown): number | undefined {
  return typeof value === "number" && value > 0 ? value : undefined;
}

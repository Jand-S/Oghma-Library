import { createContext, useContext } from "react";
import type { BookSnapshot, Novel } from "../../core/types";
import type { SocialController } from "./useSocial";

export type SocialTab = "chats" | "recommendations" | "friends";

/** Where the Amigos page is: a tab, a friend's profile, an open conversation. */
export type SocialPlace = { tab: SocialTab; friend?: string; chat?: string };

/** What the social screens need from the rest of the app (catalog, library, navigation). */
export type SocialEnv = {
  social: SocialController;
  /** The catalog novel for an id (aliases followed); undefined when its source left. */
  resolve: (novelId: string) => Novel | undefined;
  /** Already in the reader's library (by the catalog's current id). */
  inLibrary: (novelId: string) => boolean;
  addToLibrary: (novel: Novel) => void;
  /** Opens the novel's panel in Buscar. */
  openBook: (novel: Novel) => void;
  go: (place: Partial<SocialPlace>) => void;
  /** "Indicar a um amigo…" for a book. */
  recommend: (book: { novelId: string; snapshot: BookSnapshot }) => void;
  /** Catalog books of the reader's library, for "Anexar livro" in a conversation. */
  libraryBooks: () => Array<{ novelId: string; snapshot: BookSnapshot }>;
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

import type { Novel } from "../../core/types";
import { homeStrings } from "../../strings/home";
import { Cover, SectionHeader } from "../../ui";

export type GenreTile = { key: string; label: string; count: number; covers: Novel[] };

/** "Explorar por gênero": the most common story genres, each with a fan of three covers. */
export function HomeGenres({ genres, onBrowse }: { genres: GenreTile[]; onBrowse: (key: string) => void }) {
  if (genres.length === 0) return null;
  return (
    <section className="home-genres" aria-labelledby="home-genres" data-testid="home-genres">
      <SectionHeader id="home-genres" title={homeStrings.genres} subtitle={homeStrings.genresHint} />
      <ul className="home-genres__grid">
        {genres.map((genre) => (
          <li key={genre.key}>
            <button type="button" className="home-genre" onClick={() => onBrowse(genre.key)}>
              <span className="home-genre__fan" aria-hidden="true">
                {genre.covers.map((novel, index) => (
                  <span key={novel.id} className={`home-genre__cover home-genre__cover--${index}`}>
                    <Cover src={novel.coverUrl} title={novel.title} size="fill" />
                  </span>
                ))}
              </span>
              <span className="home-genre__text">
                <span className="home-genre__label">{genre.label}</span>
                <span className="home-genre__count">{homeStrings.works(genre.count)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

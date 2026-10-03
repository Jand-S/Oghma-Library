#!/usr/bin/env node
// Deterministic fixture generator for the Oghma bench harness.
//
// Produces (in bench/fixtures/out/ by default) exactly what src/services/staticBackend.ts and
// src/services/bundle.ts expect from the B2/CDN:
//   index.json                                   -> { schema, builtAt, sites: [{ id, name, catalogKey, catalogJsonKey, ... }] }
//   catalog/<site>-bench.json.gz                 -> gzipped { schema, taxonomyVersion, source, taxonomy, novels: [...] }
//   covers/cNN.png                               -> small generated covers (2:3)
//   bundles/bundle-<n>.tar.gz                    -> tar.gz with meta.json + chapters/<n>.html (+ assets/*)
//   library.json                                 -> 500 "already downloaded" books for the Tauri shim
//   manifest.json                                -> summary (counts, bundle variants, search tokens)
//
// Usage: node fixtures/generate.mjs [--out <dir>] [--novels 5000] [--secondary 400] [--library 500]
//                                   [--max-chapter-entries 50] [--seed 20260929]
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, encodeTar, gzip } from "../lib/encoders.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const OUT = path.resolve(arg("out", path.join(here, "out")));
const PRIMARY_COUNT = Number(arg("novels", 5000));
const SECONDARY_COUNT = Number(arg("secondary", 400));
const LIBRARY_COUNT = Number(arg("library", 500));
const MAX_CHAPTER_ENTRIES = Number(arg("max-chapter-entries", 50));
const SEED = Number(arg("seed", 20260929));
const COVER_COUNT = 48;
export const DEFAULT_OUTPUT_PATH = "~/Documents/Oghma Library/exports";

// ---------- deterministic PRNG ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const pick = (list) => list[Math.floor(rand() * list.length)];
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
function sample(list, n) {
  const copy = [...list];
  const out = [];
  while (out.length < n && copy.length) out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0]);
  return out;
}

export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "novel";
}

// Same rule as src/services/downloadManager.ts sanitizeFileName
export function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "novel";
}

// ---------- vocabulary (PT-BR with accents + EN + romanized JP/KR/CN) ----------
const nounsPt = [
  "Dragão", "Lâmina", "Coração", "Espírito", "Príncipe", "Órfão", "Céu", "Névoa", "Crônica", "Espada",
  "Feiticeiro", "Imperador", "Guardião", "Mago", "Cavaleiro", "Herdeira", "Tempestade", "Lua", "Sombra", "Chama",
  "Ceifador", "Alquimista", "Vilã", "Bruxa", "Oráculo", "Fênix", "Leviatã", "Demônio", "Santuário", "Abismo"
];
const adjPt = [
  "Esquecido", "Carmesim", "Eterno", "Proibido", "Silencioso", "Dourado", "Sombrio", "Celestial", "Último", "Invencível",
  "Quebrado", "Amaldiçoado", "Sagrado", "Perdido", "Infinito", "Rebelde", "Gélido", "Ardente", "Solitário", "Lendário"
];
const placesPt = [
  "Reino do Norte", "Torre de Marfim", "Academia Arcana", "Cidade Submersa", "Montanha Azul", "Império Celeste",
  "Vale das Almas", "Floresta de Cristal", "Ilha dos Mortos", "Capital Real", "Deserto Escarlate", "São Magnólia"
];
const nounsEn = ["Blade", "Throne", "Dungeon", "Tower", "Saint", "Villainess", "Hero", "Necromancer", "Archmage", "Sword Saint"];
const romaji = ["Kitsune", "Kenshi", "Akira", "Sakura", "Tensei", "Mushoku", "Kaiser", "Yokai", "Hwarang", "Xianxia"];
// Rare, ASCII-only tokens used by the search benchmark (see manifest.searchTokens).
const rareTokens = ["Kraken", "Zephyr", "Quokka"];

const patterns = [
  () => `O ${pick(nounsPt)} ${pick(adjPt)}`,
  () => `A Lenda do ${pick(nounsPt)}`,
  () => `Crônicas de ${pick(placesPt)}`,
  () => `Reencarnei como ${pick(nounsPt)} em ${pick(placesPt)}`,
  () => `${pick(nounsPt)} de ${pick(placesPt)}`,
  () => `The ${pick(adjPt)} ${pick(nounsEn)}`,
  () => `${pick(romaji)} no ${pick(nounsPt)}`,
  () => `${int(1, 99)}: ${pick(nounsEn)} of ${pick(placesPt)}`,
  () => `Minha Vida como ${pick(nounsPt)} ${pick(adjPt)} Não Pode Ser Tão Tranquila`,
  () => `${pick(nounsEn)}'s Return — ${pick(adjPt)}`,
  () => `Ascensão do ${pick(nounsPt)} ${pick(adjPt)}`
];

const firstNames = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Fábio", "Gustavo", "Helena", "Iara", "João", "Lúcia", "Marcos",
  "Natália", "Otávio", "Paula", "Rafael", "Sofia", "Tiago", "Vitória", "Yuri", "Haruto", "Mei", "Wang", "Min-jun"];
const lastNames = ["Almeida", "Barbosa", "Cardoso", "Duarte", "Esteves", "Ferraz", "Gonçalves", "Holanda", "Ibrahim", "Jardim",
  "Lacerda", "Monteiro", "Nogueira", "Oliveira", "Pereira", "Queiroz", "Ribeiro", "Tanaka", "Watanabe", "Lee", "Chen", "Park"];

// Subset of the canonical taxonomy from src/core/tagFilters.ts (key, PT label with accents, category)
const tagPool = [
  ["genre.action", "Ação", "genre"], ["genre.adventure", "Aventura", "genre"], ["genre.fantasy", "Fantasia", "genre"],
  ["genre.romance", "Romance", "genre"], ["genre.drama", "Drama", "genre"], ["genre.comedy", "Comédia", "genre"],
  ["genre.mystery", "Mistério", "genre"], ["genre.psychological", "Psicológico", "genre"], ["genre.horror", "Terror", "genre"],
  ["genre.sci_fi", "Ficção Científica", "genre"], ["genre.tragedy", "Tragédia", "genre"], ["genre.slice_of_life", "Cotidiano", "genre"],
  ["genre.historical", "Histórico", "genre"], ["genre.martial_arts", "Artes Marciais", "genre"], ["genre.isekai", "Isekai", "genre"],
  ["genre.wuxia", "Wuxia", "genre"], ["genre.xianxia", "Xianxia", "genre"], ["genre.cultivation", "Cultivo", "genre"],
  ["genre.shounen", "Shounen", "genre"], ["genre.seinen", "Seinen", "genre"], ["genre.supernatural", "Sobrenatural", "genre"],
  ["genre.ecchi", "Ecchi", "genre"], ["genre.adult", "Adulto", "genre"], ["genre.mecha", "Mecha", "genre"],
  ["theme.harem", "Harém", "theme"], ["theme.magic", "Magia", "theme"], ["theme.reincarnation", "Reencarnação", "theme"],
  ["theme.system", "Sistema", "theme"], ["theme.dragons", "Dragões", "theme"], ["theme.demons", "Demônios", "theme"],
  ["theme.academy", "Academia", "theme"], ["theme.revenge", "Vingança", "theme"], ["theme.villainess", "Vilã", "theme"],
  ["theme.dungeons", "Calabouços", "theme"], ["theme.weak_to_strong", "Fraco a Forte", "theme"],
  ["format.light_novel", "Light Novel", "format"], ["format.webnovel", "Webnovel", "format"], ["format.korean", "Coreana", "format"],
  ["format.japanese", "Japonesa", "format"], ["format.chinese", "Chinesa", "format"], ["format.brazilian", "Brasileira", "format"]
];

const sentences = [
  "Em um mundo onde a magia é proibida, um jovem órfão descobre um poder esquecido.",
  "Depois de morrer, ele desperta no corpo do vilão de seu romance favorito.",
  "A guerra entre os reinos já dura séculos, e ninguém se lembra de como começou.",
  "Ela jurou vingança contra a família que a traiu — mas o destino tinha outros planos.",
  "Um sistema misterioso aparece diante dos seus olhos: “Missão recebida”.",
  "As torres flutuantes guardam segredos que nenhum mago ousou revelar.",
  "No fundo do calabouço, algo antigo começa a despertar.",
  "O herói lendário voltou, mas desta vez não pretende salvar ninguém."
];

function chapterCountFor() {
  // log-uniform 1..3000 with a bump of short works
  if (rand() < 0.08) return int(1, 12);
  return Math.max(1, Math.round(Math.exp(Math.log(3000) * rand())));
}

function statusFor() {
  const r = rand();
  if (r < 0.55) return "ongoing";
  if (r < 0.85) return "completed";
  if (r < 0.95) return "hiatus";
  return "Em andamento";
}

function isoDate(dayOffset) {
  const base = Date.UTC(2026, 8, 20); // 2026-09-20
  return new Date(base - dayOffset * 86400000).toISOString();
}

function makeNovels(site, count, usedTitles) {
  const novels = [];
  for (let i = 0; i < count; i += 1) {
    let title = pick(patterns)();
    if (rand() < 0.015) title = `${title} e o ${pick(rareTokens)}`;
    else if (rand() < 0.01) title = `${pick(rareTokens)}: ${title}`;
    let unique = title;
    let n = 2;
    while (usedTitles.has(unique.toLowerCase())) unique = `${title} ${["II", "III", "IV", "V"][n - 2] ?? `Vol. ${n}`}`, n += 1;
    usedTitles.add(unique.toLowerCase());
    const slugBase = slugify(unique);
    const slug = `${slugBase}-${String(i).padStart(4, "0")}`;
    const chapterCount = chapterCountFor();
    const tags = sample(tagPool, int(2, 7));
    const noAuthor = rand() < 0.05;
    const noCover = rand() < 0.04;
    const coverIndex = i % COVER_COUNT;
    const chapters = [];
    const head = Math.min(chapterCount, Math.max(0, MAX_CHAPTER_ENTRIES - 3));
    for (let c = 1; c <= head; c += 1) chapters.push({ number: c, title: `Capítulo ${c}${c % 7 === 0 ? " — Interlúdio" : ""}` });
    for (let c = Math.max(head + 1, chapterCount - 2); c <= chapterCount && chapters.length < MAX_CHAPTER_ENTRIES; c += 1) {
      chapters.push({ number: c, title: `Capítulo ${c}` });
    }
    novels.push({
      id: `${site.id}:${slug}`,
      slug,
      title: unique,
      author: noAuthor ? null : `${pick(firstNames)} ${pick(lastNames)}`,
      description: sample(sentences, int(1, 3)).join(" "),
      coverUrl: noCover ? null : `covers/c${String(coverIndex).padStart(2, "0")}.png`,
      language: rand() < 0.85 ? "pt-BR" : "en",
      status: statusFor(),
      tags: tags.map((t) => t[1]),
      tagKeys: tags.map((t) => t[0]),
      chapterCount,
      updatedAt: isoDate(int(0, 900)),
      extra: {},
      bundleKey: rand() < 0.02 ? null : `content/${site.id}/${slug}/${slug}.v1.tar.gz`,
      bundleVersion: 1,
      bundleSha256: null,
      bundleBytes: 4096 + chapterCount * 900,
      chapters
    });
  }
  return novels;
}

function taxonomyFor(novels) {
  const counts = new Map();
  for (const novel of novels) for (const key of novel.tagKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return tagPool
    .filter(([key]) => counts.has(key))
    .map(([key, label, category]) => ({ key, label, category, aliases: [label], count: counts.get(key), reviewStatus: "curated" }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
}

// ---------- covers ----------
const palette = [
  [[32, 44, 89], [196, 72, 88]], [[18, 68, 72], [236, 196, 96]], [[70, 30, 90], [120, 200, 220]], [[20, 20, 28], [200, 60, 40]],
  [[90, 60, 30], [240, 220, 180]], [[30, 80, 50], [200, 230, 120]], [[60, 20, 40], [250, 150, 190]], [[10, 40, 70], [140, 180, 255]]
];
function coverPng(index) {
  const [a, b] = palette[index % palette.length];
  const stripe = 6 + (index % 5) * 3;
  const w = 90;
  const h = 135;
  return encodePng(w, h, (x, y) => {
    const t = y / (h - 1);
    let rgb = a.map((v, k) => Math.round(v + (b[k] - v) * t));
    if (((x + y + index * 7) % (stripe * 2)) < stripe / 3) rgb = rgb.map((v) => Math.min(255, v + 18));
    if (y > h * 0.72 && y < h * 0.86) rgb = rgb.map((v) => Math.round(v * 0.35));
    if (x < 4 || x > w - 5 || y < 4 || y > h - 5) rgb = [240, 236, 228];
    return rgb;
  });
}

// ---------- bundles ----------
const paragraphs = [
  "O vento soprava frio sobre as muralhas quando a primeira estrela caiu.",
  "— Você não entende — disse ela, com a voz embargada. — Não há mais volta.",
  "Ele segurou a lâmina com as duas mãos e sentiu o coração acelerar.",
  "A cidade inteira parecia prender a respiração diante do portão de ébano.",
  "Naquela noite, o céu se abriu em cores que ninguém jamais havia visto."
];
function bundleFor(variant, chapterCount, withAsset) {
  const files = [];
  const meta = {
    id: `bench-bundle-${variant}`,
    source_id: "acervo-alfa",
    slug: `bench-bundle-${variant}`,
    title: `Bundle de teste ${variant}`,
    bundle_version: 1,
    generated_at: "2026-09-20T00:00:00Z",
    chapters: []
  };
  for (let c = 1; c <= chapterCount; c += 1) {
    const body = Array.from({ length: 6 }, (_, k) => `<p>${paragraphs[(c + k) % paragraphs.length]}</p>`).join("");
    const img = withAsset && c === 1 ? `<p><img src="../assets/ilustracao.png" alt="Ilustração"/></p>` : "";
    files.push({ name: `chapters/${c}.html`, data: `<h2>Capítulo ${c}</h2>${img}${body}` });
    meta.chapters.push({ number: c, title: `Capítulo ${c}`, file: `chapters/${c}.html`, words: 90 });
  }
  if (withAsset) files.push({ name: "assets/ilustracao.png", data: coverPng(variant + 3) });
  return gzip(encodeTar([{ name: "meta.json", data: JSON.stringify(meta, null, 2) }, ...files]));
}
const BUNDLE_VARIANTS = [
  { chapters: 3, withAsset: false },
  { chapters: 12, withAsset: true },
  { chapters: 40, withAsset: false },
  { chapters: 120, withAsset: false }
];

// ---------- main ----------
function writeFile(rel, data) {
  const target = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return target;
}

function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  const usedTitles = new Set();
  const sites = [
    { id: "acervo-alfa", name: "Acervo Alfa", baseUrl: "https://alfa.bench.invalid/", count: PRIMARY_COUNT },
    { id: "acervo-beta", name: "Acervo Beta", baseUrl: "https://beta.bench.invalid/", count: SECONDARY_COUNT }
  ].filter((site) => site.count > 0);

  const index = { schema: 1, builtAt: "2026-09-20T00:00:00Z", sites: [] };
  const catalogs = {};
  for (const site of sites) {
    const novels = makeNovels(site, site.count, usedTitles);
    const catalog = {
      schema: 1,
      taxonomyVersion: 1,
      source: { id: site.id, name: site.name, baseUrl: site.baseUrl },
      taxonomy: taxonomyFor(novels),
      novels
    };
    catalogs[site.id] = catalog;
    const key = `catalog/${site.id}-bench.json.gz`;
    const gz = gzip(Buffer.from(JSON.stringify(catalog)));
    writeFile(key, gz);
    index.sites.push({
      id: site.id,
      name: site.name,
      catalogKey: `catalog/${site.id}-bench.sqlite.gz`,
      catalogSha256: "0".repeat(64),
      catalogJsonKey: key,
      // The app refuses a catalog whose bytes do not match this hash.
      catalogJsonSha256: createHash("sha256").update(gz).digest("hex"),
      catalogVersion: 1,
      novelCount: novels.length,
      updatedAt: "2026-09-20T00:00:00Z"
    });
  }
  writeFile("index.json", JSON.stringify(index, null, 2));

  for (let i = 0; i < COVER_COUNT; i += 1) writeFile(`covers/c${String(i).padStart(2, "0")}.png`, coverPng(i));
  BUNDLE_VARIANTS.forEach((variant, i) => writeFile(`bundles/bundle-${i}.tar.gz`, bundleFor(i, variant.chapters, variant.withAsset)));

  // Library: every Nth primary novel with a bundle, stored as the Rust `list_export_library` rows expect.
  const primary = catalogs[sites[0].id].novels.filter((novel) => novel.bundleKey);
  const step = Math.max(1, Math.floor(primary.length / Math.max(1, LIBRARY_COUNT)));
  const library = [];
  for (let i = 0; library.length < LIBRARY_COUNT && i < primary.length; i += step) {
    const novel = primary[i];
    const title = sanitizeFileName(novel.title);
    const formats = library.length % 5 === 0 ? ["epub", "azw3"] : library.length % 7 === 0 ? ["epub", "txt"] : ["epub"];
    library.push({
      novelId: novel.id,
      catalogTitle: novel.title,
      title,
      output_dir: `${DEFAULT_OUTPUT_PATH}/${title}`,
      files: [...formats.map((ext) => `${title}.${ext}`), "cover.png"],
      coverIndex: novel.coverUrl ? Number(novel.coverUrl.match(/c(\d+)\.png/)[1]) : null,
      size_bytes: 180_000 + novel.chapterCount * 5_200,
      chapter_count: novel.chapterCount,
      source_chars: novel.chapterCount * 10_400,
      word_count: novel.chapterCount * 1_900,
      analysis_format: "bundle"
    });
  }
  writeFile("library.json", JSON.stringify(library));

  const manifest = {
    generatedBy: "bench/fixtures/generate.mjs",
    seed: SEED,
    sites: index.sites.map((site) => ({ id: site.id, name: site.name, novels: site.novelCount })),
    primarySiteId: sites[0].id,
    libraryCount: library.length,
    coverCount: COVER_COUNT,
    maxChapterEntries: MAX_CHAPTER_ENTRIES,
    bundleVariants: BUNDLE_VARIANTS.map((variant, i) => ({ file: `bundles/bundle-${i}.tar.gz`, ...variant })),
    bundleRule: "every content/**/*.tar.gz request is served bundles/bundle-<hash(slug) % 4>.tar.gz",
    searchTokens: rareTokens.map((token) => token.toLowerCase()),
    catalogBytes: Object.fromEntries(index.sites.map((site) => [site.id, fs.statSync(path.join(OUT, site.catalogJsonKey)).size]))
  };
  writeFile("manifest.json", JSON.stringify(manifest, null, 2));
  console.log(`fixtures -> ${OUT}`);
  console.log(JSON.stringify({ sites: manifest.sites, library: library.length, catalogBytes: manifest.catalogBytes }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

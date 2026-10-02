// Fake translation engine for the bench (Playwright init script, loaded after tauri-shim.js).
//
// Answers the translation_* commands of TRANSLATION_CONTRACT.md with realistic data: a project
// running at 42%, one waiting for the limit, one exported and one preparing; a pilot with two
// samples, a ~20-term glossary, a verify report and chapter texts for the review reader.
//
// Options come from `window.__BENCH_TRANSLATION__` (set by an earlier init script):
//   { loggedIn: true|false, limit: true|false }
// The harness can push events with `window.__BENCH__.emit("translation://project", detail)`.
(() => {
  const B = window.__BENCH__;
  if (!B || !B.handlers) return;
  const opts = Object.assign({ loggedIn: true, limit: false }, window.__BENCH_TRANSLATION__ || {});
  const cfg = window.__BENCH_CONFIG__ || {};
  const library = (cfg.shim && cfg.shim.library) || [];
  const now = () => Math.floor(Date.now() / 1000);
  const t0 = now();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  const book = (index, fallback) => library[index] || { title: fallback, novelId: `bench:${index}`, output_dir: `~/Documents/Oghma Library/exports/${fallback}` };
  const b0 = book(0, "Reencarnei como Vilã em Cidade Submersa");
  const b1 = book(1, "Sakura no Sombra");
  const b2 = book(2, "O Último Alquimista");
  const b3 = book(3, "Crônicas da Torre Partida");

  const detail = (base) => Object.assign({
    model: "gpt-6-luna",
    effort: "none",
    workers: 2,
    scope: { kind: "all" },
    needsReview: 0,
    errors: 0,
    chaptersInProgress: [],
    chunksPerMinute: null,
    etaSeconds: null,
    resumeAt: null,
    glossaryStatus: "ready"
  }, base);

  const projects = {
    p1: detail({
      id: "p1", title: b0.catalogTitle || b0.title, sourceNovelId: b0.novelId, status: "running",
      chaptersTotal: 126, chaptersDone: 53, chunksTotal: 312, chunksDone: 131, percent: 42,
      wordsTotal: 239400, wordsDone: 100548, needsReview: 2, errors: 0, pending: 181,
      chaptersInProgress: ["Capítulo 54 — A maré negra", "Capítulo 55 — O pacto do farol"],
      chunksPerMinute: 2.4, etaSeconds: 4525
    }),
    p2: detail({
      id: "p2", title: b1.catalogTitle || b1.title, sourceNovelId: b1.novelId, status: "waiting_limit",
      chaptersTotal: 64, chaptersDone: 43, chunksTotal: 158, chunksDone: 107, percent: 68,
      wordsTotal: 118000, wordsDone: 80240, pending: 51, needsReview: 0, errors: 1,
      chunksPerMinute: 2.1, etaSeconds: 1460,
      resumeAt: t0 + 12 * 60 + 40, model: "gpt-6-sol", workers: 3
    }),
    p3: detail({
      id: "p3", title: b2.catalogTitle || b2.title, sourceNovelId: b2.novelId, status: "exported",
      chaptersTotal: 40, chaptersDone: 40, chunksTotal: 96, chunksDone: 96, percent: 100,
      wordsTotal: 74000, wordsDone: 74000, pending: 0,
      outputDir: `${String(b2.output_dir).replace(/[\\/][^\\/]+$/, "")}/${b2.catalogTitle || b2.title} (PT-BR)`
    }),
    p4: detail({
      id: "p4", title: b3.catalogTitle || b3.title, sourceNovelId: b3.novelId, status: "preparing",
      chaptersTotal: 0, chaptersDone: 0, chunksTotal: 0, chunksDone: 0, percent: 0,
      wordsTotal: 0, wordsDone: 0, pending: 0, glossaryStatus: "running"
    })
  };
  const order = ["p1", "p2", "p3", "p4"];
  const summaryKeys = ["id", "title", "coverUrl", "sourceNovelId", "status", "chaptersTotal", "chaptersDone", "chunksTotal", "chunksDone", "percent", "outputDir"];
  const summary = (p) => Object.fromEntries(summaryKeys.filter((key) => p[key] !== undefined).map((key) => [key, p[key]]));

  // ---------- texts ----------
  const SOURCE = [
    "<h1>Chapter 1 — The Drowned City</h1>",
    "<p>The bells of Merrow rang beneath the water, and nobody in the city could say when they had last been silent. Lys counted them from the window of the tower, as she did every morning, and every morning the count came out one short.</p>",
    "<p>“You are doing it again,” said Aunt Corvina from the doorway. “Counting things that cannot be counted.”</p>",
    "<p>“There were thirteen yesterday,” Lys said. “Today there are twelve. A bell does not simply <em>leave</em>.”</p>",
    "<p>Her aunt crossed the room without a sound. In the grey light her robe looked like a wet stone, and the silver thread of the Tidewardens glimmered along its hem. She set a cup of black tea on the sill and looked down at the flooded avenues, where the lanterns of the ferrymen swayed like slow fish.</p>",
    "<p>“In this city,” she said at last, “everything leaves. The question is only what it takes with it.”</p>",
    "<p>Below them, somewhere in the dark water, the twelfth bell began to ring.</p>"
  ].join("\n");
  const LUNA = [
    "<h1>Capítulo 1 — A Cidade Submersa</h1>",
    "<p>Os sinos de Merrow tocavam sob a água, e ninguém na cidade sabia dizer quando tinham ficado em silêncio pela última vez. Lys os contava da janela da torre, como fazia toda manhã, e toda manhã a conta dava um a menos.</p>",
    "<p>“Você está fazendo isso de novo”, disse a tia Corvina da porta. “Contando coisas que não podem ser contadas.”</p>",
    "<p>“Ontem eram treze”, disse Lys. “Hoje são doze. Um sino não simplesmente <em>vai embora</em>.”</p>",
    "<p>A tia atravessou o quarto sem fazer barulho. Na luz cinzenta, a túnica parecia uma pedra molhada, e o fio prateado das Guardiãs da Maré brilhava ao longo da barra. Ela pôs uma xícara de chá preto no parapeito e olhou para as avenidas alagadas, onde as lanternas dos barqueiros balançavam como peixes lentos.</p>",
    "<p>“Nesta cidade”, disse ela por fim, “tudo vai embora. A questão é só o que leva junto.”</p>",
    "<p>Lá embaixo, em algum lugar da água escura, o décimo segundo sino começou a tocar.</p>"
  ].join("\n");
  const SOL = [
    "<h1>Capítulo 1 — A Cidade Afogada</h1>",
    "<p>Os sinos de Merrow dobravam sob as águas, e ninguém na cidade saberia dizer quando haviam se calado pela última vez. Lys os contava da janela da torre, como toda manhã — e toda manhã faltava um.</p>",
    "<p>“Lá vai você de novo”, disse tia Corvina, à porta. “Contando o que não se conta.”</p>",
    "<p>“Ontem eram treze”, respondeu Lys. “Hoje são doze. Sino nenhum simplesmente <em>vai embora</em>.”</p>",
    "<p>A tia cruzou o quarto sem um ruído. Na luz cinzenta, o manto lembrava uma pedra molhada, e o fio de prata das Guardiãs da Maré cintilava na barra. Deixou uma xícara de chá preto no parapeito e contemplou as avenidas inundadas, onde as lanternas dos barqueiros oscilavam feito peixes vagarosos.</p>",
    "<p>“Nesta cidade”, disse enfim, “tudo vai embora. A única pergunta é o que leva consigo.”</p>",
    "<p>Lá embaixo, em algum ponto da água escura, o décimo segundo sino começou a dobrar.</p>"
  ].join("\n");

  const pilots = {
    p1: {
      createdAt: t0 - 86400 - 3 * 3600, sourceHtml: SOURCE, words: 1512, status: "done",
      samples: [
        { model: "gpt-6-luna", label: "Rápido", seconds: 41.8, inputTokens: 2210, outputTokens: 2604, projectedBookCredits: 6.1, valid: true, html: LUNA },
        { model: "gpt-6-sol", label: "Qualidade", seconds: 63.2, inputTokens: 2210, outputTokens: 2731, projectedBookCredits: 124, valid: true, html: SOL }
      ]
    }
  };

  const TERMS = [
    ["Merrow", "keep", null, 412, "auto", 0], ["Lys", "keep", null, 1890, "auto", 0], ["Corvina", "keep", null, 655, "auto", 0],
    ["Tidewardens", "translate", "Guardiãs da Maré", 214, "auto", 3], ["Drowned City", "translate", "Cidade Submersa", 96, "manual", 0],
    ["Lantern Guild", "translate", "Guilda das Lanternas", 71, "auto", 0], ["ferrymen", "translate", "barqueiros", 63, "auto", 0],
    ["Saltbinding", "translate", "Amarra de Sal", 58, "auto", 2], ["Undertow", "translate", "Ressaca", 52, "manual", 0],
    ["Abyssal Choir", "translate", "Coro Abissal", 44, "auto", 0], ["Vesper Isle", "translate", "Ilha Véspera", 39, "auto", 0],
    ["Hollowmere", "keep", null, 37, "auto", 0], ["Brine Court", "translate", "Corte da Salmoura", 33, "auto", 1],
    ["Kestrel", "keep", null, 31, "auto", 0], ["Tidecaller", "translate", "Chamadora da Maré", 29, "auto", 0],
    ["Sunken Bell", "translate", "Sino Submerso", 27, "manual", 0], ["Ashgrove", "keep", null, 22, "auto", 0],
    ["Pearl Script", "translate", "Escrita Perolada", 18, "auto", 0], ["Moonwell", "translate", "Poço da Lua", 15, "auto", 0],
    ["Orrin", "keep", null, 12, "auto", 0], ["Gloamwater", "translate", "Águas do Crepúsculo", 9, "auto", 0]
  ];
  const glossaries = {
    p1: TERMS.map(([term, kind, target, count, source, missed]) => ({ term, kind, target, count, source, missed })),
    p2: TERMS.slice(0, 8).map(([term, kind, target, count, source]) => ({ term, kind, target, count, source, missed: 0 })),
    p3: [], p4: []
  };

  const chapterTitle = (i) => `Capítulo ${i}`;
  const issuesFor = { 7: ["tooShort: 64% das palavras"], 18: ["paragraphMismatch: 31 × 29", "needsReview"], 41: ["englishLeft: 6%"] };
  const reports = (id) => {
    const p = projects[id];
    const chapters = Array.from({ length: p.chaptersDone }, (_, k) => ({ index: k + 1, title: chapterTitle(k + 1), issues: id === "p1" ? issuesFor[k + 1] || [] : [] }));
    return { ok: chapters.every((c) => c.issues.length === 0), chapters };
  };

  const LOG = [
    ["info", "Sessão iniciada · gpt-6-luna · 2 traduções simultâneas"],
    ["info", "Capítulo 48 concluído (3 trechos, 2.104 palavras)"],
    ["info", "Capítulo 49 concluído (2 trechos, 1.688 palavras)"],
    ["warn", "Glossário: “Tidewardens” não aplicado no trecho 49.2"],
    ["info", "Capítulo 50 concluído (3 trechos, 2.311 palavras)"],
    ["info", "Créditos na sessão: ~3,1"],
    ["warn", "Trecho 51.1: 30 blocos na saída para 31 na entrada — tentando de novo (1/3)"],
    ["info", "Trecho 51.1 validado na 2ª tentativa"],
    ["info", "Capítulo 51 concluído (2 trechos, 1.540 palavras)"],
    ["error", "Trecho 52.3: tempo esgotado na resposta — tentando de novo"],
    ["info", "Trecho 52.3 validado"],
    ["info", "Capítulo 52 concluído (3 trechos, 2.087 palavras)"],
    ["warn", "Saltbinding: tradução fixa “Amarra de Sal” ausente no trecho 53.1"],
    ["info", "Capítulo 53 concluído (2 trechos, 1.902 palavras)"],
    ["info", "Créditos na sessão: ~3,8"],
    ["info", "Traduzindo Capítulo 54 — A maré negra (trecho 1 de 3)"],
    ["info", "Traduzindo Capítulo 55 — O pacto do farol (trecho 2 de 2)"]
  ];
  const logs = {
    p1: LOG.map(([level, message], i) => ({ at: t0 - (LOG.length - i) * 47, level, message })),
    p2: [
      { at: t0 - 900, level: "info", message: "Capítulo 43 concluído (2 trechos, 1.870 palavras)" },
      { at: t0 - 600, level: "warn", message: "ChatGPT: limite de uso atingido (subscription_sharing_usage_limit_exceeded)" },
      { at: t0 - 598, level: "info", message: "Nova tentativa em 15 min" }
    ],
    p3: [{ at: t0 - 86400, level: "info", message: "Livro PT-BR gerado na Biblioteca" }],
    p4: [{ at: t0 - 5, level: "info", message: "Lendo o EPUB e dividindo em trechos…" }]
  };

  const usage = () => ({
    local: { words5h: 12400, credits5h: 3.8, words7d: 86200, credits7d: 27 },
    limitReached: opts.limit ? { at: t0 - 180, window: "five_hour", nextRetryAt: t0 + 12 * 60 + 40 } : null,
    settingsUrl: "https://chatgpt.com/settings/usage"
  });

  const h = B.handlers;
  const record = (name) => { (B.translation = B.translation || []).push(name); };
  h.translation_account = () => ({ loggedIn: opts.loggedIn, email: opts.loggedIn ? "leitora@exemplo.com.br" : undefined, planType: opts.loggedIn ? "plus" : undefined });
  h.translation_login = () => { record("login"); setTimeout(() => B.emit("translation://account", { loggedIn: true, email: "leitora@exemplo.com.br", planType: "plus" }), 1500); return null; };
  h.translation_login_cancel = () => null;
  h.translation_logout = () => null;
  h.translation_usage = () => usage();
  h.translation_list_projects = () => order.map((id) => summary(projects[id]));
  h.translation_get_project = ({ projectId }) => clone(projects[projectId]);
  h.translation_create_project = ({ title, sourceNovelId }) => {
    const id = `p${order.length + 1}`;
    projects[id] = detail({ id, title, sourceNovelId, status: "preparing", chaptersTotal: 0, chaptersDone: 0, chunksTotal: 0, chunksDone: 0, percent: 0, wordsTotal: 0, wordsDone: 0, pending: 0, glossaryStatus: "running" });
    order.unshift(id);
    glossaries[id] = [];
    logs[id] = [];
    return summary(projects[id]);
  };
  h.translation_delete_project = ({ projectId }) => { order.splice(order.indexOf(projectId), 1); return null; };
  h.translation_update_settings = ({ projectId, ...patch }) => { Object.assign(projects[projectId], Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))); return clone(projects[projectId]); };
  h.translation_start = ({ projectId }) => { projects[projectId].status = "running"; B.emit("translation://project", clone(projects[projectId])); return null; };
  h.translation_pause = ({ projectId }) => { projects[projectId].status = "paused"; B.emit("translation://project", clone(projects[projectId])); return null; };
  h.translation_cancel = ({ projectId }) => { projects[projectId].status = "paused"; B.emit("translation://project", clone(projects[projectId])); return null; };
  h.translation_glossary = ({ projectId }) => clone(glossaries[projectId] || []);
  h.translation_glossary_upsert = ({ projectId, entry }) => {
    const list = glossaries[projectId];
    const found = list.find((e) => e.term === entry.term);
    if (found) Object.assign(found, { kind: entry.kind, target: entry.target ?? null, source: "manual" });
    else list.unshift({ term: entry.term, kind: entry.kind, target: entry.target ?? null, count: 0, source: "manual", missed: 0 });
    return clone(list);
  };
  h.translation_glossary_delete = ({ projectId, term }) => { glossaries[projectId] = glossaries[projectId].filter((e) => e.term !== term); return clone(glossaries[projectId]); };
  h.translation_glossary_regenerate = () => null;
  h.translation_run_pilot = () => null;
  h.translation_pilot = ({ projectId }) => clone(pilots[projectId] || null);
  h.translation_choose_model = ({ projectId, model }) => { projects[projectId].model = model; return clone(projects[projectId]); };
  h.translation_chapter = ({ projectId, chapterIndex }) => ({
    index: chapterIndex,
    title: chapterTitle(chapterIndex),
    sourceHtml: SOURCE.replace("Chapter 1", `Chapter ${chapterIndex}`) + "\n" + SOURCE.split("\n").slice(1).join("\n"),
    translatedHtml: (LUNA.replace("Capítulo 1", `Capítulo ${chapterIndex}`) + "\n" + LUNA.split("\n").slice(1).join("\n")),
    status: (issuesFor[chapterIndex] || []).includes("needsReview") ? "needs_review" : "translated",
    issues: projectId === "p1" ? issuesFor[chapterIndex] || [] : []
  });
  h.translation_retranslate = () => null;
  h.translation_verify = ({ projectId }) => reports(projectId);
  h.translation_export = ({ projectId }) => ({ outputDir: projects[projectId].outputDir || "~/Documents/Oghma Library/exports/PT-BR", title: `${projects[projectId].title} (PT-BR)` });
  h.translation_log = ({ projectId }) => clone(logs[projectId] || []);

  B.translationProjects = projects;
})();

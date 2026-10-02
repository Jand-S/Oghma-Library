// Fake Tauri runtime for running the Oghma desktop UI in a plain browser (Playwright init script).
//
// Reads its configuration from `window.__BENCH_CONFIG__` (installed by a previous init script, see
// lib/context.mjs). Records every invoke in `window.__BENCH__` so the harness can assert on
// side-effects (saves after cancel, Kindle sends, ...).
//
// Commands answered (src-tauri/src/lib.rs + @tauri-apps/api plugins):
//   save_export_file, open_local_path, list_export_library, delete_export_library_item,
//   detect_kindle, convert_export_to_azw3, send_to_kindle,
//   list_library_meta, save_library_meta, delete_library_meta,
//   begin_export, commit_export, abort_export, cleanup_export_root (export staging),
//   plugin:window|* , plugin:event|listen/unlisten/emit, plugin:opener|*, plugin:os|*, plugin:dialog|open
// Unknown commands resolve to null and are listed in __BENCH__.unknown.
// Extension points: __BENCH__.handlers (add commands) and __BENCH__.emit(event, payload) (Tauri events);
// translation-shim.js uses them for the translation_* commands.
(() => {
  const cfg = window.__BENCH_CONFIG__ || {};
  const shimCfg = cfg.shim || {};
  const now = () => performance.now();

  // ---------- localStorage seeding (core/appConfig.ts) ----------
  try {
    const SETUP = "oghma.setup.v1";
    const DONE = "oghma.setup.complete.v1";
    if (cfg.setup === "complete") {
      if (!localStorage.getItem(DONE)) {
        localStorage.setItem(SETUP, JSON.stringify(cfg.appConfig || {}));
        localStorage.setItem(DONE, "1");
      }
    } else if (cfg.setup === "fresh") {
      if (!sessionStorage.getItem("__bench_fresh")) {
        localStorage.removeItem(SETUP);
        localStorage.removeItem(DONE);
        sessionStorage.setItem("__bench_fresh", "1");
      }
    }
    for (const [key, value] of Object.entries(cfg.extraLocalStorage || {})) {
      if (localStorage.getItem(key) == null) localStorage.setItem(key, value);
    }
  } catch (error) {
    console.warn("[bench-shim] localStorage seed failed", error);
  }

  // ---------- platform (future UI keys html[data-platform] off userAgent) ----------
  const platform = cfg.platform || "windows";
  const navPlatform = { macos: "MacIntel", windows: "Win32", linux: "Linux x86_64" }[platform] || "Win32";
  try {
    Object.defineProperty(Navigator.prototype, "platform", { get: () => navPlatform, configurable: true });
  } catch { /* ignore */ }
  window.__TAURI_OS_PLUGIN_INTERNALS__ = {
    platform: platform === "windows" ? "windows" : platform,
    os_type: platform,
    family: platform === "windows" ? "windows" : "unix",
    version: platform === "macos" ? "15.0.0" : "10.0.26100",
    arch: platform === "macos" ? "aarch64" : "x86_64",
    exe_extension: platform === "windows" ? "exe" : "",
    eol: platform === "windows" ? "\r\n" : "\n"
  };

  if (cfg.tauri === false) return; // plain-browser mode (no fake runtime)

  // ---------- state ----------
  const B = (window.__BENCH__ = {
    invokes: [],
    saves: [],
    kindleSends: [],
    conversions: [],
    unknown: [],
    marks: {},
    savedDirs: {},
    meta: {},
    deletedDirs: [],
    // Export staging (begin/commit/abort_export): one entry per call.
    staging: [],
    // novelId -> committed book folder, and folder -> manifest title
    bookDirs: {},
    bookTitles: {},
    mark(name) {
      this.marks[name] = now();
      return this.marks[name];
    }
  });

  const library = Array.isArray(shimCfg.library) ? shimCfg.library : [];
  const covers = Array.isArray(shimCfg.coverDataUrls) ? shimCfg.coverDataUrls : [];
  for (const row of shimCfg.libraryMeta || []) B.meta[row.key] = row;

  const decode = (value) => {
    try {
      return decodeURIComponent(value || "");
    } catch {
      return value || "";
    }
  };
  const byteLength = (args) => {
    if (!args) return 0;
    if (args instanceof ArrayBuffer) return args.byteLength;
    if (ArrayBuffer.isView(args)) return args.byteLength;
    if (Array.isArray(args)) return args.length;
    return 0;
  };
  const basename = (p) => String(p || "").split(/[\\/]/).filter(Boolean).pop() || "";
  const sanitizeFileName = (name) => String(name || "").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "novel";
  const trimSlash = (p) => String(p || "").replace(/[\\/]+$/, "");
  // Staging/trash dirs (".oghma-staging/...") are never library books.
  const isHiddenDir = (dir) => /(^|[\\/])\.[^\\/]/.test(String(dir || ""));

  // Rows carry both the legacy snake_case fields (v1.0.0) and the camelCase ones the
  // current Rust `list_export_library` returns.
  function libraryRow({ title, folderName, outputDir, files, coverDataUrl, sizeBytes, novelId, chapterCount, sourceChars, wordCount, analysisFormat }) {
    return {
      title,
      folderName: folderName ?? basename(outputDir),
      outputDir,
      files,
      coverPath: null,
      coverDataUrl: coverDataUrl ?? null,
      sizeBytes,
      mtimeMs: null,
      novelId: novelId ?? null,
      generatedAt: null,
      chapterCount: chapterCount ?? null,
      sourceChars: sourceChars ?? null,
      wordCount: wordCount ?? null,
      analysisFormat: analysisFormat ?? null,
      output_dir: outputDir,
      cover_path: null,
      cover_data_url: coverDataUrl ?? null,
      size_bytes: sizeBytes,
      chapter_count: chapterCount ?? null,
      source_chars: sourceChars ?? null,
      word_count: wordCount ?? null,
      analysis_format: analysisFormat ?? null
    };
  }

  function libraryRows(outputDir) {
    const rows = library.map((row) => libraryRow({
      title: row.catalogTitle ?? row.title,
      folderName: row.title,
      outputDir: row.output_dir,
      files: row.files,
      coverDataUrl: row.coverIndex != null && covers[row.coverIndex] ? covers[row.coverIndex] : null,
      sizeBytes: row.size_bytes,
      novelId: row.novelId,
      chapterCount: row.chapter_count,
      sourceChars: row.source_chars,
      wordCount: row.word_count,
      analysisFormat: row.analysis_format
    }));
    const novelIdByDir = new Map(Object.entries(B.bookDirs).map(([novelId, dir]) => [dir, novelId]));
    // Books saved during this session show up too (keyed by directory, like the Rust side does).
    const known = new Set(rows.map((row) => row.output_dir));
    for (const [dir, files] of Object.entries(B.savedDirs)) {
      if (known.has(dir) || B.deletedDirs.includes(dir) || isHiddenDir(dir)) continue;
      if (outputDir && !dir.startsWith(String(outputDir).replace(/[\\/]+$/, ""))) continue;
      const bookFiles = [...files].filter((file) => !file.startsWith("."));
      if (!bookFiles.some((file) => /\.(epub|azw3|txt|html)$/i.test(file))) continue;
      rows.push(libraryRow({
        title: B.bookTitles[dir] || basename(dir),
        outputDir: dir,
        files: bookFiles,
        coverDataUrl: covers[0] || null,
        sizeBytes: 250000,
        novelId: novelIdByDir.get(dir)
      }));
    }
    return rows.filter((row) => !B.deletedDirs.includes(row.outputDir));
  }

  function kindleStatus() {
    const connected = Boolean(shimCfg.kindle);
    return {
      id: connected ? "kindle-/Volumes/Kindle/documents" : "kindle-usb",
      deviceName: "Kindle",
      connected,
      mountPath: connected ? "/Volumes/Kindle/documents" : "",
      targetFormat: "AZW3",
      converterAvailable: true,
      transport: connected ? "mass_storage" : "none"
    };
  }

  const handlers = {
    save_export_file(args, options) {
      const headers = (options && options.headers) || {};
      const dir = decode(headers["x-oghma-output-dir"]);
      const name = decode(headers["x-oghma-file-name"]);
      const entry = { t: now(), dir, name, bytes: byteLength(args) };
      B.saves.push(entry);
      (B.savedDirs[dir] = B.savedDirs[dir] || new Set()).add(name);
      return `${dir}/${name}`;
    },
    open_local_path(args) {
      return null;
    },
    list_export_library(args) {
      return libraryRows(args && args.outputDir);
    },
    // ---- export staging (Rust begin/commit/abort_export) ----
    begin_export(args) {
      const root = trimSlash(args && args.outputRoot);
      const novelId = String((args && args.novelId) || "novel");
      const stagingDir = `${root}/.oghma-staging/${novelId}-${Date.now()}`;
      const existing = B.bookDirs[novelId] || library.find((row) => row.novelId === novelId)?.output_dir;
      const finalDir = existing || `${root}/${sanitizeFileName(args && args.title)}`;
      B.bookTitles[stagingDir] = String((args && args.title) || basename(finalDir));
      B.staging.push({ t: now(), event: "begin", novelId, stagingDir, finalDir });
      return { stagingDir, finalDir };
    },
    commit_export(args) {
      const { stagingDir, finalDir, novelId } = args || {};
      const files = [...(B.savedDirs[stagingDir] || [])];
      delete B.savedDirs[stagingDir];
      B.savedDirs[finalDir] = new Set(files);
      B.deletedDirs = B.deletedDirs.filter((dir) => dir !== finalDir);
      if (novelId) B.bookDirs[novelId] = finalDir;
      B.bookTitles[finalDir] = B.bookTitles[stagingDir] || basename(finalDir);
      // Synthetic "saves" in the final folder so harness checks keyed on the book dir keep working.
      for (const name of files) B.saves.push({ t: now(), dir: finalDir, name, bytes: 0, committed: true });
      B.staging.push({ t: now(), event: "commit", novelId, stagingDir, finalDir, files });
      return null;
    },
    abort_export(args) {
      const stagingDir = args && args.stagingDir;
      const files = [...(B.savedDirs[stagingDir] || [])];
      delete B.savedDirs[stagingDir];
      B.staging.push({ t: now(), event: "abort", stagingDir, files });
      return null;
    },
    cleanup_export_root() {
      return 0;
    },
    delete_export_library_item(args) {
      const dir = args && args.itemDir;
      if (dir) B.deletedDirs.push(dir);
      return null;
    },
    detect_kindle() {
      return kindleStatus();
    },
    convert_export_to_azw3(args) {
      const title = (args && args.title) || "novel";
      const fileName = `${String(title).replace(/[\\/:*?"<>|]+/g, "_").trim()}.azw3`;
      B.conversions.push({ t: now(), title, outputDir: args && args.outputDir, fileName });
      if (args && args.outputDir) (B.savedDirs[args.outputDir] = B.savedDirs[args.outputDir] || new Set()).add(fileName);
      return { fileName };
    },
    send_to_kindle(args) {
      const items = (args && args.items) || [];
      B.kindleSends.push({ t: now(), items });
      return { sentIds: items.map((item) => item.id), convertedFormat: "AZW3" };
    },
    list_library_meta() {
      return Object.values(B.meta);
    },
    save_library_meta(args) {
      if (args && args.meta) B.meta[args.meta.key] = args.meta;
      return null;
    },
    delete_library_meta(args) {
      if (args && args.key) delete B.meta[args.key];
      return null;
    }
  };

  // ---------- callbacks / events (transformCallback is used by listen() and Channels) ----------
  const callbacks = new Map();
  let nextCallbackId = 1;
  function transformCallback(callback, once) {
    const id = nextCallbackId++;
    callbacks.set(id, (payload) => {
      if (once) callbacks.delete(id);
      return callback && callback(payload);
    });
    window[`_${id}`] = (payload) => callbacks.get(id) && callbacks.get(id)(payload);
    return id;
  }
  function unregisterCallback(id) {
    callbacks.delete(id);
    delete window[`_${id}`];
  }
  const listeners = new Map(); // event -> [{ id, handler }]
  let nextEventId = 1;

  function pluginCommand(cmd, args) {
    const [plugin, command] = cmd.slice("plugin:".length).split("|");
    if (plugin === "event") {
      if (command === "listen") {
        const eventId = nextEventId++;
        const list = listeners.get(args.event) || [];
        list.push({ id: eventId, handler: args.handler });
        listeners.set(args.event, list);
        return eventId;
      }
      if (command === "unlisten") {
        const list = listeners.get(args.event) || [];
        listeners.set(args.event, list.filter((entry) => entry.id !== args.eventId));
        return null;
      }
      if (command === "emit" || command === "emit_to") {
        for (const entry of listeners.get(args.event) || []) {
          const cb = callbacks.get(entry.handler);
          if (cb) cb({ event: args.event, id: entry.id, payload: args.payload });
        }
        return null;
      }
    }
    if (plugin === "window") {
      B.windowActions = B.windowActions || [];
      B.windowActions.push({ t: now(), command });
      if (command === "is_maximized" || command === "is_fullscreen" || command === "is_minimized") return false;
      if (command === "is_visible" || command === "is_focused" || command === "is_decorated" || command === "is_resizable") return true;
      if (command === "scale_factor") return window.devicePixelRatio || 1;
      if (command === "theme") return "dark";
      if (command === "inner_size" || command === "outer_size") return { width: innerWidth, height: innerHeight };
      if (command === "inner_position" || command === "outer_position") return { x: 0, y: 0 };
      return null;
    }
    if (plugin === "os") {
      const os = window.__TAURI_OS_PLUGIN_INTERNALS__;
      if (command === "platform") return os.platform;
      if (command === "os_type") return os.os_type;
      if (command === "version") return os.version;
      if (command === "arch") return os.arch;
      if (command === "family") return os.family;
      if (command === "locale") return "pt-BR";
      if (command === "hostname") return "bench";
      return null;
    }
    if (plugin === "dialog" && command === "open") {
      B.dialogs = B.dialogs || [];
      B.dialogs.push({ t: now(), args });
      return shimCfg.dialogPath || "/Users/bench/Livros Oghma";
    }
    if (plugin === "opener") return null;
    return undefined;
  }

  async function invoke(cmd, args = {}, options) {
    const record = { t: now(), cmd };
    if (cmd !== "save_export_file") record.args = args;
    B.invokes.push(record);
    const latency = Number(shimCfg.invokeLatencyMs || 0);
    if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
    else await Promise.resolve();
    if (cmd.startsWith("plugin:")) {
      const value = pluginCommand(cmd, args);
      if (value !== undefined) return value;
    } else if (handlers[cmd]) {
      return handlers[cmd](args, options);
    }
    B.unknown.push({ t: now(), cmd });
    return null;
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback(id, data) {
      const cb = callbacks.get(id);
      if (cb) cb(data);
    },
    callbacks,
    convertFileSrc(filePath, protocol = "asset") {
      return `http://${protocol}.localhost/${encodeURIComponent(filePath)}`;
    },
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" }
    },
    plugins: {}
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, eventId) {
      const list = listeners.get(event) || [];
      listeners.set(event, list.filter((entry) => entry.id !== eventId));
    }
  };
  // Helpers for the harness
  // Later init scripts (e.g. translation-shim.js) can add command handlers and push events.
  B.handlers = handlers;
  B.emit = (event, payload) => {
    for (const entry of listeners.get(event) || []) {
      const cb = callbacks.get(entry.handler);
      if (cb) cb({ event, id: entry.id, payload });
    }
  };
  B.setKindle = (connected) => {
    shimCfg.kindle = Boolean(connected);
  };
  B.setBundleNote = (note) => {
    B.note = note;
  };
})();

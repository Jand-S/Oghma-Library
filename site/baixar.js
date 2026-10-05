// Download buttons: point at the assets of the latest GitHub release and highlight the visitor's
// system. Assets keep stable names (see docs/RELEASE.md), so the links work even if the API call
// fails; the API only fills in the version and greys out a platform that has no build yet.
(() => {
  const REPO = "Jand-S/Oghma-Library";
  const ASSETS = { mac: "Oghma-Library-macOS.dmg", windows: "Oghma-Library-Windows.exe" };
  const latest = (name) => `https://github.com/${REPO}/releases/latest/download/${name}`;
  const ICONS = {
    mac: '<svg viewBox="0 0 24 24"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.8-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8s2 .8 3.4.8c1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9-.1 0-2.6-1-2.6-4.1zM13.9 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.1.1 2.3-.6 3-1.5z"/></svg>',
    windows: '<svg viewBox="0 0 24 24"><path d="M3 5.5 10.4 4.5v7H3zM11.4 4.3 21 3v8.5h-9.6zM3 12.5h7.4v7L3 18.5zM11.4 12.5H21V21l-9.6-1.3z"/></svg>'
  };

  const ua = navigator.userAgent;
  const system = /Windows/i.test(ua) ? "windows" : /Macintosh|Mac OS X/i.test(ua) ? "mac" : null;
  const other = system === "windows" ? "mac" : "windows";
  const label = { mac: "Baixar para Mac", windows: "Baixar para Windows" };

  const primary = document.querySelector("[data-principal]");
  const secondary = document.querySelector("[data-secundario]");
  const set = (link, platform) => {
    if (!link) return;
    link.href = latest(ASSETS[platform]);
    link.dataset.plataforma = platform;
  };

  set(document.querySelector("[data-mac]"), "mac");
  set(document.querySelector("[data-windows]"), "windows");
  if (system) {
    set(primary, system);
    document.querySelector("[data-rotulo-principal]").textContent = label[system];
    document.querySelector("[data-icone-principal]").innerHTML = ICONS[system];
    set(secondary, other);
    secondary.textContent = system === "mac" ? "Também para Windows" : "Também para Mac";
  }

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } })
    .then((response) => (response.ok ? response.json() : null))
    .then((release) => {
      if (!release) return;
      const version = String(release.tag_name || "").replace(/^v/, "");
      const names = new Set((release.assets || []).map((asset) => asset.name));
      if (version) {
        const published = release.published_at
          ? new Date(release.published_at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" })
          : "";
        document.querySelector("[data-versao]").textContent = `versão ${version}${published ? ` · ${published}` : ""}`;
        document.querySelector("[data-meta]").textContent =
          `Versão ${version}${published ? `, de ${published}` : ""} · Grátis · macOS (Apple Silicon) e Windows 10/11`;
      }
      // A platform without a build in this release: button greyed out with "Em breve".
      document.querySelectorAll("[data-plataforma]").forEach((link) => {
        if (names.has(ASSETS[link.dataset.plataforma])) return;
        link.setAttribute("aria-disabled", "true");
        link.removeAttribute("href");
        link.textContent = `${link.dataset.plataforma === "mac" ? "Mac" : "Windows"}: em breve`;
      });
    })
    .catch(() => {});
})();

// In-page probe (Playwright init script). Records:
//  - long tasks (PerformanceObserver 'longtask') -> TBT
//  - first time each configured selector watcher matches (cold-load milestones)
//  - toast/status texts as they appear
// Config: window.__BENCH_CONFIG__.probe = { watchers: [{ name, selector, min?, absent?, after? }], toastSelector? }
(() => {
  const cfg = (window.__BENCH_CONFIG__ && window.__BENCH_CONFIG__.probe) || {};
  const P = (window.__BENCH_PROBE__ = { longtasks: [], marks: {}, toasts: [], errors: [] });

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) P.longtasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch (error) {
    P.errors.push(`longtask unsupported: ${error}`);
  }

  window.addEventListener("error", (event) => P.errors.push(String(event.message || event.error)));
  window.addEventListener("unhandledrejection", (event) => P.errors.push(`unhandledrejection: ${event.reason && (event.reason.message || event.reason)}`));

  const watchers = (cfg.watchers || []).map((w) => ({ ...w, t: null }));
  const toastSelector = cfg.toastSelector || "[role=status], [role=alert]";
  const lastToastText = new WeakMap();

  function check() {
    const t = performance.now();
    let pending = 0;
    for (const w of watchers) {
      if (w.t != null) continue;
      if (w.after && P.marks[w.after] == null) {
        pending += 1;
        continue;
      }
      let ok;
      if (w.absent) ok = !document.querySelector(w.absent);
      else ok = document.querySelectorAll(w.selector).length >= (w.min || 1);
      if (ok) {
        w.t = t;
        P.marks[w.name] = t;
      } else pending += 1;
    }
    for (const node of document.querySelectorAll(toastSelector)) {
      const text = (node.textContent || "").trim();
      if (!text || lastToastText.get(node) === text) continue;
      lastToastText.set(node, text);
      P.toasts.push({ t, text });
    }
    return pending;
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      check();
    });
  });
  const start = () => {
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    check();
  };
  if (document.documentElement) start();
  else document.addEventListener("readystatechange", start, { once: true });

  /**
   * Arms a one-shot waiter: resolves when `predicate` (given as source) returns truthy after the first
   * `eventType` event (captured on window). Returns { t0: event.timeStamp, t1: performance.now(), tPaint }.
   */
  P.arm = (id, { eventType, predicateSource, args, timeoutMs = 15000 }) => {
    const predicate = new Function("args", `return (${predicateSource})(args);`);
    let t0 = null;
    const promise = new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        mo.disconnect();
        window.removeEventListener(eventType, onEvent, true);
        clearTimeout(timer);
        if (value.timeout) return resolve(value);
        requestAnimationFrame(() => {
          value.tPaint = performance.now();
          resolve(value);
        });
      };
      const test = () => {
        if (t0 == null) return;
        let ok = false;
        try {
          ok = predicate(args);
        } catch (error) {
          ok = false;
        }
        if (ok) finish({ t0, t1: performance.now() });
      };
      const onEvent = (event) => {
        if (t0 == null) {
          t0 = event.timeStamp;
          setTimeout(test, 0);
        }
      };
      const mo = new MutationObserver(test);
      mo.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
      window.addEventListener(eventType, onEvent, true);
      const timer = setTimeout(() => finish({ t0, t1: null, timeout: true }), timeoutMs);
    });
    P[`wait_${id}`] = promise;
    return true;
  };
})();

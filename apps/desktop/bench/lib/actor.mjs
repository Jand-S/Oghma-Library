// Interaction counter for usability task paths: every user-visible action goes through here.
export function makeActor(page) {
  const counts = { clicks: 0, keystrokes: 0 };
  const steps = [];
  const describe = (locator) => {
    try {
      return String(locator).replace(/^Locator@/, "").slice(0, 140);
    } catch {
      return "?";
    }
  };
  return {
    counts,
    steps,
    async click(locator, options = {}) {
      await locator.click(options);
      counts.clicks += 1;
      steps.push({ kind: options.button === "right" ? "right-click" : "click", target: describe(locator) });
    },
    async type(locator, text) {
      await locator.pressSequentially(text, { delay: 0 });
      const n = [...text].length;
      counts.keystrokes += n;
      steps.push({ kind: "type", text, keystrokes: n });
    },
    /** Focus a field with one click, then type. */
    async fill(locator, text) {
      await this.click(locator);
      await this.type(locator, text);
    },
    /**
     * Clear a text field the way a user would: select-all (1 key). If the app blocks selection
     * (v1 cancels `selectstart` globally), fall back to End + Backspace per character.
     * Returns { selectAllWorked, extraKeys }.
     */
    async clearField(locator) {
      await this.press("ControlOrMeta+A");
      const state = await locator.evaluate((el) => ({ len: el.value.length, start: el.selectionStart, end: el.selectionEnd }));
      if (state.len === 0 || (state.start === 0 && state.end === state.len)) return { selectAllWorked: true, extraKeys: 0 };
      await this.press("End");
      for (let i = 0; i < state.len; i += 1) await locator.press("Backspace");
      counts.keystrokes += state.len;
      steps.push({ kind: "key", key: `Backspace×${state.len}` });
      return { selectAllWorked: false, extraKeys: state.len + 1 };
    },
    async press(key) {
      await page.keyboard.press(key);
      counts.keystrokes += 1;
      steps.push({ kind: "key", key });
    }
  };
}

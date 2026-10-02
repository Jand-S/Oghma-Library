/**
 * Chapter HTML comes from local EPUBs and from the model's output, so it is never trusted:
 * only a small set of text tags survives, and every attribute is dropped. Everything else is
 * unwrapped (its text kept) or removed with its content (scripts, styles, media, forms).
 */
const ALLOWED = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "em", "i", "strong", "b", "u", "s", "br", "hr",
  "blockquote", "ul", "ol", "li", "sup", "sub", "small", "span", "div", "section", "article"
]);
const DROPPED = new Set([
  "script", "style", "iframe", "object", "embed", "img", "svg", "math", "video", "audio", "source",
  "link", "meta", "form", "input", "button", "textarea", "select", "template", "noscript", "head", "title", "base"
]);

function clean(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? "")];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED.has(tag)) return [];
  const children = Array.from(element.childNodes).flatMap((child) => clean(child, doc));
  if (!ALLOWED.has(tag)) return children;
  const copy = doc.createElement(tag);
  for (const child of children) copy.appendChild(child);
  return [copy];
}

export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return "";
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  for (const node of Array.from(parsed.body.childNodes).flatMap((child) => clean(child, out))) container.appendChild(node);
  return container.innerHTML;
}

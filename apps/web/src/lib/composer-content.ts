import { EDITOR_SIGNATURE_SELECTOR } from "./editor-content";

export interface MessageFormat { fontFamily: string; fontSize: number; color: string; lineHeight: number }
export const fallbackMessageFormat: MessageFormat = { fontFamily: "Arial", fontSize: 12, color: "#172033", lineHeight: 1.5 };
export function safeLink(value: string): string | null {
  const input = value.trim();
  const normalized = /^www\./i.test(input) ? `https://${input}` : input;
  if (/[\u0000-\u0020<>]/.test(normalized)) return null;
  try { const url = new URL(normalized); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null; } catch { return null; }
}
export function escapeMessageText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
export function plainMessageHtml(text: string) {
  return escapeMessageText(text).replace(/\r\n?/g, "\n").replace(/\n/g, "<br>");
}
function linkify(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("a,pre,code")) continue;
    const pattern = /(?:https?:\/\/|www\.)[^\s<>]+/gi;
    const value = node.data;
    const fragment = document.createDocumentFragment();
    let end = 0;
    for (const match of value.matchAll(pattern)) {
      const label = match[0].replace(/[.,;!?)]+$/, "");
      const url = safeLink(label);
      if (!url) continue;
      fragment.append(value.slice(end, match.index));
      const anchor = document.createElement("a"); anchor.href = url; anchor.textContent = label;
      fragment.append(anchor); end = (match.index ?? 0) + label.length;
    }
    if (end) { fragment.append(value.slice(end)); node.replaceWith(fragment); }
  }
}
const tags = new Set("DIV P SPAN BR B STRONG I EM U S STRIKE UL OL LI BLOCKQUOTE PRE CODE TABLE THEAD TBODY TFOOT TR TD TH A HR H1 H2 H3 H4 H5 H6".split(" "));
const safeStyle = new Set(["color", "background-color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-align", "line-height", "border", "border-color", "border-style", "border-width", "border-collapse", "padding", "padding-left", "padding-right", "width", "max-width"]);
/** Clipboard HTML is filtered before insertion; the server remains the authoritative sanitizer. */
export function normalizeClipboard(html: string, text: string, mode: "adapt" | "keep" | "text") {
  const root = document.createElement("div");
  if (mode === "text" || !html) { root.innerHTML = plainMessageHtml(text); if (mode !== "text") linkify(root); return root.innerHTML; }
  // Detached parsing avoids loading remote clipboard images or stylesheets.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script,style,link,meta,iframe,object,embed,svg,math,form,input,button,textarea,select,template").forEach(node => node.remove());
  for (const node of Array.from(parsed.body.querySelectorAll("*"))) {
    if (node.tagName === "IMG") { node.replaceWith(parsed.createTextNode(node.getAttribute("alt") || "")); continue; }
    if (!tags.has(node.tagName)) { node.replaceWith(...Array.from(node.childNodes)); continue; }
    const element = node as HTMLElement;
    const href = node.tagName === "A" ? safeLink(node.getAttribute("href") || "") : null;
    const styles = mode === "keep" ? Array.from(element.style).filter(key => safeStyle.has(key)).map(key => [key, element.style.getPropertyValue(key)]) : [];
    const spans = ["colspan", "rowspan"].map(key => [key, node.getAttribute(key)]);
    for (const attr of Array.from(node.attributes)) node.removeAttribute(attr.name);
    if (href) { node.setAttribute("href", href); node.setAttribute("rel", "noopener noreferrer"); }
    for (const [key, value] of styles) if (!/url\s*\(|expression|var\s*\(/i.test(value)) element.style.setProperty(key, value);
    if (["TD", "TH"].includes(node.tagName)) for (const [key, value] of spans) if (value && /^\d{1,2}$/.test(value)) node.setAttribute(key!, value);
  }
  root.innerHTML = parsed.body.innerHTML;
  linkify(root);
  return root.innerHTML;
}
/** Put defaults in the actual message HTML, while leaving the signature's own layout intact. */
export function serializeComposer(editor: HTMLElement, format: MessageFormat) {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".ai-inline-suggestion").forEach(node => node.remove());
  clone.querySelectorAll("font").forEach(node => {
    if (node.closest(EDITOR_SIGNATURE_SELECTOR)) return;
    const span = document.createElement("span");
    span.style.cssText = (node as HTMLElement).style.cssText;
    if (node.getAttribute("face")) span.style.fontFamily = node.getAttribute("face")!;
    if (node.getAttribute("color")) span.style.color = node.getAttribute("color")!;
    while (node.firstChild) span.append(node.firstChild);
    node.replaceWith(span);
  });
  const wrapper = document.createElement("div");
  Object.assign(wrapper.style, { fontFamily: format.fontFamily, fontSize: `${format.fontSize}px`, color: format.color, lineHeight: String(format.lineHeight) });
  while (clone.firstChild && !(clone.firstChild instanceof Element && clone.firstChild.matches(EDITOR_SIGNATURE_SELECTOR))) wrapper.append(clone.firstChild);
  clone.prepend(wrapper);
  return clone.innerHTML;
}
/** Freeze links/images as immutable placeholders so rewriting cannot silently lose destinations. */
export function prepareWritingInput(container: HTMLElement) {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`${EDITOR_SIGNATURE_SELECTOR},.ai-inline-suggestion`).forEach(node => node.remove());
  const protectedContent: Array<{ token: string; html: string }> = [];
  clone.querySelectorAll("a[href],img").forEach(node => {
    const token = `[[AVIDITY_CONTENT_${protectedContent.length + 1}]]`;
    protectedContent.push({ token, html: node.outerHTML }); node.replaceWith(document.createTextNode(token));
  });
  clone.querySelectorAll("br").forEach(node => node.replaceWith(document.createTextNode("\n")));
  clone.querySelectorAll("p,div,li,tr,blockquote,h1,h2,h3").forEach(node => node.append(document.createTextNode("\n")));
  return { text: clone.textContent?.trim() || "", protectedContent };
}
export function restoreWritingHtml(text: string, content: Array<{ token: string; html: string }>) {
  let html = plainMessageHtml(text);
  for (const item of content) {
    if (text.split(item.token).length !== 2) throw new Error("The suggestion changed a protected link or image. Your draft has been kept; please try again.");
    html = html.replace(item.token, item.html);
  }
  if (/\[\[AVIDITY_CONTENT_\d+\]\]/.test(html)) throw new Error("The suggestion contains an unrecognized content marker.");
  return html;
}

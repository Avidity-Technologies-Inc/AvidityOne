export const INLINE_AUTOCOMPLETE_CLASS = "ai-inline-suggestion";
export const EDITOR_SIGNATURE_SELECTOR = "[data-editor-signature]";
export const EDITOR_DRAFT_SELECTOR = "[data-editor-draft]";

const EMPTY_DRAFT_HTML = '<div data-editor-draft="true"><br /></div>';

export function normalizeEditorText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function htmlToEditorText(html: string) {
  const container = document.createElement("div");
  container.innerHTML = html;
  return normalizeEditorText(container.innerText);
}

export function textToEditorHtml(value: string) {
  return escapeHtml(value).replace(/\n/g, "<br />");
}

export function composeEditorHtml(draft: string, signatureHtml: string) {
  const normalizedDraft = draft.trim();
  const signature = signatureHtml.trim();
  const draftHtml = textToEditorHtml(normalizedDraft);
  if (!signature) return draftHtml;
  const protectedSignature = `<div data-editor-signature="true" contenteditable="false">${signature}</div>`;
  return normalizedDraft ? `${draftHtml}<br /><br />${protectedSignature}` : `${EMPTY_DRAFT_HTML}${protectedSignature}`;
}

export function markLegacySignature(editor: HTMLElement, signatureHtml: string) {
  if (editor.querySelector(EDITOR_SIGNATURE_SELECTOR)) {
    ensureEditableDraftBeforeSignature(editor);
    return;
  }
  const signature = signatureHtml.trim();
  if (!signature || !editor.innerHTML.trim().endsWith(signature)) return;
  const draftHtml = editor.innerHTML.trim().slice(0, -signature.length).replace(/(?:<br\s*\/?>(?:\s|&nbsp;)*){1,2}$/i, "");
  editor.innerHTML = `${draftHtml}${draftHtml ? "<br /><br />" : ""}<div data-editor-signature="true" contenteditable="false">${signature}</div>`;
  ensureEditableDraftBeforeSignature(editor);
}

export function setEditorSignature(editor: HTMLElement, signatureHtml: string) {
  editor.querySelectorAll(EDITOR_SIGNATURE_SELECTOR).forEach((node) => {
    let previous = node.previousSibling;
    let removedBreaks = 0;
    while (previous instanceof HTMLBRElement && removedBreaks < 2) {
      const current = previous;
      previous = current.previousSibling;
      current.remove();
      removedBreaks += 1;
    }
    node.remove();
  });
  const signature = signatureHtml.trim();
  if (!signature) return;
  const hasDraft = Boolean(getEditorText(editor, false));
  editor.insertAdjacentHTML(
    "beforeend",
    `${hasDraft ? "<br /><br />" : ""}<div data-editor-signature="true" contenteditable="false">${signature}</div>`
  );
  ensureEditableDraftBeforeSignature(editor);
}

export function ensureEditableDraftBeforeSignature(editor: HTMLElement) {
  const signature = editor.querySelector(EDITOR_SIGNATURE_SELECTOR);
  if (!signature || signature.previousSibling) return;
  signature.insertAdjacentHTML("beforebegin", EMPTY_DRAFT_HTML);
}

export function getEditorText(editor: HTMLElement, includeSignature = true) {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(`.${INLINE_AUTOCOMPLETE_CLASS}`).forEach((node) => node.remove());
  if (!includeSignature) clone.querySelectorAll(EDITOR_SIGNATURE_SELECTOR).forEach((node) => node.remove());
  return clone.innerText.trim();
}

export function getEditorTextWithoutSignature(editor: HTMLElement, legacySignatureText = "") {
  const markedDraft = getEditorText(editor, false);
  if (editor.querySelector(EDITOR_SIGNATURE_SELECTOR)) return markedDraft;
  return stripLegacySignature(markedDraft, legacySignatureText);
}

export function stripLegacySignature(value: string, signatureText: string) {
  const text = value.trim();
  const normalizedSignature = normalizeEditorText(signatureText);
  if (!normalizedSignature || !normalizeEditorText(text).endsWith(normalizedSignature)) return text;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (normalizeEditorText(lines.slice(index).join("\n")) === normalizedSignature) {
      return lines.slice(0, index).join("\n").trim();
    }
  }
  return normalizeEditorText(text) === normalizedSignature ? "" : text;
}

export function selectionIntersectsSignature(editor: HTMLElement, selection: Selection | null) {
  const signature = editor.querySelector(EDITOR_SIGNATURE_SELECTOR);
  if (!signature || !selection?.rangeCount) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return false;
  try {
    return range.intersectsNode(signature);
  } catch {
    return false;
  }
}

export function isSelectionAtOrAfterSignature(editor: HTMLElement, selection: Selection | null) {
  const signature = editor.querySelector(EDITOR_SIGNATURE_SELECTOR);
  if (!signature || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return false;
  if (signature.contains(selection.anchorNode)) return true;
  const caret = selection.getRangeAt(0).cloneRange();
  caret.collapse(true);
  const signatureRange = document.createRange();
  signatureRange.selectNode(signature);
  return caret.compareBoundaryPoints(Range.START_TO_END, signatureRange) >= 0;
}

export function captureEditorSelection(editor: HTMLElement, selection: Selection | null) {
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) return null;
  return range.cloneRange();
}

export function replaceEditorRangeWithText(editor: HTMLElement, range: Range, value: string) {
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return false;
  const fragment = document.createDocumentFragment();
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((line, index) => {
    if (index > 0) fragment.append(document.createElement("br"));
    fragment.append(document.createTextNode(line));
  });
  range.deleteContents();
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  return true;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

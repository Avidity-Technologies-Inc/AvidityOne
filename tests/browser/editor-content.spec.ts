import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ts from "typescript";

test.beforeEach(async ({ page }) => {
  const source = await fs.readFile(path.resolve("apps/web/src/lib/editor-content.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  await page.setContent('<div id="editor" contenteditable="true"></div>');
  await page.addScriptTag({ content: `const exports = {}; ${compiled}; window.EditorContent = exports;` });
});

test("keeps the signature outside the editable AI draft", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = api.composeEditorHtml("Please review teh issue.", "<p>Support Team<br>support@example.com</p>");
    return {
      draft: api.getEditorTextWithoutSignature(editor),
      complete: api.getEditorText(editor),
      protectedSignature: Boolean(editor.querySelector('[data-editor-signature][contenteditable="false"]'))
    };
  });

  expect(result.draft).toBe("Please review teh issue.");
  expect(result.complete).toContain("Support Team");
  expect(result.protectedSignature).toBe(true);
});

test("keeps an empty signed composer writable before the protected signature", async ({ page }) => {
  await page.addStyleTag({ content: '[data-editor-draft] { display: block; min-height: 64px; }' });
  await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = api.composeEditorHtml("", "<p>Support Team</p>");
  });

  await page.locator('[data-editor-draft]').click();
  await page.keyboard.type("Hello customer");

  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    return {
      draft: api.getEditorTextWithoutSignature(editor),
      signature: editor.querySelector('[data-editor-signature]')?.textContent,
      signatureProtected: editor.querySelector('[data-editor-signature]')?.getAttribute("contenteditable")
    };
  });

  expect(result.draft).toBe("Hello customer");
  expect(result.signature).toBe("Support Team");
  expect(result.signatureProtected).toBe("false");
});

test("repairs a stored signature-only draft with an editable area", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = '<div data-editor-signature="true" contenteditable="false"><p>Support Team</p></div>';
    api.markLegacySignature(editor, "<p>Support Team</p>");
    return {
      draftExists: Boolean(editor.querySelector(api.EDITOR_DRAFT_SELECTOR)),
      draftBeforeSignature: editor.firstElementChild?.matches(api.EDITOR_DRAFT_SELECTOR),
      signatureCount: editor.querySelectorAll(api.EDITOR_SIGNATURE_SELECTOR).length
    };
  });

  expect(result.draftExists).toBe(true);
  expect(result.draftBeforeSignature).toBe(true);
  expect(result.signatureCount).toBe(1);
});

test("adds an editable area when enabling a signature in an empty composer", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    api.setEditorSignature(editor, "<p>Support Team</p>");
    return {
      draftBeforeSignature: editor.firstElementChild?.matches(api.EDITOR_DRAFT_SELECTOR),
      signatureProtected: editor.querySelector(api.EDITOR_SIGNATURE_SELECTOR)?.getAttribute("contenteditable")
    };
  });

  expect(result.draftBeforeSignature).toBe(true);
  expect(result.signatureProtected).toBe("false");
});

test("replaces a captured selection without modifying the protected signature", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = api.composeEditorHtml("Please fix teh sentence.", "<p>Support Team</p>");
    const textNode = editor.firstChild!;
    const text = textNode.textContent ?? "";
    const start = text.indexOf("teh");
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 3);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const captured = api.captureEditorSelection(editor, selection)!;
    const signatureWasSelected = api.selectionIntersectsSignature(editor, selection);
    const replaced = api.replaceEditorRangeWithText(editor, captured, "the");
    return {
      draft: api.getEditorTextWithoutSignature(editor),
      signature: editor.querySelector('[data-editor-signature]')?.textContent,
      signatureWasSelected,
      replaced
    };
  });

  expect(result.replaced).toBe(true);
  expect(result.signatureWasSelected).toBe(false);
  expect(result.draft).toBe("Please fix the sentence.");
  expect(result.signature).toBe("Support Team");
});

test("allows a draft selection whose boundary only touches the signature", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = '<div data-editor-draft="true">Draft with teh typo.</div><div data-editor-signature="true" contenteditable="false"><p>Support Team</p></div>';
    const draft = editor.querySelector<HTMLElement>(api.EDITOR_DRAFT_SELECTOR)!;
    const draftText = draft.firstChild!;
    const signature = editor.querySelector<HTMLElement>(api.EDITOR_SIGNATURE_SELECTOR)!;
    const signatureText = signature.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.setStart(draftText, 0);
    range.setEnd(signatureText, 0);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const includesSignature = api.selectionIntersectsSignature(editor, selection);
    const captured = api.captureEditorSelection(editor, selection)!;
    const replaced = api.replaceEditorRangeWithText(editor, captured, "Draft with the typo.");
    return {
      includesSignature,
      replaced,
      draft: draft.textContent,
      signature: signature.textContent,
      signatureProtected: signature.getAttribute("contenteditable")
    };
  });

  expect(result.includesSignature).toBe(false);
  expect(result.replaced).toBe(true);
  expect(result.draft).toBe("Draft with the typo.");
  expect(result.signature).toBe("Support Team");
  expect(result.signatureProtected).toBe("false");
});

test("rejects a selection containing actual signature text", async ({ page }) => {
  const includesSignature = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = '<div data-editor-draft="true">Draft text</div><div data-editor-signature="true" contenteditable="false"><p>Support Team</p></div>';
    const draft = editor.querySelector<HTMLElement>(api.EDITOR_DRAFT_SELECTOR)!;
    const signature = editor.querySelector<HTMLElement>(api.EDITOR_SIGNATURE_SELECTOR)!;
    const range = document.createRange();
    range.setStart(draft.firstChild!, 0);
    range.setEnd(signature.querySelector("p")!.firstChild!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return api.selectionIntersectsSignature(editor, selection);
  });

  expect(includesSignature).toBe(true);
});

test("detects a caret at or after the protected signature", async ({ page }) => {
  const result = await page.evaluate(() => {
    const api = (window as unknown as { EditorContent: typeof import("../../apps/web/src/lib/editor-content") }).EditorContent;
    const editor = document.querySelector<HTMLElement>("#editor")!;
    editor.innerHTML = api.composeEditorHtml("Draft text", "<p>Support Team</p>");
    const signature = editor.querySelector('[data-editor-signature]')!;
    const selection = window.getSelection()!;
    const before = document.createRange();
    before.setStart(editor.firstChild!, 0);
    before.collapse(true);
    selection.removeAllRanges();
    selection.addRange(before);
    const beforeSignature = api.isSelectionAtOrAfterSignature(editor, selection);
    const after = document.createRange();
    after.setStartAfter(signature);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
    return {
      beforeSignature,
      afterSignature: api.isSelectionAtOrAfterSignature(editor, selection)
    };
  });

  expect(result.beforeSignature).toBe(false);
  expect(result.afterSignature).toBe(true);
});

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

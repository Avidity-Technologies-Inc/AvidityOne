"use client";

import {
  Bold,
  Code,
  ChevronDown,
  Eye,
  Wand2,
  Italic,
  Link,
  List,
  ListOrdered,
  Paperclip,
  Quote,
  RemoveFormatting,
  Send,
  Strikethrough,
  Underline,
  Undo2, Redo2, AlignLeft, AlignCenter, AlignRight, SlidersHorizontal
} from "lucide-react";
import { ClipboardEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import {
  EDITOR_SIGNATURE_SELECTOR,
  INLINE_AUTOCOMPLETE_CLASS,
  captureEditorSelection,
  composeEditorHtml,
  getEditorText as readEditorText,
  getEditorTextWithoutSignature as readEditorTextWithoutSignature,
  htmlToEditorText,
  isSelectionAtOrAfterSignature,
  markLegacySignature,
  normalizeEditorText,
  replaceEditorRangeWithText,
  selectionIntersectsSignature,
  setEditorSignature,
  stripLegacySignature
} from "@/lib/editor-content";
import { useComposerPreferences } from "../composer/useComposerPreferences";
import { fallbackMessageFormat, normalizeClipboard, safeLink, escapeMessageText, serializeComposer, prepareWritingInput, restoreWritingHtml } from "@/lib/composer-content";
import { AttachmentDropzone } from "./AttachmentDropzone";
import { AttachmentPreviewItem, AttachmentPreviewList } from "./AttachmentPreviewList";
import { SignatureInserter } from "./SignatureInserter";

const toolbar = [
  { label: "Bold", icon: Bold, command: "bold" },
  { label: "Italic", icon: Italic, command: "italic" },
  { label: "Underline", icon: Underline, command: "underline" },
  { label: "Strikethrough", icon: Strikethrough, command: "strikeThrough" },
  { label: "Ordered list", icon: ListOrdered, command: "insertOrderedList" },
  { label: "Unordered list", icon: List, command: "insertUnorderedList" },
  { label: "Quote", icon: Quote, command: "formatBlock", value: "blockquote" },
  { label: "Inline code", icon: Code, command: "formatBlock", value: "pre" },
  { label: "Remove formatting", icon: RemoveFormatting, command: "removeFormat" }
] as const;

const AUTOCOMPLETE_MIN_CHARS = 12;
const AUTOCOMPLETE_DELAY_MS = 450;

type ComposerAction = "send" | "send_and_close" | "save_note" | "send_note" | "send_note_and_close";

interface UserSignature {
  htmlSignature: string;
  useSignatureByDefault: boolean;
}

interface TicketReplyEditorProps {
  ticketId?: string;
  ccUsers?: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  ccContacts?: Array<{ id: string; firstName: string; lastName: string; email: string }>;
  conversationParticipants?: Array<{ id: string; email: string; userId: string | null }>;
  insertRequest?: { id: number; text: string } | null;
  onSaved?: () => void | Promise<void>;
}

export function TicketReplyEditor({ ticketId, ccUsers = [], ccContacts = [], conversationParticipants = [], insertRequest, onSaved }: TicketReplyEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const preferences = useComposerPreferences();
  const format = preferences.data?.effective ?? fallbackMessageFormat;
  const savedSelection = useRef<Range | null>(null);
  const pendingFontSize = useRef<string | null>(null);
  const plainPasteOnce = useRef(false);
  const [expandedTools, setExpandedTools] = useState(false);
  const [linkEditor, setLinkEditor] = useState<{ text: string; url: string; anchor: HTMLAnchorElement | null } | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<{ html: string; before: string; range: Range | null } | null>(null);
  const [aiUndo, setAiUndo] = useState<{ before: string; after: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const extrasRef = useRef<HTMLDetailsElement>(null);
  const draftRestoredRef = useRef(false);
  const autocompleteRequestRef = useRef(0);
  const signatureHtmlRef = useRef("");
  const signatureTextRef = useRef("");
  const [mode, setMode] = useState<"public" | "internal">("public");
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreviewItem[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccUserIds, setCcUserIds] = useState<string[]>([]);
  const [persistCc, setPersistCc] = useState(true);
  const [includePersistentCc, setIncludePersistentCc] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [draftRevision, setDraftRevision] = useState(0);
  const [autocompleteSuggestion, setAutocompleteSuggestion] = useState("");
  const [autocompleteDismissedFor, setAutocompleteDismissedFor] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ticketId || !editorRef.current) return;
    try {
      const stored = window.localStorage.getItem(`ticket-reply-draft:${ticketId}`);
      if (stored) {
        const draft = JSON.parse(stored) as { html?: string; mode?: "public" | "internal"; ccEmails?: string[]; ccUserIds?: string[]; persistCc?: boolean; includePersistentCc?: boolean; followCcUsers?: boolean };
        editorRef.current.innerHTML = draft.html ?? "";
        setDraftText(htmlToEditorText(draft.html ?? ""));
        setMode(draft.mode === "internal" ? "internal" : "public");
        setCcEmails(Array.isArray(draft.ccEmails) ? draft.ccEmails : []);
        setCcUserIds(Array.isArray(draft.ccUserIds) ? draft.ccUserIds : []);
        setPersistCc(draft.persistCc ?? draft.followCcUsers ?? true);
        setIncludePersistentCc(draft.includePersistentCc ?? true);
      }
    } catch {
      window.localStorage.removeItem(`ticket-reply-draft:${ticketId}`);
    } finally {
      draftRestoredRef.current = true;
    }
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId || !draftRestoredRef.current) return;
    const stored = window.localStorage.getItem(`ticket-reply-draft:${ticketId}`);
    if (stored) return;
    setCcUserIds(conversationParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []));
    setCcEmails(conversationParticipants.filter((participant) => !participant.userId).map((participant) => participant.email));
  }, [conversationParticipants, ticketId]);

  useEffect(() => {
    if (!ticketId || !draftRestoredRef.current || !editorRef.current) return;
    const clone = editorRef.current.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(`.${INLINE_AUTOCOMPLETE_CLASS}`).forEach((node) => node.remove());
    const html = clone.innerHTML;
    const persistentEmails = conversationParticipants.filter((participant) => !participant.userId).map((participant) => participant.email).sort();
    const persistentUserIds = conversationParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []).sort();
    const ccChanged = !includePersistentCc
      || [...ccEmails].sort().join("|") !== persistentEmails.join("|")
      || [...ccUserIds].sort().join("|") !== persistentUserIds.join("|");
    const hasDraft = Boolean(readEditorTextWithoutSignature(clone, signatureTextRef.current) || ccChanged || mode === "internal");
    if (!hasDraft) {
      window.localStorage.removeItem(`ticket-reply-draft:${ticketId}`);
      return;
    }
    window.localStorage.setItem(`ticket-reply-draft:${ticketId}`, JSON.stringify({ html, mode, ccEmails, ccUserIds, persistCc, includePersistentCc }));
  }, [ccEmails, ccUserIds, conversationParticipants, draftText, draftRevision, includePersistentCc, persistCc, mode, ticketId]);

  useEffect(() => {
    let mounted = true;
    apiFetch<UserSignature>("/profile/signature")
      .then((signature) => {
        if (!mounted || !signature.htmlSignature.trim() || !editorRef.current) {
          return;
        }
        signatureHtmlRef.current = signature.htmlSignature;
        signatureTextRef.current = htmlToEditorText(signature.htmlSignature);
        markLegacySignature(editorRef.current, signature.htmlSignature);
        if (!signature.useSignatureByDefault) {
          return;
        }
        if (!editorRef.current.innerText.trim() && !editorRef.current.innerHTML.trim()) {
          editorRef.current.innerHTML = composeEditorHtml("", signature.htmlSignature);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!insertRequest || !editorRef.current) return;
    if (getEditorTextWithoutSignature() && !window.confirm("Replace the current reply draft with the AI suggestion?")) return;

    clearWritingSuggestions();
    editorRef.current.innerHTML = composeEditorHtml(insertRequest.text, signatureHtmlRef.current);
    setDraftText(getEditorText()); setDraftRevision(value => value + 1);
    editorRef.current.focus();
  // The request id intentionally drives each explicit insertion action.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest?.id]);

  useEffect(() => {
    if (!ticketId || preview || aiBusy || aiSuggestion || saving) {
      return;
    }

    const draft = getAutocompleteDraft();
    if (draft.length < AUTOCOMPLETE_MIN_CHARS || draft === autocompleteDismissedFor) {
      return;
    }

    const requestId = autocompleteRequestRef.current + 1;
    const timeout = window.setTimeout(() => {
      autocompleteRequestRef.current = requestId;
      apiFetch<{ text: string }>(`/tickets/${ticketId}/ai/complete-draft`, {
        method: "POST",
        body: JSON.stringify({ draft: draft.slice(-900) })
      })
        .then((result) => {
          if (autocompleteRequestRef.current !== requestId) {
            return;
          }
          const suggestion = result.text.trim();
          if (suggestion && !draft.endsWith(suggestion)) {
            setAutocompleteSuggestion(showInlineAutocomplete(suggestion) ? suggestion : "");
          } else {
            setAutocompleteSuggestion("");
          }
        })
        .catch(() => setAutocompleteSuggestion(""));
    }, AUTOCOMPLETE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [aiBusy, aiSuggestion, autocompleteDismissedFor, draftText, preview, saving, ticketId]);

  useEffect(() => {
    const remember = () => {
      const editor = editorRef.current;
      if (editor) {
        const range = captureEditorSelection(editor, window.getSelection());
        if (range && !selectionIntersectsSignature(editor, window.getSelection())) savedSelection.current = range;
      }
    };
    document.addEventListener("selectionchange", remember);
    return () => document.removeEventListener("selectionchange", remember);
  }, []);

  function restoreSelection() {
    const editor = editorRef.current;
    if (!editor || preview || saving) return false;
    if (selectionIntersectsSignature(editor, window.getSelection())) { setError("Select only the message text above the signature to format it."); return false; }
    editor.focus();
    const selection = window.getSelection();
    const range = savedSelection.current;
    if (range && editor.contains(range.commonAncestorContainer)) {
      selection?.removeAllRanges(); selection?.addRange(range);
    } else {
      const next = document.createRange();
      const signature = editor.querySelector(EDITOR_SIGNATURE_SELECTOR);
      next.selectNodeContents(editor);
      if (signature) { next.setEndBefore(signature); next.collapse(false); } else next.collapse(false);
      selection?.removeAllRanges(); selection?.addRange(next);
    }
    return !selectionIntersectsSignature(editor, selection);
  }

  function runCommand(command: string, value?: string) {
    removeInlineAutocomplete(); setAutocompleteSuggestion("");
    if (!restoreSelection()) return;
    if (command === "removeFormat") {
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (range && !range.collapsed) {
        const content = document.createElement("div"); content.append(range.cloneContents());
        document.execCommand("insertHTML", false, normalizeClipboard(content.innerHTML, content.textContent || "", "adapt"));
      }
      document.execCommand("removeFormat", false);
    } else {
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, value);
    }
    savedSelection.current = captureEditorSelection(editorRef.current!, window.getSelection());
    setDraftText(getEditorText()); setDraftRevision(value => value + 1);
  }

  function normalizeFontSizes() {
    if (!pendingFontSize.current) return;
    editorRef.current?.querySelectorAll('font[size="7"]').forEach(node => {
      if (node.closest(EDITOR_SIGNATURE_SELECTOR)) return;
      (node as HTMLElement).style.fontSize = `${pendingFontSize.current}px`;
      node.removeAttribute("size");
    });
  }

  function applyFontSize(size: string) {
    if (!restoreSelection()) return;
    pendingFontSize.current = size;
    // Keep native edit nodes intact for undo; serialization converts legacy font tags to spans.
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand("fontSize", false, "7");
    normalizeFontSizes();
    document.execCommand("styleWithCSS", false, "true");
    savedSelection.current = captureEditorSelection(editorRef.current!, window.getSelection());
    setDraftText(getEditorText()); setDraftRevision(value => value + 1);
  }

  function openLinkEditor() {
    if (!restoreSelection()) return;
    const selection = window.getSelection();
    savedSelection.current = captureEditorSelection(editorRef.current!, selection);
    const element = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
    const anchor = element?.closest("a") as HTMLAnchorElement | null;
    setLinkEditor({ text: anchor?.textContent || selection?.toString() || "", url: anchor?.getAttribute("href") || "", anchor });
  }

  function applyLink(remove = false) {
    if (!linkEditor || !restoreSelection()) return;
    const url = remove ? null : safeLink(linkEditor.url);
    if (!remove && !url) { setError("Enter a valid https://, http:// or mailto: link."); return; }
    if (linkEditor.anchor && editorRef.current?.contains(linkEditor.anchor)) {
      const range = document.createRange(); range.selectNodeContents(linkEditor.anchor);
      window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    }
    document.execCommand("unlink", false);
    const text = linkEditor.text || linkEditor.url;
    document.execCommand("insertHTML", false, remove ? escapeMessageText(text) : `<a href="${escapeMessageText(url!)}" rel="noopener noreferrer">${escapeMessageText(text)}</a>`);
    setLinkEditor(null); setError(null); setDraftText(getEditorText()); setDraftRevision(value => value + 1);
  }

  function getEditorText() {
    const editor = editorRef.current;
    return editor ? readEditorText(editor) : "";
  }

  function getEditorTextWithoutSignature() {
    return editorRef.current ? readEditorTextWithoutSignature(editorRef.current, signatureTextRef.current) : "";
  }

  function stripSignatureFromText(value: string) {
    return stripLegacySignature(value, signatureTextRef.current);
  }

  function getTextBeforeCursor() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    if (!editor || !selection || !anchorNode || selection.rangeCount === 0 || !selection.isCollapsed || !editor.contains(anchorNode)) {
      return "";
    }

    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(anchorNode, selection.anchorOffset);
    const fragment = range.cloneContents();
    const container = document.createElement("div");
    container.appendChild(fragment);
    container.querySelectorAll(`.${INLINE_AUTOCOMPLETE_CLASS}`).forEach((node) => node.remove());
    container.querySelectorAll(EDITOR_SIGNATURE_SELECTOR).forEach((node) => node.remove());
    const text = container.innerText.trimStart();
    const rawText = container.textContent ?? "";
    return /\s$/.test(rawText) && !/\s$/.test(text) ? `${text} ` : text;
  }

  function getTextAfterCursor() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode ?? null;
    if (!editor || !selection || !anchorNode || selection.rangeCount === 0 || !selection.isCollapsed || !editor.contains(anchorNode)) {
      return "";
    }

    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setStart(anchorNode, selection.anchorOffset);
    const fragment = range.cloneContents();
    const container = document.createElement("div");
    container.appendChild(fragment);
    container.querySelectorAll(`.${INLINE_AUTOCOMPLETE_CLASS}`).forEach((node) => node.remove());
    container.querySelectorAll(EDITOR_SIGNATURE_SELECTOR).forEach((node) => node.remove());
    return container.innerText.trim();
  }

  function getAutocompleteDraft() {
    if (!isCursorAtAutocompleteBoundary() || isCursorAfterSignature()) {
      return "";
    }
    return stripSignatureFromText(getTextBeforeCursor());
  }

  function handleEditorInput() {
    normalizeFontSizes();
    autocompleteRequestRef.current += 1;
    removeInlineAutocomplete();
    setDraftText(getEditorText()); setDraftRevision(value => value + 1);
    setAutocompleteSuggestion("");
  }

  function getInlineAutocompleteNode() {
    return editorRef.current?.querySelector(`.${INLINE_AUTOCOMPLETE_CLASS}`) ?? null;
  }

  function removeInlineAutocomplete() {
    getInlineAutocompleteNode()?.remove();
  }

  function clearAutocomplete() {
    autocompleteRequestRef.current += 1;
    removeInlineAutocomplete();
    setAutocompleteSuggestion("");
  }

  function clearWritingSuggestions() {
    clearAutocomplete();
  }

  function isCursorAtAutocompleteBoundary() {
    const textAfterCursor = normalizeEditorText(getTextAfterCursor());
    return !textAfterCursor || Boolean(signatureTextRef.current && textAfterCursor === signatureTextRef.current);
  }

  function isCursorAfterSignature() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (editor?.querySelector(EDITOR_SIGNATURE_SELECTOR)) return isSelectionAtOrAfterSignature(editor, selection);

    const signatureText = signatureTextRef.current;
    if (!signatureText) {
      return false;
    }

    const textBeforeCursor = normalizeEditorText(getTextBeforeCursor());
    const textAfterCursor = normalizeEditorText(getTextAfterCursor());
    return !textAfterCursor && textBeforeCursor.endsWith(normalizeEditorText(signatureText));
  }

  function canInsertInlineAutocomplete() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !editorRef.current?.contains(selection.anchorNode)) {
      return false;
    }

    const anchorElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    if (!anchorElement) {
      return false;
    }

    return isCursorAtAutocompleteBoundary() && !isCursorAfterSignature() && !anchorElement.closest("a, table, img, pre, blockquote");
  }

  function showInlineAutocomplete(rawSuggestion: string) {
    const suggestion = rawSuggestion.trim();
    if (!suggestion || !editorRef.current || !canInsertInlineAutocomplete()) {
      return false;
    }

    removeInlineAutocomplete();

    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range) {
      return false;
    }

    const currentText = getTextBeforeCursor();
    const prefix = currentText && !/\s$/.test(currentText) && !/^[\s.,;:!?)]/.test(suggestion) ? " " : "";
    const node = document.createElement("span");
    node.className = INLINE_AUTOCOMPLETE_CLASS;
    node.contentEditable = "false";
    node.textContent = `${prefix}${suggestion}`;
    node.setAttribute("aria-hidden", "true");
    try {
      range.insertNode(node);
      range.setStartBefore(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    } catch {
      node.remove();
      return false;
    }
  }

  function acceptAutocompleteSuggestion() {
    const node = getInlineAutocompleteNode();
    if ((!autocompleteSuggestion && !node) || !editorRef.current) {
      return;
    }

    const acceptedText = normalizeAcceptedAutocomplete(node?.textContent ?? autocompleteSuggestion);
    const range = document.createRange();
    if (node) {
      range.setStartBefore(node);
      range.collapse(true);
      node.remove();
    } else {
      const savedRange = captureEditorSelection(editorRef.current, window.getSelection());
      if (!savedRange) return;
      range.setStart(savedRange.startContainer, savedRange.startOffset);
      range.collapse(true);
    }
    editorRef.current.focus();
    replaceEditorRangeWithText(editorRef.current, range, acceptedText);
    setAutocompleteSuggestion("");
    setDraftText(getEditorText()); setDraftRevision(value => value + 1);
  }

  function dismissAutocompleteSuggestion() {
    removeInlineAutocomplete();
    setAutocompleteDismissedFor(getEditorText());
    setAutocompleteSuggestion("");
  }

  function normalizeAcceptedAutocomplete(value: string) {
    const currentText = getTextBeforeCursor();
    if (/\s$/.test(currentText)) {
      return value.replace(/^\s+/, "");
    }
    return value;
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    plainPasteOnce.current = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v";
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); openLinkEditor(); return; }
    const hasInlineSuggestion = Boolean(getInlineAutocompleteNode());
    if (event.key === "Tab" && (autocompleteSuggestion || hasInlineSuggestion)) {
      event.preventDefault();
      acceptAutocompleteSuggestion();
    }
    if (event.key === "Escape" && (autocompleteSuggestion || hasInlineSuggestion)) {
      event.preventDefault();
      dismissAutocompleteSuggestion();
    }
    if (hasInlineSuggestion && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      removeInlineAutocomplete();
      setAutocompleteSuggestion("");
    }
    if (hasInlineSuggestion && ["Backspace", "Delete", "Enter"].includes(event.key)) {
      removeInlineAutocomplete();
      setAutocompleteSuggestion("");
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      clearWritingSuggestions();
    }
  }

  function handleEditorMouseDown() {
    clearWritingSuggestions();
  }

  function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !editorRef.current?.contains(selection.anchorNode)) {
      return "";
    }

    return selection.toString().trim();
  }

  function selectionIncludesSignature(value: string) {
    return Boolean(value && editorRef.current && selectionIntersectsSignature(editorRef.current, window.getSelection()));
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    clearWritingSuggestions();
    event.preventDefault();
    if (!editorRef.current || selectionIntersectsSignature(editorRef.current, window.getSelection())) return;
    savedSelection.current = captureEditorSelection(editorRef.current, window.getSelection());
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const pasted = normalizeClipboard(html, text, plainPasteOnce.current ? "text" : preferences.data?.effective.pasteMode ?? "adapt");
    plainPasteOnce.current = false;
    if (pasted) runCommand("insertHTML", pasted);
    const images = Array.from(event.clipboardData.items).filter(item => item.type.startsWith("image/"));
    images.forEach((item, index) => {
      const file = item.getAsFile();
      if (file) {
        setUploading(value => value + 1);
        void uploadPastedImage(file, index).catch(() => setError("A pasted image could not be uploaded. Please attach it again.")).finally(() => setUploading(value => value - 1));
      }
    });
    if (html && /<img\b/i.test(html) && !images.length) setError("Copied remote images were not imported. Attach the image files separately to include them securely.");
  }

  function changeMode(nextMode: "public" | "internal") {
    setMode(nextMode);
    setShowActionMenu(false);
    setCcInput("");
    setError(null);
    if (nextMode === "internal") {
      setCcEmails([]);
      setCcUserIds([]);
      setIncludePersistentCc(false);
    } else if (ccEmails.length === 0 && ccUserIds.length === 0) {
      setIncludePersistentCc(true);
      setCcUserIds(conversationParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []));
      setCcEmails(conversationParticipants.filter((participant) => !participant.userId).map((participant) => participant.email));
    }
  }

  function primaryAction(): ComposerAction {
    return mode === "public" ? "send" : "send_note";
  }

  async function submitMessage(selectedAction: ComposerAction = primaryAction()) {
    if (!ticketId || !editorRef.current) {
      return;
    }

    clearWritingSuggestions();
    if (uploading) { setError("Wait for pasted images to finish uploading."); return; }
    const bodyHtml = serializeComposer(editorRef.current, format);
    const bodyText = editorRef.current.innerText.trim();
    if (!bodyText) {
      setError("Message body is required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/tickets/${ticketId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          visibility: mode,
          bodyHtml,
          bodyText,
          attachmentIds: attachments.map((attachment) => attachment.id),
          ccEmails,
          ccUserIds,
          persistCc: mode === "public" && persistCc,
          includePersistentCc: mode === "public" && includePersistentCc,
          action: selectedAction
        })
      });
      editorRef.current.innerHTML = "";
      setDraftText("");
      setAutocompleteSuggestion("");
      setAttachments([]);
      setCcInput("");
      setCcEmails(conversationParticipants.filter((participant) => !participant.userId).map((participant) => participant.email));
      setCcUserIds(conversationParticipants.flatMap((participant) => participant.userId ? [participant.userId] : []));
      setPersistCc(true);
      setIncludePersistentCc(true);
      setShowActionMenu(false);
      window.localStorage.removeItem(`ticket-reply-draft:${ticketId}`);
      await onSaved?.();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`${mode === "public" ? "Unable to send reply." : "Unable to save note."}${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  async function closeTicket() {
    if (!ticketId) {
      return;
    }

    clearWritingSuggestions();
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/tickets/${ticketId}/close`, { method: "POST" });
      setShowActionMenu(false);
      await onSaved?.();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to close ticket.${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  function addCcToken(rawValue: string) {
    const token = rawValue.trim().replace(/,$/, "");
    if (!token) {
      return;
    }

    if (token.startsWith("@")) {
      const lookup = token.slice(1).toLowerCase();
      const matchedUser = ccUsers.find((user) =>
        `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(lookup)
      );
      if (matchedUser) {
        setCcUserIds((current) => (current.includes(matchedUser.id) ? current : [...current, matchedUser.id]));
        setCcInput("");
        return;
      }
      setError(`No internal user matched ${token}.`);
      return;
    }

    if (mode === "internal") {
      setError("Internal notes can only CC @internal users. Assign specialists for ongoing ticket notifications.");
      return;
    }

    const displayEmail = token.match(/<([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>$/)?.[1]?.toLowerCase();
    const contactLookup = token.toLowerCase();
    const matchedContact = ccContacts.find((contact) =>
      `${contact.firstName} ${contact.lastName} ${contact.email}`.toLowerCase().includes(contactLookup)
    );
    const email = displayEmail ?? matchedContact?.email.toLowerCase() ?? token.toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("CC must be an email address, requester name, or @internal user name.");
      return;
    }

    setCcEmails((current) => (current.includes(email) ? current : [...current, email]));
    setCcInput("");
    setError(null);
  }

  function removeCcEmail(email: string) {
    if (conversationParticipants.some((participant) => participant.email.toLowerCase() === email.toLowerCase())) {
      setIncludePersistentCc(false);
    }
    setCcEmails((current) => current.filter((item) => item !== email));
  }

  function removeCcUser(userId: string) {
    if (conversationParticipants.some((participant) => participant.userId === userId)) {
      setIncludePersistentCc(false);
    }
    setCcUserIds((current) => current.filter((item) => item !== userId));
  }

  async function uploadPastedImage(file: File, index: number) {
    if (!ticketId) {
      return;
    }

    const formData = new FormData();
    formData.append("file", file, file.name || `pasted-image-${index + 1}.png`);
    const uploaded = await apiFetch<{
      id: string;
      originalFilename: string;
      mimeType: string;
      fileSize: number;
      isInline?: boolean;
    }>(`/tickets/${ticketId}/attachments`, {
      method: "POST",
      body: formData
    });

    setAttachments((current) => [
      ...current,
      {
        id: uploaded.id,
        originalFilename: uploaded.originalFilename,
        mimeType: uploaded.mimeType,
        sizeLabel: formatBytes(uploaded.fileSize),
        isInline: uploaded.isInline
      }
    ]);
  }

  async function removeAttachment(attachmentId: string) {
    if (ticketId) {
      await apiFetch(`/tickets/${ticketId}/attachments/${attachmentId}`, { method: "DELETE" });
    }
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  async function runAiAction(action: "paraphrase" | "improve-reply" | "fix-grammar" | "suggest-reply") {
    if (!ticketId || !editorRef.current) {
      return;
    }

    clearWritingSuggestions();
    const selectedText = action === "paraphrase" || action === "fix-grammar" ? getSelectedText() : "";
    if (selectedText && selectionIncludesSignature(selectedText)) {
      setError("Select only the draft text above your signature before running this AI tool.");
      return;
    }
    const selectedRange = selectedText ? captureEditorSelection(editorRef.current, window.getSelection()) : null;
    const input = document.createElement("div");
    if (selectedRange) input.append(selectedRange.cloneContents()); else input.innerHTML = editorRef.current.innerHTML;
    const prepared = prepareWritingInput(input);
    const draft = prepared.text;
    const before = editorRef.current.innerHTML;
    if (action !== "suggest-reply" && !draft) {
      setError(action === "paraphrase" ? "Select text to paraphrase or write a draft first." : "Write a draft first.");
      return;
    }

    setAiBusy(action);
    setError(null);
    try {
      const result = await apiFetch<{ text: string }>(`/tickets/${ticketId}/ai/${action}`, {
        method: "POST",
        body: JSON.stringify({ draft })
      });

      if (editorRef.current.innerHTML !== before) throw new Error("Your draft changed while the suggestion was being prepared. Your edits have been kept; run the tool again when ready.");
      const resultText = stripSignatureFromText(result.text);
      setAiSuggestion({ html: restoreWritingHtml(resultText, prepared.protectedContent), before, range: selectedRange });
      setAutocompleteSuggestion("");
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to run AI writing tool.${detail ? ` ${detail}` : ""}`);
    } finally {
      setAiBusy(null);
    }
  }

  function applyAiSuggestion() {
    const editor = editorRef.current;
    if (!editor || !aiSuggestion) return;
    if (editor.innerHTML !== aiSuggestion.before) { setError("Your draft changed. Generate a new suggestion to preserve your edits."); setAiSuggestion(null); return; }
    editor.focus();
    const range = aiSuggestion.range ?? document.createRange();
    if (!aiSuggestion.range) {
      range.selectNodeContents(editor);
      const signature = editor.querySelector(EDITOR_SIGNATURE_SELECTOR);
      if (signature) range.setEndBefore(signature);
    }
    window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(range);
    document.execCommand("insertHTML", false, aiSuggestion.html);
    setAiUndo({ before: aiSuggestion.before, after: editor.innerHTML });
    setAiSuggestion(null); setDraftText(getEditorText()); setDraftRevision(value => value + 1);
  }

  function actionLabel(selectedAction: ComposerAction) {
    switch (selectedAction) {
      case "send":
        return "Send";
      case "send_and_close":
        return "Send and Close";
      case "save_note":
        return "Save Note";
      case "send_note":
        return "Send Note";
      case "send_note_and_close":
        return "Send Note and Close";
    }
  }

  return (
    <div className="editor ticket-reply-editor">
      <div className="ticket-reply-scroll-content">
      <div className="editor-toolbar editor-format-toolbar" aria-label="Reply tools" onMouseDown={event => { if ((event.target as Element).closest("button")) event.preventDefault(); }}>
        {toolbar.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className="icon-button"
              type="button"
              title={item.label}
              aria-label={item.label}
              key={item.label}
              disabled={preview || saving}
              onClick={() => runCommand(item.command, "value" in item ? item.value : undefined)}
            >
              <Icon size={17} aria-hidden="true" />
            </button>
          );
        })}
        <button className="icon-button" type="button" title="Link" aria-label="Link" disabled={preview || saving} onClick={openLinkEditor}>
          <Link size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" title="CC and attachments" aria-label="Open CC and attachments" onClick={() => {
          if (extrasRef.current) extrasRef.current.open = true;
          extrasRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }}>
          <Paperclip size={17} aria-hidden="true" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Preview"
          aria-label="Preview"
          onClick={() => {
            clearWritingSuggestions();
            setPreview((value) => !value);
          }}
        >
          <Eye size={17} aria-hidden="true" />
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("paraphrase")} disabled={Boolean(aiBusy) || preview || saving}>
          <Wand2 size={15} aria-hidden="true" />
          <span>Paraphrase</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("improve-reply")} disabled={Boolean(aiBusy) || preview || saving}>
          <Wand2 size={15} aria-hidden="true" />
          <span>Rewrite Draft</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("fix-grammar")} disabled={Boolean(aiBusy) || preview || saving}>
          <Wand2 size={15} aria-hidden="true" />
          <span>Fix Grammar</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("suggest-reply")} disabled={Boolean(aiBusy) || preview || saving}>
          <Wand2 size={15} aria-hidden="true" />
          <span>Draft Reply</span>
        </button>
        <button className="icon-button" type="button" title="Undo" aria-label="Undo" disabled={preview || saving} onClick={() => runCommand("undo")}><Undo2 size={16} /></button>
        <button className="icon-button" type="button" title="Redo" aria-label="Redo" disabled={preview || saving} onClick={() => runCommand("redo")}><Redo2 size={16} /></button>
        <button className="button secondary compact-button" type="button" aria-expanded={expandedTools} onClick={() => setExpandedTools(value => !value)}><SlidersHorizontal size={15} /> Format &amp; paste</button>
      </div>
      {expandedTools ? <div className="composer-format-controls" aria-label="Additional formatting">
        <label>Font<select className="input" aria-label="Selected text font" defaultValue={format.fontFamily} disabled={preview || saving} onChange={event => runCommand("fontName", event.target.value)}>{(preferences.data?.fonts ?? [format.fontFamily]).map(font => <option key={font}>{font}</option>)}</select></label>
        <label>Size<select className="input" aria-label="Selected text size" defaultValue={format.fontSize} disabled={preview || saving} onChange={event => applyFontSize(event.target.value)}>{Array.from({ length: 23 }, (_, i) => i + 10).map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
        <label>Color<input type="color" aria-label="Selected text color" defaultValue={format.color} disabled={preview || saving} onChange={event => runCommand("foreColor", event.target.value)} /></label>
        <label>Highlight<input type="color" aria-label="Selected text highlight" defaultValue="#fff2ac" disabled={preview || saving} onChange={event => runCommand("hiliteColor", event.target.value)} /></label>
        <div className="composer-align-controls" onMouseDown={event => event.preventDefault()}>{[{ command: "justifyLeft", label: "Align left", icon: AlignLeft }, { command: "justifyCenter", label: "Align center", icon: AlignCenter }, { command: "justifyRight", label: "Align right", icon: AlignRight }].map(item => <button key={item.command} className="icon-button" type="button" aria-label={item.label} title={item.label} disabled={preview || saving} onClick={() => runCommand(item.command)}><item.icon size={16} /></button>)}</div>
        <label>Paste<select className="input" aria-label="Paste behavior" value={preferences.data?.effective.pasteMode ?? "adapt"} disabled={!preferences.data} onChange={event => preferences.update({ pasteMode: event.target.value })}><option value="adapt">Match message</option><option value="keep">Keep source format</option><option value="text">Plain text only</option></select></label>
        <span className="muted">Defaults and reading zoom: Profile → Ticket Writing</span>
        {preferences.error ? <span role="alert">{preferences.error} <button className="button secondary compact-button" onClick={preferences.retry}>Retry</button></span> : <small role="status">{preferences.status}</small>}
      </div> : null}
      {linkEditor ? <div className="composer-link-editor" role="dialog" aria-label="Edit link">
        <label className="field"><span>Display text</span><input className="input" autoFocus value={linkEditor.text} onChange={event => setLinkEditor({ ...linkEditor, text: event.target.value })} /></label>
        <label className="field"><span>Link address</span><input className="input" placeholder="https://example.com" value={linkEditor.url} onChange={event => setLinkEditor({ ...linkEditor, url: event.target.value })} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") setLinkEditor(null); }} /></label>
        <button className="button compact-button" type="button" onClick={() => applyLink()}>Apply link</button>
        {linkEditor.anchor ? <button className="button secondary compact-button" type="button" onClick={() => applyLink(true)}>Remove link</button> : null}
        <button className="button secondary compact-button" type="button" onClick={() => setLinkEditor(null)}>Cancel</button>
      </div> : null}
      {aiSuggestion ? <div className="composer-ai-review" role="region" aria-label="AI writing suggestion"><strong>Review suggestion</strong><div className="composer-format-sample" dangerouslySetInnerHTML={{ __html: aiSuggestion.html }} /><div className="composer-align-controls"><button className="button compact-button" type="button" onClick={applyAiSuggestion}>Apply suggestion</button><button className="button secondary compact-button" type="button" onClick={() => setAiSuggestion(null)}>Discard</button></div></div> : null}
      {aiUndo && !aiSuggestion ? <button className="button secondary compact-button composer-undo-ai" type="button" onClick={() => { if (editorRef.current?.innerHTML === aiUndo.after) { editorRef.current.innerHTML = aiUndo.before; setDraftText(getEditorText()); setDraftRevision(value => value + 1); setAiUndo(null); } else setError("The draft has changed since the AI edit. Use Undo to step back through recent edits."); }}>Undo last AI edit</button> : null}
      <div className="reply-mode-toggle">
        <button className={`button ${mode === "public" ? "" : "secondary"}`} type="button" onClick={() => changeMode("public")}>
          Public Reply
        </button>
        <button className={`button ${mode === "internal" ? "" : "secondary"}`} type="button" onClick={() => changeMode("internal")}>
          Internal Note
        </button>
      </div>
      <div className="editor-body-frame">
        <div
          className="editor-surface signature-render ticket-message-surface"
          style={{ fontFamily: format.fontFamily, fontSize: format.fontSize, lineHeight: format.lineHeight, color: format.color, zoom: (preferences.data?.effective.displayScale ?? 100) / 100 }}
          autoCapitalize="sentences"
          autoCorrect="on"
          contentEditable={!preview && !saving}
          dir="ltr"
          lang="en-US"
          spellCheck
          suppressContentEditableWarning
          ref={editorRef}
          onInput={handleEditorInput}
          onKeyDown={handleEditorKeyDown}
          onMouseDown={handleEditorMouseDown}
          onPaste={handlePaste}
          role="textbox"
          aria-label={mode === "public" ? "Public reply body" : "Internal note body"}
          data-placeholder={mode === "public" ? "Write a customer-facing reply..." : "Write an internal troubleshooting note..."}
        />
      </div>
      <details className="ticket-composer-extras" ref={extrasRef}>
        <summary>
          <span><Paperclip size={14} aria-hidden="true" /> CC &amp; attachments</span>
          <small>{ccEmails.length + ccUserIds.length} CC · {attachments.length} files</small>
        </summary>
        <div className="ticket-composer-extras-content">
          <div className="cc-picker">
            <label className="field">
              <span>CC</span>
              <input
                className="input"
                value={ccInput}
                onChange={(event) => setCcInput(event.target.value)}
                onBlur={() => addCcToken(ccInput)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "," || event.key === "Tab") {
                    event.preventDefault();
                    addCcToken(ccInput);
                  }
                }}
                placeholder={mode === "internal" ? "Add @internal user" : "Add email, requester, or @internal user"}
                list="ticket-cc-users"
              />
              <datalist id="ticket-cc-users">
                {ccUsers.map((user) => (
                  <option key={`user-${user.id}`} value={`@${user.firstName} ${user.lastName}`}>
                    {user.email}
                  </option>
                ))}
                {mode === "public"
                  ? ccContacts.map((contact) => (
                      <option key={`contact-${contact.id}`} value={`${contact.firstName} ${contact.lastName} <${contact.email}>`}>
                        Requester
                      </option>
                    ))
                  : null}
              </datalist>
            </label>
            <div className="chip-row">
              {ccEmails.map((email) => (
                <button className="chip" type="button" key={email} onClick={() => removeCcEmail(email)}>
                  {email} x
                </button>
              ))}
              {ccUserIds.map((userId) => {
                const user = ccUsers.find((item) => item.id === userId);
                return user ? (
                  <button className="chip" type="button" key={userId} onClick={() => removeCcUser(userId)}>
                    {user.firstName} {user.lastName} x
                  </button>
                ) : null;
              })}
            </div>
            {mode === "public" && (ccEmails.length > 0 || ccUserIds.length > 0) ? (
              <label className="ticket-follow-cc-option">
                <input type="checkbox" checked={persistCc} onChange={(event) => setPersistCc(event.target.checked)} />
                <span>Keep new CC recipients in future public replies</span>
              </label>
            ) : null}
            {mode === "public" && (ccEmails.length > 0 || ccUserIds.length > 0) ? (
              <button className="button secondary compact-button ticket-clear-reply-cc" type="button" onClick={() => { setCcEmails([]); setCcUserIds([]); setIncludePersistentCc(false); }}>
                Clear CC for this reply
              </button>
            ) : null}
          </div>
          <div className="grid columns-2 ticket-editor-attachments">
            <AttachmentDropzone ticketId={ticketId} onUploaded={(attachment) => setAttachments((current) => [...current, attachment])} />
            <div className="panel ticket-attachment-preview-panel">
              <h3>Attachments</h3>
              <AttachmentPreviewList attachments={attachments} onRemove={(attachmentId) => void removeAttachment(attachmentId)} />
            </div>
          </div>
        </div>
      </details>
      </div>
      <div className="editor-toolbar editor-submit-toolbar" role="group" aria-label="Reply actions">
        <SignatureInserter onInsert={(html) => {
          if (!editorRef.current) return;
          clearWritingSuggestions();
          signatureHtmlRef.current = html;
          signatureTextRef.current = htmlToEditorText(html);
          setEditorSignature(editorRef.current, html);
          setDraftText(getEditorText()); setDraftRevision(value => value + 1);
        }} />
        {error ? <span className="error">{error}</span> : null}
        <div className="split-action">
          <button className="button split-action-main" type="button" onClick={() => submitMessage()} disabled={saving || !ticketId}>
            <Send size={16} aria-hidden="true" />
            <span>{actionLabel(primaryAction())}</span>
          </button>
          <button
            className="button split-action-toggle"
            type="button"
            aria-label="More send actions"
            aria-expanded={showActionMenu}
            onClick={() => setShowActionMenu((current) => !current)}
            disabled={saving || !ticketId}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {showActionMenu ? (
            <div className="split-action-menu" role="menu">
              {mode === "public" ? (
                <>
                  <button type="button" role="menuitem" onClick={() => submitMessage("send_and_close")}>
                    Send and Close
                  </button>
                  <button type="button" role="menuitem" onClick={() => closeTicket()}>
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button type="button" role="menuitem" onClick={() => submitMessage("save_note")}>
                    Save Note
                  </button>
                  <button type="button" role="menuitem" onClick={() => submitMessage("send_note_and_close")}>
                    Send Note and Close
                  </button>
                  <button type="button" role="menuitem" onClick={() => closeTicket()}>
                    Close
                  </button>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

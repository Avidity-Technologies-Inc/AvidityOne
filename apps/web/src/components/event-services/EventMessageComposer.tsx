"use client";

import {
  Bold,
  Code,
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
  Underline
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
  normalizeEditorText,
  replaceEditorRangeWithText,
  selectionIntersectsSignature,
  setEditorSignature,
  stripLegacySignature
} from "@/lib/editor-content";
import { AttachmentPreviewItem, AttachmentPreviewList } from "../tickets/AttachmentPreviewList";
import { SignatureInserter } from "../tickets/SignatureInserter";
import { EventAttachmentDropzone } from "./EventAttachmentDropzone";

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

interface UserOption {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface UserSignature {
  htmlSignature: string;
  useSignatureByDefault: boolean;
}

interface EventMessageComposerProps {
  requestId?: string;
  users: UserOption[];
  onSaved?: () => void | Promise<void>;
}

export function EventMessageComposer({ requestId, users, onSaved }: EventMessageComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const autocompleteRequestRef = useRef(0);
  const signatureHtmlRef = useRef("");
  const signatureTextRef = useRef("");
  const [mode, setMode] = useState<"public" | "internal">("public");
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentPreviewItem[]>([]);
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccUserIds, setCcUserIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [autocompleteSuggestion, setAutocompleteSuggestion] = useState("");
  const [autocompleteDismissedFor, setAutocompleteDismissedFor] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    apiFetch<UserSignature>("/profile/signature")
      .then((signature) => {
        if (!mounted || !signature.htmlSignature.trim() || !editorRef.current) {
          return;
        }
        signatureHtmlRef.current = signature.htmlSignature;
        signatureTextRef.current = htmlToEditorText(signature.htmlSignature);
        if (signature.useSignatureByDefault && !editorRef.current.innerText.trim() && !editorRef.current.innerHTML.trim()) {
          editorRef.current.innerHTML = composeEditorHtml("", signature.htmlSignature);
        }
      })
      .catch(() => undefined);

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!requestId || preview || aiBusy || saving) {
      return;
    }
    const draft = getAutocompleteDraft();
    if (draft.length < AUTOCOMPLETE_MIN_CHARS || draft === autocompleteDismissedFor) {
      return;
    }
    const requestNumber = autocompleteRequestRef.current + 1;
    const timeout = window.setTimeout(() => {
      autocompleteRequestRef.current = requestNumber;
      apiFetch<{ text: string }>(`/event-services/${requestId}/ai/complete-draft`, {
        method: "POST",
        body: JSON.stringify({ draft: draft.slice(-900) })
      })
        .then((result) => {
          if (autocompleteRequestRef.current !== requestNumber) return;
          const suggestion = result.text.trim();
          setAutocompleteSuggestion(suggestion && !draft.endsWith(suggestion) && showInlineAutocomplete(suggestion) ? suggestion : "");
        })
        .catch(() => setAutocompleteSuggestion(""));
    }, AUTOCOMPLETE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [aiBusy, autocompleteDismissedFor, draftText, preview, requestId, saving]);

  function runCommand(command: string, value?: string) {
    removeInlineAutocomplete();
    setAutocompleteSuggestion("");
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    setDraftText(getEditorText());
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

  function composeDraftWithSignature(draft: string) {
    return composeEditorHtml(draft, signatureHtmlRef.current);
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
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
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
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
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
    autocompleteRequestRef.current += 1;
    removeInlineAutocomplete();
    setDraftText(getEditorText());
    setAutocompleteSuggestion("");
  }

  function getInlineAutocompleteNode() {
    return editorRef.current?.querySelector(`.${INLINE_AUTOCOMPLETE_CLASS}`) ?? null;
  }

  function removeInlineAutocomplete() {
    getInlineAutocompleteNode()?.remove();
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

  function clearAutocomplete() {
    autocompleteRequestRef.current += 1;
    removeInlineAutocomplete();
    setAutocompleteSuggestion("");
  }

  function canInsertInlineAutocomplete() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed || !editorRef.current?.contains(selection.anchorNode)) {
      return false;
    }
    const anchorElement = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    return Boolean(anchorElement) && isCursorAtAutocompleteBoundary() && !isCursorAfterSignature() && !anchorElement?.closest("a, table, img, pre, blockquote");
  }

  function showInlineAutocomplete(rawSuggestion: string) {
    const suggestion = rawSuggestion.trim();
    if (!suggestion || !editorRef.current || !canInsertInlineAutocomplete()) {
      return false;
    }
    removeInlineAutocomplete();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!selection || !range) return false;
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
    if ((!autocompleteSuggestion && !node) || !editorRef.current) return;
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
    setDraftText(getEditorText());
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
      clearAutocomplete();
    }
    if (hasInlineSuggestion && ["Backspace", "Delete", "Enter"].includes(event.key)) {
      clearAutocomplete();
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      clearAutocomplete();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    removeInlineAutocomplete();
    setAutocompleteSuggestion("");
    const images = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/"));
    if (images.length === 0) return;
    event.preventDefault();
    images.forEach((item, index) => {
      const file = item.getAsFile();
      if (file) void uploadPastedImage(file, index);
    });
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

  async function uploadPastedImage(file: File, index: number) {
    if (!requestId) return;
    const formData = new FormData();
    formData.append("file", file, file.name || `pasted-image-${index + 1}.png`);
    const uploaded = await apiFetch<{ id: string; originalFilename: string; mimeType: string; fileSize: number; isInline?: boolean }>(`/event-services/${requestId}/attachments`, {
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
    if (requestId) {
      await apiFetch(`/event-services/${requestId}/attachments/${attachmentId}`, { method: "DELETE" });
    }
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  function toggleNotifyUser(userId: string) {
    setNotifyUserIds((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function addCcToken(rawValue: string) {
    const token = rawValue.trim().replace(/,$/, "");
    if (!token) return;
    if (token.startsWith("@")) {
      const lookup = token.slice(1).toLowerCase();
      const matchedUser = users.find((user) => `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(lookup));
      if (matchedUser) {
        setCcUserIds((current) => (current.includes(matchedUser.id) ? current : [...current, matchedUser.id]));
        setCcInput("");
        return;
      }
      setError(`No internal user matched ${token}.`);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token)) {
      setError("CC must be an email address or @internal user name.");
      return;
    }
    setCcEmails((current) => (current.includes(token.toLowerCase()) ? current : [...current, token.toLowerCase()]));
    setCcInput("");
  }

  async function runAiAction(action: "paraphrase" | "improve-reply" | "fix-grammar" | "suggest-reply") {
    if (!requestId || !editorRef.current) return;
    clearAutocomplete();
    const selectedText = action === "paraphrase" || action === "fix-grammar" ? getSelectedText() : "";
    if (selectedText && selectionIncludesSignature(selectedText)) {
      setError("Select only the draft text above your signature before running this AI tool.");
      return;
    }
    const selectedRange = selectedText ? captureEditorSelection(editorRef.current, window.getSelection()) : null;
    const draft = selectedText || getEditorTextWithoutSignature();
    if (action !== "suggest-reply" && !draft) {
      setError(action === "paraphrase" ? "Select text to paraphrase or write a draft first." : "Write a draft first.");
      return;
    }
    setAiBusy(action);
    setError(null);
    try {
      const result = await apiFetch<{ text: string }>(`/event-services/${requestId}/ai/${action}`, {
        method: "POST",
        body: JSON.stringify({ draft })
      });
      const resultText = stripSignatureFromText(result.text);
      if (selectedText) {
        if (!selectedRange || !replaceEditorRangeWithText(editorRef.current, selectedRange, resultText)) {
          throw new Error("The selected text changed before the AI result was ready. Please select it again.");
        }
      } else {
        removeInlineAutocomplete();
        editorRef.current.innerHTML = composeDraftWithSignature(resultText);
      }
      setDraftText(getEditorText());
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`Unable to run AI writing tool.${detail ? ` ${detail}` : ""}`);
    } finally {
      setAiBusy(null);
    }
  }

  async function submitMessage() {
    if (!requestId || !editorRef.current) return;
    clearAutocomplete();
    const bodyHtml = editorRef.current.innerHTML;
    const bodyText = editorRef.current.innerText.trim();
    if (!bodyText) {
      setError("Message body is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/event-services/${requestId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          visibility: mode,
          bodyHtml,
          bodyText,
          attachmentIds: attachments.map((attachment) => attachment.id),
          notifyUserIds,
          ccEmails,
          ccUserIds
        })
      });
      editorRef.current.innerHTML = "";
      setDraftText("");
      setAttachments([]);
      setNotifyUserIds([]);
      setCcInput("");
      setCcEmails([]);
      setCcUserIds([]);
      await onSaved?.();
    } catch (requestError) {
      const detail = requestError instanceof Error ? requestError.message : "";
      setError(`${mode === "public" ? "Unable to send message." : "Unable to save internal note."}${detail ? ` ${detail}` : ""}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="editor event-message-composer">
      <div className="editor-toolbar editor-format-toolbar" aria-label="Event message tools">
        {toolbar.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className="icon-button"
              type="button"
              title={item.label}
              aria-label={item.label}
              key={item.label}
              onClick={() => runCommand(item.command, "value" in item ? item.value : undefined)}
            >
              <Icon size={17} aria-hidden="true" />
            </button>
          );
        })}
        <button className="icon-button" type="button" title="Link" aria-label="Link" onClick={() => runCommand("createLink", "https://")}>
          <Link size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" title="Attach" aria-label="Attach">
          <Paperclip size={17} aria-hidden="true" />
        </button>
        <button className="icon-button" type="button" title="Preview" aria-label="Preview" onClick={() => { clearAutocomplete(); setPreview((value) => !value); }}>
          <Eye size={17} aria-hidden="true" />
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("paraphrase")} disabled={Boolean(aiBusy)}>
          <Wand2 size={15} aria-hidden="true" /><span>Paraphrase</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("improve-reply")} disabled={Boolean(aiBusy)}>
          <Wand2 size={15} aria-hidden="true" /><span>Rewrite Draft</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("fix-grammar")} disabled={Boolean(aiBusy)}>
          <Wand2 size={15} aria-hidden="true" /><span>Fix Grammar</span>
        </button>
        <button className="button secondary compact-button" type="button" onClick={() => runAiAction("suggest-reply")} disabled={Boolean(aiBusy)}>
          <Wand2 size={15} aria-hidden="true" /><span>Draft Reply</span>
        </button>
      </div>
      <div className="reply-mode-toggle event-message-mode-toggle">
        <button className={`button ${mode === "public" ? "" : "secondary"}`} type="button" onClick={() => setMode("public")}>Public Message</button>
        <button className={`button ${mode === "internal" ? "" : "secondary"}`} type="button" onClick={() => setMode("internal")}>Internal Note</button>
      </div>
      <div
        className="editor-surface signature-render"
        autoCapitalize="sentences"
        autoCorrect="on"
        contentEditable={!preview}
        dir="ltr"
        lang="en-US"
        spellCheck
        suppressContentEditableWarning
        ref={editorRef}
        onInput={handleEditorInput}
        onKeyDown={handleEditorKeyDown}
        onMouseDown={clearAutocomplete}
        onPaste={handlePaste}
        role="textbox"
        aria-label={mode === "public" ? "Requester message body" : "Internal event note body"}
        data-placeholder={mode === "public" ? "Write a message to the requester..." : "Write an internal event note..."}
      />
      {mode === "public" ? (
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
              placeholder="Add email or @internal user"
              list="event-cc-users"
            />
            <datalist id="event-cc-users">
              {users.map((user) => <option key={user.id} value={`@${user.firstName} ${user.lastName}`}>{user.email}</option>)}
            </datalist>
          </label>
          <div className="chip-row">
            {ccEmails.map((email) => <button className="chip" type="button" key={email} onClick={() => setCcEmails((current) => current.filter((item) => item !== email))}>{email} x</button>)}
            {ccUserIds.map((userId) => {
              const user = users.find((item) => item.id === userId);
              return user ? <button className="chip" type="button" key={userId} onClick={() => setCcUserIds((current) => current.filter((item) => item !== userId))}>{user.firstName} {user.lastName} x</button> : null;
            })}
          </div>
        </div>
      ) : null}
      <div className="grid columns-2 ticket-editor-attachments event-composer-attachments">
        <EventAttachmentDropzone requestId={requestId} onUploaded={(attachment) => setAttachments((current) => [...current, attachment])} />
        <div className="panel ticket-attachment-preview-panel event-attachment-preview-panel">
          <h3>Attachments</h3>
          <AttachmentPreviewList attachments={attachments} onRemove={(attachmentId) => void removeAttachment(attachmentId)} />
        </div>
      </div>
      <div className="editor-toolbar editor-submit-toolbar">
        <SignatureInserter onInsert={(html) => {
          if (!editorRef.current) return;
          clearAutocomplete();
          signatureHtmlRef.current = html;
          signatureTextRef.current = htmlToEditorText(html);
          setEditorSignature(editorRef.current, html);
          setDraftText(getEditorText());
        }} />
        {users.length ? (
          <div className="notify-picker">
            <strong>Notify</strong>
            {users.map((user) => (
              <label key={user.id}>
                <input type="checkbox" checked={notifyUserIds.includes(user.id)} onChange={() => toggleNotifyUser(user.id)} />
                {user.firstName} {user.lastName}
              </label>
            ))}
          </div>
        ) : null}
        {error ? <span className="error">{error}</span> : null}
        <button className="button" type="button" onClick={() => void submitMessage()} disabled={saving || !requestId}>
          <Send size={16} aria-hidden="true" />
          <span>{mode === "public" ? "Send Message" : "Save Note"}</span>
        </button>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

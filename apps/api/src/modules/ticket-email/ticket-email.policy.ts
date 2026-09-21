import sanitizeHtml from "sanitize-html";
import { BadRequestException } from "@nestjs/common";

export const REPLY_SEPARATOR = "--- Ticket email: reply above this line ---";
export const ticketEmailDefaults = {
  enabled: false, repliesEnabled: false, closeEnabled: false, includeHistory: true,
  includeAttachments: true, includeInternal: false, includeTeams: false, includeGroups: false,
  includeWatchers: true, attachmentBudgetMb: 2, confirmationMinutes: 30
};
export type TicketEmailPolicy = typeof ticketEmailDefaults;
export function escapeEmail(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
export function emailText(html: string) {
  return sanitizeHtml(html.replace(/<\/(?:td|th)\s*>/gi, "\t").replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, "\n").replace(/<br\s*\/?\s*>/gi, "\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/gi, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)));
}
function freshHtml(bodyHtml: string) {
  const boundaries = [
    bodyHtml.indexOf(REPLY_SEPARATOR),
    bodyHtml.search(/<(?:blockquote\b|div\b[^>]*(?:id=["'](?:x_)*(?:divRplyFwdMsg|mail-editor-reference-message-container)|class=["'][^"']*gmail_quote))/i)
  ];
  // Outlook for Mac emits a styled From/Date/To/Subject block without the
  // Windows divRplyFwdMsg marker. Cut before that block, preserving the signature.
  const header = /<(?:div|p)\b[^>]*>(?:\s|&nbsp;|<(?:span|b|strong)\b[^>]*>)*(?:From|De):/gi;
  for (const match of bodyHtml.matchAll(header)) {
    const text = emailText(bodyHtml.slice(match.index, match.index! + 12000));
    if (/(?:To|Para):/i.test(text) && /(?:Subject|Asunto):/i.test(text)) { boundaries.push(match.index!); break; }
  }
  const ends = boundaries.filter((index) => index >= 0);
  return ends.length ? bodyHtml.slice(0, Math.min(...ends)) : bodyHtml;
}
export function authoredEmailText(bodyText?: string | null, bodyHtml?: string | null) {
  const complete = bodyHtml ? emailText(freshHtml(bodyHtml)) : bodyText ?? "";
  const text = complete.replace(/\r\n?/g, "\n");
  const boundary = text.indexOf(REPLY_SEPARATOR);
  let fresh = boundary >= 0 ? text.slice(0, boundary) : text;
  const quoted = fresh.search(/^(?:\s*>|\s*On .+wrote:|\s*From:\s|\s*De:\s|\s*-{2,}\s*Original Message|\s*-{2,}\s*Forwarded message)/im);
  if (quoted >= 0) fresh = fresh.slice(0, quoted);
  return fresh.trim();
}
export function parseStaffReply(bodyText?: string | null, bodyHtml?: string | null, hasAttachments = false) {
  const fresh = authoredEmailText(bodyText, bodyHtml);
  const lines = fresh.split("\n");
  const close = /^\[closed\]$/i.test(lines[0]?.trim() ?? "");
  if (close) lines.shift();
  const body = lines.join("\n").trim();
  if (!body && !close && !hasAttachments) throw new BadRequestException("No new reply text was found above the quoted conversation.");
  if (/^\[(?:closed|confirm\b)/im.test(body)) throw new BadRequestException("Place [Closed] only on the first line of the new reply.");
  let html = `<p>${escapeEmail(body).replace(/\n/g, "<br>")}</p>`;
  if (bodyHtml) {
    let candidate = freshHtml(bodyHtml);
    if (close) candidate = candidate.replace(/\[closed\]/i, "");
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    if (normalize(emailText(candidate)) === normalize(body)) html = candidate;
  }
  return { close, bodyText: body, bodyHtml: html };
}
export function isAutomaticEmail(headers: Record<string, string> = {}) {
  const h = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]));
  return Boolean((h["auto-submitted"] && h["auto-submitted"] !== "no") || h["x-autoreply"] || h["x-autorespond"] || /bulk|list|junk/.test(h.precedence ?? ""));
}

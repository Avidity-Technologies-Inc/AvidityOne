import { SendMessageInput } from "./mail-provider.interface";

export function messageReferences(value?: string | null): string[] {
  // Only RFC message IDs belong in threading headers; never copy arbitrary header text.
  return [...new Set(value?.match(/<[^<>\s@]+@[^<>\s@]+>/g) ?? [])];
}

export function replyReferences(references?: string | null, parent?: string | null): string[] {
  return [...new Set([...messageReferences(references), ...messageReferences(parent)])].slice(-50);
}

export function ticketMailSubject(subject: string, ticketNumber: string): string {
  const clean = subject.replace(/[\r\n]+/g, " ").trim();
  return clean.toUpperCase().includes(`[${ticketNumber.toUpperCase()}]`)
    ? clean
    : /^re:/i.test(clean)
      ? `Re: [${ticketNumber}] ${clean.replace(/^re:\s*/i, "")}`
      : `[${ticketNumber}] ${clean}`;
}

function address(value: string): string {
  const clean = value.trim();
  if (!/^[^\s<>(),;:"\\@]+@[^\s<>(),;:"\\@]+$/.test(clean)) throw new Error("Invalid email address");
  return `<${clean}>`;
}

function encodedHeader(value: string): string {
  // RFC 2047 words must be <=75 characters. Split by code point, not UTF-8 bytes.
  const chunks: string[] = [];
  let chunk = "";
  for (const char of value.replace(/[\r\n\x00-\x1f\x7f]/g, " ")) {
    if (Buffer.byteLength(chunk + char) > 42) { chunks.push(chunk); chunk = ""; }
    chunk += char;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map((part) => `=?UTF-8?B?${Buffer.from(part).toString("base64")}?=`).join("\r\n ");
}

function base64(data: Buffer): string {
  return data.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/** MIME allows Graph /reply to carry files with Mail.Send, without a writable draft. */
export function buildReplyMime(input: SendMessageInput, internetMessageId: string, boundaryId: string): string {
  const mixed = `mixed_${boundaryId}`;
  const related = `related_${boundaryId}`;
  const alternative = `alternative_${boundaryId}`;
  const refs = replyReferences(input.references, input.inReplyTo);
  const parent = messageReferences(input.inReplyTo).at(-1);
  const lines = [
    `From: ${address(input.fromAddress || input.mailboxEmailAddress)}`,
    `To: ${input.to.map(address).join(",\r\n ")}`,
    ...(input.cc?.length ? [`Cc: ${input.cc.map(address).join(",\r\n ")}`] : []),
    ...(input.replyToAddress ? [`Reply-To: ${address(input.replyToAddress)}`] : []),
    `Subject: ${encodedHeader(input.subject)}`,
    `Message-ID: ${internetMessageId}`,
    `Date: ${new Date().toUTCString()}`,
    ...(parent ? [`In-Reply-To: ${parent}`] : []),
    ...(refs.length ? [`References: ${refs.join("\r\n ")}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${mixed}"`, "",
    `--${mixed}`, `Content-Type: multipart/related; boundary="${related}"`, "",
    `--${related}`, `Content-Type: multipart/alternative; boundary="${alternative}"`, ""
  ];
  for (const [type, body] of [["plain", input.bodyText], ["html", input.bodyHtml]]) {
    lines.push(`--${alternative}`, `Content-Type: text/${type}; charset=utf-8`, "Content-Transfer-Encoding: base64", "", base64(Buffer.from(body)));
  }
  lines.push(`--${alternative}--`);
  const files = input.attachments ?? [];
  const part = (file: typeof files[number], inline: boolean) => {
    const cid = file.contentId?.replace(/^<|>$/g, "");
    if (cid && /[\s<>\x00-\x1f\x7f]/.test(cid)) throw new Error("Invalid attachment Content-ID");
    const mimeType = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(file.mimeType) ? file.mimeType : "application/octet-stream";
    // RFC 2231 continuation parameters preserve long Unicode filenames without header injection.
    const filename = encodeURIComponent(file.originalFilename.replace(/[\r\n\x00-\x1f\x7f]/g, "_")).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
    const tokens = filename.match(/%[0-9a-f]{2}|./gi) ?? [];
    const chunks: string[] = [];
    let chunk = "";
    for (const token of tokens) { if (chunk.length + token.length > 48) { chunks.push(chunk); chunk = ""; } chunk += token; }
    chunks.push(chunk);
    return [
      `Content-Type: ${mimeType}`, "Content-Transfer-Encoding: base64",
      `Content-Disposition: ${inline ? "inline" : "attachment"};`,
      ...chunks.map((value, i) => ` filename*${i}*=${i === 0 ? "utf-8''" : ""}${value}${i < chunks.length - 1 ? ";" : ""}`),
      ...(cid ? [`Content-ID: <${cid}>`] : []), "", base64(file.contentBytes)
    ];
  };
  for (const file of files.filter((f) => f.isInline && f.contentId)) lines.push(`--${related}`, ...part(file, true));
  lines.push(`--${related}--`);
  for (const file of files.filter((f) => !(f.isInline && f.contentId))) lines.push(`--${mixed}`, ...part(file, false));
  lines.push(`--${mixed}--`, "");
  return lines.join("\r\n");
}

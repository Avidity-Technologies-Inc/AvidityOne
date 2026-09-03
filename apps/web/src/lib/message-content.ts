export interface PlainMessageSections {
  main: string;
  signature: string;
  quote: string;
}

export function enhanceEmailMessageBody(body: HTMLElement) {
  const selectors = "blockquote, .gmail_quote, .gmail_signature, [id^='divRplyFwdMsg']";
  const candidates = Array.from(body.querySelectorAll<HTMLElement>(selectors));
  const topLevelCandidates = candidates.filter(
    (candidate) => !candidate.closest("details") && !candidate.parentElement?.closest(selectors)
  );
  topLevelCandidates.forEach((candidate) => {
    const isSignature = candidate.matches(".gmail_signature");
    wrapMessageSection(candidate, isSignature ? "Show signature" : "Show quoted history", false, isSignature ? "message-signature-collapsible" : "");
  });

  if (!body.querySelector(".message-collapsible:not(.message-signature-collapsible)")) {
    const outlookHeaderPattern = /\bFrom:\s+[\s\S]{0,600}?\bSent:\s+[\s\S]{0,600}?\bTo:\s+[\s\S]{0,600}?\bSubject:/i;
    const outlookHeader = Array.from(body.querySelectorAll<HTMLElement>("div, p, table"))
      .filter((candidate) => !candidate.closest("details") && outlookHeaderPattern.test(candidate.textContent ?? ""))
      .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0];
    if (outlookHeader) wrapMessageSection(outlookHeader, "Show quoted history", true);
  }

  if (!body.querySelector(".message-collapsible:not(.message-signature-collapsible)")) {
    const plainQuote = findMessageMarkerElement(body, /^(?:\s*>|\s*On .+ wrote:|\s*-{2,}\s*Original Message\s*-{2,})/im);
    if (plainQuote) wrapMessageSection(plainQuote, "Show quoted history", true);
  }

  if (!body.querySelector(".message-signature-collapsible")) {
    const mobileSignature = findMessageMarkerElement(body, /^\s*(?:Sent from my (?:iPhone|iPad|Android|mobile device)|Get Outlook for (?:iOS|Android))\s*$/im);
    if (mobileSignature && !mobileSignature.closest("details")) {
      wrapMessageSection(mobileSignature, "Show signature", false, "message-signature-collapsible");
    }
  }
}

export function splitPlainMessage(text: string): PlainMessageSections {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const quoteIndex = lines.findIndex((line, index) =>
    /^\s*>/.test(line)
    || /^\s*On .+ wrote:\s*$/i.test(line)
    || /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)
    || (/^\s*From:\s+.+/i.test(line) && lines.slice(index + 1, index + 5).some((candidate) => /^\s*(?:Sent|Date|To|Subject):/i.test(candidate)))
  );
  const signatureLimit = quoteIndex >= 0 ? quoteIndex : lines.length;
  const signatureIndex = lines.slice(1, signatureLimit).findIndex((line) =>
    /^\s*(?:(?:Best|Kind|Warm) regards|Regards|Sincerely|Respectfully|(?:Many )?Thanks|Thank you|Cheers|Sent from my (?:iPhone|iPad|Android|mobile device)|Get Outlook for (?:iOS|Android)|--)\s*,?\s*$/i.test(line)
  );
  const resolvedSignatureIndex = signatureIndex >= 0 ? signatureIndex + 1 : -1;
  const mainEnd = resolvedSignatureIndex >= 0 ? resolvedSignatureIndex : quoteIndex >= 0 ? quoteIndex : lines.length;
  const signatureEnd = quoteIndex >= 0 ? quoteIndex : lines.length;
  return {
    main: lines.slice(0, mainEnd).join("\n").trim(),
    signature: resolvedSignatureIndex >= 0 ? lines.slice(resolvedSignatureIndex, signatureEnd).join("\n").trim() : "",
    quote: quoteIndex >= 0 ? lines.slice(quoteIndex).join("\n").trim() : ""
  };
}

function wrapMessageSection(candidate: HTMLElement, labelText: string, includeFollowingSiblings = false, extraClass = "") {
  const details = document.createElement("details");
  details.className = `message-collapsible${extraClass ? ` ${extraClass}` : ""}`;
  const summary = document.createElement("summary");
  summary.textContent = labelText;
  candidate.before(details);
  details.append(summary, candidate);
  if (includeFollowingSiblings) {
    while (details.nextSibling) details.append(details.nextSibling);
  }
}

function findMessageMarkerElement(body: HTMLElement, pattern: RegExp) {
  return Array.from(body.querySelectorAll<HTMLElement>("div, p, span, font"))
    .filter((candidate) => !candidate.closest("details") && pattern.test(candidate.textContent ?? ""))
    .sort((left, right) => (left.textContent?.length ?? 0) - (right.textContent?.length ?? 0))[0] ?? null;
}

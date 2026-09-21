import { emailText, isAutomaticEmail, parseStaffReply, REPLY_SEPARATOR } from "./ticket-email.policy";
describe("Operational email parsing", () => {
  it("recognizes only a first-line close command in newly authored text", () => {
    expect(parseStaffReply(`[Closed]\nCompleted.\n${REPLY_SEPARATOR}\n[Closed]\nOld content`)).toMatchObject({ close: true, bodyText: "Completed." });
    expect(parseStaffReply(`Still working.\n${REPLY_SEPARATOR}\n[Closed]`)).toMatchObject({ close: false, bodyText: "Still working." });
    expect(() => parseStaffReply("Still working\n[Closed]")).toThrow("first line");
  });
  it("does not execute quoted, signature or forwarded commands", () => {
    expect(parseStaffReply("Thanks\nOn Monday Jane wrote:\n[Closed]").close).toBe(false);
    expect(() => parseStaffReply(null, "<blockquote>[Closed]<p>Old message</p></blockquote>")).toThrow();
    expect(() => parseStaffReply("> [Closed]\n> Done")).toThrow();
    expect(() => parseStaffReply("From: somebody@example.test\n[Closed]")).toThrow();
  });
  it("preserves safe rich formatting of a fresh HTML reply and never includes the quoted thread", () => {
    const result = parseStaffReply(null, `<div>[Closed]</div><p><strong>Completed.</strong></p><div>${REPLY_SEPARATOR}</div><p>Old private content</p>`);
    expect(result.close).toBe(true); expect(result.bodyHtml).toContain("<strong>Completed.</strong>"); expect(result.bodyHtml).not.toContain("Old private");
  });
  it("reads complete bodies with line breaks and ignores automated email", () => {
    expect(emailText("<p>First</p><p>Second &amp; third</p>").trim()).toBe("First\nSecond & third");
    expect(isAutomaticEmail({ "Auto-Submitted": "auto-replied" })).toBe(true);
    expect(isAutomaticEmail({ "auto-submitted": "no" })).toBe(false);
  });
  it("preserves an Outlook Mac signature before its unmarked quoted header", () => {
    const result = parseStaffReply(null, '<html><body><div>[Closed]</div><div>This was fixed</div><div><br></div><table><tr><td><img src="cid:photo"></td><td style="color:#123456">Specialist</td></tr></table><div style="border-top:1px solid blue"><span><b>From:</b> Support<br><b>Date:</b> Monday<br><b>To:</b> Specialist<br><b>Subject:</b> Earlier email</span></div><p>Old private content [Closed]</p></body></html>');
    expect(result.close).toBe(true);
    expect(result.bodyHtml).toContain('src="cid:photo"');
    expect(result.bodyHtml).toContain('style="color:#123456"');
    expect(result.bodyHtml).not.toContain('From:');
    expect(result.bodyText).not.toContain('Old private');
    expect(result.bodyHtml).not.toContain('[Closed]');
  });
  it("ignores close commands in Outlook and Gmail quoted messages", () => {
    for (const quote of ['<div id="mail-editor-reference-message-container">', '<div id="x_divRplyFwdMsg">', '<div class="gmail_quote">', '<div><b>From:</b> User<br><b>To:</b> Support<br><b>Subject:</b> Original']) {
      const result = parseStaffReply(null, `<p><strong>Still working.</strong></p>${quote}<p>[Closed]</p><p>Old text</p></div>`);
      expect(result.close).toBe(false); expect(result.bodyHtml).toContain('<strong>Still working.</strong>');
      expect(result.bodyText).toBe('Still working.');
    }
  });
});

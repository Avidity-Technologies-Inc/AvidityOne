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
});

import { buildReplyMime, messageReferences, replyReferences, ticketMailSubject } from "./mail-threading";

describe("mail threading", () => {
  it("keeps reference order and deduplicates the direct parent", () => {
    expect(replyReferences("<first@example.test>\r\n <parent@example.test>", "<parent@example.test>")).toEqual(["<first@example.test>", "<parent@example.test>"]);
    expect(messageReferences("Bcc: stranger@example.test\r\n<valid@example.test>")).toEqual(["<valid@example.test>"]);
  });
  it("adds the real ticket number once, including replies and configured prefixes", () => {
    expect(ticketMailSubject("Re: Flyer", "SUP-12001")).toBe("Re: [SUP-12001] Flyer");
    expect(ticketMailSubject("Re: [SUP-12001] Flyer", "SUP-12001")).toBe("Re: [SUP-12001] Flyer");
    expect(ticketMailSubject("Received", "SUP-12001")).toBe("[SUP-12001] Received");
  });
  it("encodes HTML, Unicode subjects, binary and inline files without interpreting their contents as headers", () => {
    const input = { mailboxId: "box", mailboxEmailAddress: "support@example.test", to: ["client@example.test"],
      subject: "Diseño 😀".repeat(30), bodyText: "Thanks\nGracias", bodyHtml: '<table><tr><td>Firma</td></tr></table><img src="cid:logo">',
      attachments: [
        { originalFilename: 'Diseño "final"\r\nBcc: other.pdf', mimeType: "application/pdf", contentBytes: Buffer.from([0, 255, 10]), sizeBytes: 3 },
        { originalFilename: "logo.png", mimeType: "image/png", contentBytes: Buffer.from("image"), sizeBytes: 5, isInline: true, contentId: "logo" }
      ] };
    const mime = buildReplyMime(input, "<id@example.test>", "boundary");
    expect(mime).toContain("Content-Type: multipart/related");
    expect(mime).toContain("Content-Type: multipart/alternative");
    expect(mime).toContain("Content-Disposition: inline;");
    expect(mime).toContain("Content-Disposition: attachment;");
    expect(mime).toContain("Content-ID: <logo>");
    expect(mime).toContain("AP8K");
    expect(mime).not.toContain("\r\nBcc:");
    expect(mime).toContain("Dise%C3%B1o");
    expect(mime.split("\r\n").every((line) => line.length < 998)).toBe(true);
    const subject = mime.match(/Subject: ([\s\S]*?)\r\nMessage-ID:/)![1];
    const decoded = [...subject.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) => Buffer.from(m[1], "base64").toString()).join("");
    expect(decoded).toBe(input.subject);
    expect(mime.replace(/\r\n/g, "")).toContain(Buffer.from(input.bodyHtml).toString("base64"));
  });
});

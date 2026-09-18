import { HtmlSanitizerService } from "./html-sanitizer.service";

describe("HtmlSanitizerService", () => {
  const sanitizer = new HtmlSanitizerService();

  it("removes scripts and protects outbound links", () => {
    const result = sanitizer.sanitize('<p>Hello<script>alert(1)</script><a href="https://example.com">Open</a></p>');

    expect(result).not.toContain("<script");
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it("preserves email table dimensions while removing nowrap and active content", () => {
    const result = sanitizer.sanitizeEmail(
      '<table width="1800" style="width:1800px;white-space:nowrap;color:#123456;position:fixed"><tr><td width="1600"><a href="https://example.com" onclick="bad()">SafeLink</a><script>bad()</script></td></tr></table>'
    );

    expect(result).toContain('width="1800"');
    expect(result).toContain('width="1600"');
    expect(result).toContain("width:1800px");
    expect(result).not.toContain("white-space:nowrap");
    expect(result).not.toContain("position");
    expect(result).not.toContain("bad()");
    expect(result).toContain("color:#123456");
    expect(result).toContain("SafeLink");
  });

  it("retains signature columns, spacer and Outlook borders through repeated sanitization", () => {
    const html = '<table style="width:500px;max-width:100%"><tr><td style="width:143px;border-right:0.75pt solid #123456">Photo</td><td width="26" style="width:26px"></td><td style="width:331px;padding:0px">Contact</td></tr></table>';
    const result = sanitizer.sanitizeEmail(sanitizer.sanitize(html));
    expect(result).toContain("width:500px");
    expect(result).toContain("width:143px");
    expect(result).toContain('width="26"');
    expect(result).toContain("width:26px");
    expect(result).toContain("width:331px");
    expect(result).toContain("border-right:0.75pt solid #123456");
    expect(sanitizer.sanitizeEmail(result)).toBe(result);
  });

  it("rejects unsafe styles, URLs and elements when formatting historical HTML", () => {
    const result = sanitizer.sanitizeEmail('<style>body{display:none}</style><iframe src="https://example.com"></iframe><img src="javascript:bad()" onerror="bad()"><a href="javascript:bad()">Link</a><div style="width:expression(bad());max-width:url(https://example.com);background-image:url(https://example.com);position:fixed;display:none;border:1px solid red">Text</div>');
    expect(result).not.toMatch(/bad\(|javascript|onerror|iframe|<style|expression|url\(|position|display:/);
    expect(result).toContain("border:1px solid red");
    expect(result).toContain("Text");
  });
});

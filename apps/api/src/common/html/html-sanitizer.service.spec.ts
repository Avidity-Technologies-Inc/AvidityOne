import { HtmlSanitizerService } from "./html-sanitizer.service";

describe("HtmlSanitizerService", () => {
  const sanitizer = new HtmlSanitizerService();

  it("removes scripts and protects outbound links", () => {
    const result = sanitizer.sanitize('<p>Hello<script>alert(1)</script><a href="https://example.com">Open</a></p>');

    expect(result).not.toContain("<script");
    expect(result).toContain('rel="noopener noreferrer"');
    expect(result).toContain('target="_blank"');
  });

  it("removes layout-breaking email widths and nowrap while preserving safe formatting", () => {
    const result = sanitizer.sanitizeEmail(
      '<table width="1800" style="width:1800px;white-space:nowrap;color:#123456"><tr><td width="1600"><a href="https://example.com">SafeLink</a></td></tr></table>'
    );

    expect(result).not.toContain('width="1800"');
    expect(result).not.toContain('width="1600"');
    expect(result).not.toContain("width:1800px");
    expect(result).not.toContain("white-space:nowrap");
    expect(result).toContain("color:#123456");
    expect(result).toContain("SafeLink");
  });
});

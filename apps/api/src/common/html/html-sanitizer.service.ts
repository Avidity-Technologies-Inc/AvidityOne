import { Injectable } from "@nestjs/common";
import sanitizeHtml from "sanitize-html";

const CSS_LENGTH = /^(0|\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%))$/;
const CSS_BOX = /^(0|\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%))(\s+(0|\d{1,4}(\.\d{1,2})?(px|pt|em|rem|%))){0,3}$/;
const CSS_COLOR = /^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\)|[a-zA-Z]+)$/;
const CSS_BORDER = new RegExp(`^\\d{1,3}px\\s+(solid|dashed|dotted)\\s+(${CSS_COLOR.source.slice(2, -2)})$`);
const CSS_FONT_FAMILY = /^[a-zA-Z0-9\s"',._-]+$/;

@Injectable()
export class HtmlSanitizerService {
  sanitize(input: string | null | undefined): string {
    return this.sanitizeContent(input, false);
  }

  sanitizeEmail(input: string | null | undefined): string {
    return this.sanitizeContent(input, true);
  }

  private sanitizeContent(input: string | null | undefined, emailSafe: boolean): string {
    if (!input) {
      return "";
    }

    return sanitizeHtml(input, {
      allowedTags: [
        "p",
        "h1",
        "h2",
        "h3",
        "br",
        "strong",
        "b",
        "em",
        "i",
        "u",
        "s",
        "ol",
        "ul",
        "li",
        "blockquote",
        "code",
        "pre",
        "a",
        "span",
        "div",
        "table",
        "thead",
        "tbody",
        "tfoot",
        "tr",
        "td",
        "th",
        "small",
        "font",
        "img"
      ],
      allowedAttributes: {
        "*": ["style", "align"],
        a: ["href", "name", "target", "rel", "title", "style"],
        img: ["src", "alt", "title", "width", "height", "data-attachment-id", "style"],
        table: [...(emailSafe ? [] : ["width", "height"]), "cellpadding", "cellspacing", "border", "role", "align", "style"],
        td: [...(emailSafe ? [] : ["width", "height"]), "valign", "align", "colspan", "rowspan", "style"],
        th: [...(emailSafe ? [] : ["width", "height"]), "valign", "align", "colspan", "rowspan", "style"],
        font: ["face", "size", "color", "style"]
      },
      allowedStyles: {
        "*": {
          color: [CSS_COLOR],
          "background-color": [CSS_COLOR],
          "font-family": [CSS_FONT_FAMILY],
          "font-size": [CSS_LENGTH],
          "font-style": [/^(normal|italic)$/],
          "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
          "line-height": [/^(normal|\d{1,3}(\.\d{1,2})?(px|pt|em|rem|%)?)$/],
          "text-align": [/^(left|right|center|justify)$/],
          "text-decoration": [/^(none|underline|line-through)$/],
          "vertical-align": [/^(top|middle|bottom|baseline)$/],
          ...(emailSafe ? {} : {
            "white-space": [/^(normal|nowrap|pre|pre-wrap|pre-line)$/],
            display: [/^(block|inline|inline-block|table|table-row|table-cell)$/],
            width: [CSS_LENGTH],
            height: [CSS_LENGTH],
            "max-width": [CSS_LENGTH]
          }),
          margin: [CSS_BOX],
          "margin-top": [CSS_LENGTH],
          "margin-right": [CSS_LENGTH],
          "margin-bottom": [CSS_LENGTH],
          "margin-left": [CSS_LENGTH],
          padding: [CSS_BOX],
          "padding-top": [CSS_LENGTH],
          "padding-right": [CSS_LENGTH],
          "padding-bottom": [CSS_LENGTH],
          "padding-left": [CSS_LENGTH],
          "border-left": [CSS_BORDER],
          "border-right": [CSS_BORDER],
          "border-top": [CSS_BORDER],
          "border-bottom": [CSS_BORDER]
        }
      },
      allowedSchemes: ["http", "https", "mailto", "cid"],
      transformTags: {
        a: sanitizeHtml.simpleTransform("a", {
          rel: "noopener noreferrer",
          target: "_blank"
        })
      }
    });
  }
}

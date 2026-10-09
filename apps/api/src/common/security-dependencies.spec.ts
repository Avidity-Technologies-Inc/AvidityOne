import { Controller, INestApplication, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Workbook } from "exceljs";
import sharp from "sharp";
import { singleFileUploadOptions } from "../modules/file-storage/upload-limits";
import { HtmlSanitizerService } from "./html/html-sanitizer.service";

@Controller("upload")
class UploadProbe {
  @Post()
  @UseInterceptors(FileInterceptor("file", singleFileUploadOptions(16)))
  upload(@UploadedFile() file: {originalname: string; buffer: Buffer}) {
    return {name: file.originalname, text: file.buffer.toString()};
  }
}

describe("Security dependency compatibility", () => {
  let app: INestApplication;
  let base: string;
  beforeAll(async () => {
    const module = await Test.createTestingModule({controllers:[UploadProbe]}).compile();
    app = module.createNestApplication({logger:false});
    await app.listen(0,"127.0.0.1"); base = await app.getUrl();
  });
  afterAll(async () => { await app?.close(); });

  it("preserves buffered uploads through the real Nest interceptor", async () => {
    const form = new FormData(); form.append("file",new Blob(["safe document"]),"example.txt");
    const response = await fetch(`${base}/upload`,{method:"POST",body:form});
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({name:"example.txt",text:"safe document"});
  });

  it.each(["size","fields","extra-file"])("keeps the %s upload boundary", async mode => {
    const form = new FormData();
    form.append("file",new Blob([mode === "size" ? "x".repeat(17) : "safe"]),"example.txt");
    if(mode === "fields") form.append("unwanted[1]","value");
    if(mode === "extra-file") form.append("file",new Blob(["second"]),"second.txt");
    const response = await fetch(`${base}/upload`,{method:"POST",body:form});
    expect(response.status).toBe(mode === "size" ? 413 : 400);
  });

  it("retains signature layout while rejecting advisory-related active HTML", () => {
    const sanitizer = new HtmlSanitizerService();
    const html='<table width="500"><tr><td><img src="cid:signature" width="80"></td><td style="color:#123456">Contact</td></tr></table>';
    const result=sanitizer.sanitizeEmail(html+'<textarea></textarea/><img src=x onerror="bad()"><svg><animate attributeName="href" values="#safe;javascript:bad()"/></svg><form action="javascript:bad()">bad form</form>');
    expect(result).toContain('width="500"'); expect(result).toContain('src="cid:signature"'); expect(result).toContain('color:#123456');
    expect(result).not.toMatch(/onerror|javascript:|<textarea|<svg|<animate|<form/);
  });

  it.each(["png","jpeg","avif"] as const)("preserves valid %s image decoding and report-logo resizing", async format => {
    const source=await sharp({create:{width:64,height:32,channels:3,background:"#155eef"}}).toFormat(format).toBuffer();
    const logo=await sharp(source).resize({width:600,height:200,fit:"inside",withoutEnlargement:true}).png().toBuffer();
    const metadata=await sharp(logo).metadata();
    expect(metadata.format).toBe("png"); expect(metadata.width).toBe(64); expect(metadata.height).toBe(32);
  });

  it("preserves safe SVG logo decoding with the patched native renderer", async () => {
    const source = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#155eef"/></svg>');
    const image = await sharp(source).resize({ width: 32 }).png().toBuffer();
    const metadata = await sharp(image).metadata();
    expect(metadata.width).toBe(32);
    expect(metadata.height).toBe(16);
  });

  it("round-trips Excel extended conditional formatting through the UUID consumer", async () => {
    const book=new Workbook(); const sheet=book.addWorksheet("Quality");
    [10,50,90].forEach(value=>sheet.addRow([value]));
    sheet.addConditionalFormatting({ref:"A1:A3",rules:[{type:"iconSet",priority:1,iconSet:"3Stars",cfvo:[{type:"percent",value:0},{type:"percent",value:33},{type:"percent",value:67}]}]});
    const bytes=await book.xlsx.writeBuffer(); const restored=new Workbook(); await restored.xlsx.load(bytes);
    expect(restored.getWorksheet("Quality")!.getCell("A3").value).toBe(90);
    expect((restored.getWorksheet("Quality")! as unknown as {conditionalFormattings: Array<{rules: Array<{iconSet: string}>}>}).conditionalFormattings[0].rules[0].iconSet).toBe("3Stars");
  });
});

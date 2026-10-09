/**
 * DEVELOPMENT demo helper. Renders clearly-marked SPECIMEN identity cards for
 * walking through Screen 3, plus files the server is expected to reject.
 * Every card says it is not a real document; nothing here imitates a real
 * government ID design.
 *
 *   npx tsx scripts/demo-samples.ts          # writes demo/samples/*
 *
 * Each file is checked with the same server validator used by the upload API.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { validateDocument } from "@/server/identity/file-validation";

const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = join(process.cwd(), "demo", "samples");

const card = (width: number, height: number) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${width}px; height: ${height}px; font-family: "Segoe UI", Arial, sans-serif;
         background: #eef3f1; display: grid; place-items: center; }
  .card { width: ${width - 40}px; height: ${height - 40}px; border-radius: 22px; overflow: hidden;
          background: linear-gradient(135deg, #ffffff 0%, #e6f4ee 100%);
          border: 2px solid #0f7a55; position: relative; box-shadow: 0 6px 24px rgba(17,30,56,.15); }
  .top { background: #111e38; color: #fff; padding: 18px 28px; display: flex;
         justify-content: space-between; align-items: center; }
  .top h1 { font-size: 26px; letter-spacing: .5px; }
  .top span { font-size: 15px; background: #0f7a55; padding: 6px 12px; border-radius: 999px; }
  .body { display: flex; gap: 32px; padding: 28px; }
  .photo { width: 190px; height: 230px; border-radius: 14px; background: #cfd8e3;
           display: grid; place-items: end center; overflow: hidden; flex: none; }
  .head { width: 92px; height: 92px; border-radius: 50%; background: #8a9bb3; margin-bottom: -6px; }
  .shoulders { width: 170px; height: 90px; border-radius: 85px 85px 0 0; background: #8a9bb3; }
  dl { display: grid; grid-template-columns: 170px 1fr; row-gap: 14px; font-size: 21px; color: #111e38; }
  dt { color: #5b6b82; font-weight: 600; }
  dd { font-weight: 700; }
  .stamp { position: absolute; right: -50px; bottom: 120px; transform: rotate(-24deg);
           border: 5px solid rgba(200,30,30,.55); color: rgba(200,30,30,.6); font-size: 44px;
           font-weight: 800; padding: 6px 90px; letter-spacing: 6px; }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; padding: 12px 28px; font-size: 15px;
          color: #5b6b82; background: rgba(15,122,85,.08); }
</style></head><body><div class="card">
  <div class="top"><h1>KODEVERSITY DEMO IDENTITY CARD</h1><span>SPECIMEN</span></div>
  <div class="body">
    <div class="photo"><div><div class="head" style="margin:0 auto"></div><div class="shoulders"></div></div></div>
    <dl>
      <dt>Name</dt><dd>Jaydeep Das</dd>
      <dt>Roll number</dt><dd>123456789</dd>
      <dt>Date of birth</dt><dd>01 Jan 2000</dd>
      <dt>ID number</dt><dd>DEMO-0000-0000</dd>
      <dt>Valid until</dt><dd>31 Dec 2030</dd>
    </dl>
  </div>
  <div class="stamp">NOT VALID</div>
  <div class="foot">For KProctor demonstrations only. Not a government document. All details are fictitious.</div>
</div></body></html>`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1000, height: 620 });
    await page.setContent(card(1000, 620));
    writeFileSync(join(OUT, "demo-id-card.png"), await page.screenshot({ type: "png" }));
    writeFileSync(
      join(OUT, "demo-id-card.jpg"),
      await page.screenshot({ type: "jpeg", quality: 90 }),
    );
    writeFileSync(
      join(OUT, "demo-id-card.pdf"),
      await page.pdf({ width: "1000px", height: "620px", printBackground: true, pageRanges: "1" }),
    );

    // Expected rejections: too small to read, and a text file renamed to .png.
    await page.setViewport({ width: 240, height: 150 });
    await page.setContent(card(240, 150));
    writeFileSync(join(OUT, "reject-too-small.png"), await page.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }
  writeFileSync(join(OUT, "reject-renamed-text.png"), "This is a text file renamed to .png\n");

  const files: [string, string, string][] = [
    ["demo-id-card.png", "image/png", "png"],
    ["demo-id-card.jpg", "image/jpeg", "jpg"],
    ["demo-id-card.pdf", "application/pdf", "pdf"],
    ["reject-too-small.png", "image/png", "png"],
    ["reject-renamed-text.png", "image/png", "png"],
  ];
  const { readFileSync } = await import("node:fs");
  for (const [name, mime, ext] of files) {
    const bytes = new Uint8Array(readFileSync(join(OUT, name)));
    try {
      const r = validateDocument({ bytes, declaredMime: mime, declaredExtension: ext });
      console.log(`ACCEPTED  ${name} (${r.fileType}, ${bytes.length} bytes)`);
    } catch (err) {
      console.log(`REJECTED  ${name}: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

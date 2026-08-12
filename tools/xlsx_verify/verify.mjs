// 校验导出的对账 Excel：读取 -> 结构检查 -> 渲染 PNG
// 用法: node verify.mjs <xlsx路径> <输出目录>
import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = process.argv[2] || "/tmp/export_test.xlsx";
const outDir = process.argv[3] || "/tmp/xlsx_render";
await fs.mkdir(outDir, { recursive: true });

const input = await FileBlob.load(inputPath);
const workbook = await SpreadsheetFile.importXlsx(input);

const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 5000,
  tableMaxRows: 8,
  tableMaxCols: 14,
});
console.log("=== summary ===");
console.log(summary.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "formula error scan",
});
console.log("=== formula errors ===");
console.log(errors.ndjson || "(none)");

for (const sheetName of ["对账清单", "每日汇总"]) {
  const png = await workbook.render({ sheetName, scale: 2, format: "png" });
  const safe = sheetName === "对账清单" ? "list" : "daily";
  const buf = png instanceof Uint8Array ? Buffer.from(png) : Buffer.from(await png.arrayBuffer());
  await fs.writeFile(`${outDir}/${safe}.png`, buf);
  console.log("rendered:", sheetName);
}

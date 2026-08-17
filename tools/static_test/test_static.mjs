// 静态版核心逻辑测试：解析 + Excel 导出（含图片嵌入）
import fs from "node:fs/promises";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SITE = path.join(ROOT, "static-site");

const XLSX = (await import("xlsx")).default;
const JSZip = (await import("jszip")).default;

globalThis.__lastBlob = null;

const ctx = {
  console,
  XLSX,
  JSZip,
  setTimeout,
  clearTimeout,
  atob,
  Blob,
  Uint8Array,
  navigator: {},
  URL: {
    createObjectURL: (b) => {
      globalThis.__lastBlob = b;
      return "blob:test";
    },
    revokeObjectURL: () => {},
  },
  document: {
    createElement: () => ({
      click() {},
      style: {},
      set href(v) {},
      get href() {
        return "";
      },
    }),
    body: {
      appendChild() {},
      removeChild() {},
    },
  },
};
ctx.window = ctx;
vm.createContext(ctx);

const storageSrc = await fs.readFile(path.join(SITE, "storage.js"), "utf8");
vm.runInContext(storageSrc, ctx);

// ---- 1. 剪贴板解析 ----
const sample = await fs.readFile(path.join(ROOT, "tests/sample_paste.txt"), "utf8");
const parsed = ctx.parsePasteText(sample);
const f = parsed.fields;
const checks = [
  ["truck_no", f.truck_no, "冀J0B318"],
  ["trailer_no", f.trailer_no, "冀JM09D挂"],
  ["gas_source", f.gas_source, "正安"],
  ["supplier", f.supplier, "浙江禾兴"],
  ["station", f.station, "宜章西东站"],
  ["plan_arrive", f.plan_arrive, "2026-08-13T19:00"],
  ["price", f.price, 5900],
  ["driver_name", f.driver_name, "余佑江"],
  ["load_date", f.load_date, "2026-08-12"],
];
let fail = 0;
for (const [name, got, want] of checks) {
  const ok = String(got) === String(want);
  console.log(`${ok ? "✓" : "✗"} ${name}: ${got} ${ok ? "" : `(期望 ${want})`}`);
  if (!ok) fail++;
}
console.log("note:", f.note);

// ---- 1.1 首行“气源地-站点”无日期时也应拆分 ----
const routeOnly = ctx.parsePasteText("正安-宜章西东站A\n冀J0B318").fields;
for (const [name, got, want] of [
  ["route gas_source", routeOnly.gas_source, "正安"],
  ["route station", routeOnly.station, "宜章西东站A"],
]) {
  const ok = String(got) === want;
  console.log(`${ok ? "✓" : "✗"} ${name}: ${got} ${ok ? "" : `(期望 ${want})`}`);
  if (!ok) fail++;
}

// ---- 2. Excel 导出（含图片） ----
const loadPng = async (n) => fs.readFile(path.join(ROOT, "tests/images", n));

const plans = [
  {
    id: "t1",
    load_date: "2026-08-12",
    truck_no: "冀J0B318",
    gas_source: "正安",
    supplier: "浙江禾兴",
    station: "宜章西东站",
    plan_arrive: "2026-08-13T19:00",
    price: 5900,
    net_weight: 31.22,
    amount: 184198,
    note: "测试",
    complete: true,
    images: {
      load: { blob: await loadPng("load.png"), type: "image/png" },
      unload: { blob: await loadPng("unload.png"), type: "image/png" },
      waybill: { blob: await loadPng("waybill.png"), type: "image/png" },
    },
  },
];

const excelSrc = await fs.readFile(path.join(SITE, "excel.js"), "utf8");
vm.runInContext(excelSrc, ctx);
await ctx.exportXlsx(plans, "2026-08-12", "2026-08-12");

if (!globalThis.__lastBlob) {
  console.log("✗ 未生成导出文件");
  process.exit(1);
}
const buf = Buffer.from(await globalThis.__lastBlob.arrayBuffer());
await fs.writeFile("/tmp/static_export_test.xlsx", buf);
console.log(`✓ 导出 xlsx 生成：${buf.length} bytes`);

// ---- 3. 匹配候选 ----
const cands = ctx.findCandidates(plans, "冀J0B318", "2026-08-12");
console.log(`${cands.length === 1 ? "✓" : "✗"} findCandidates: ${cands.length} 个`);

console.log(fail ? `\n${fail} 项失败` : "\n全部通过");
process.exit(fail ? 1 : 0);

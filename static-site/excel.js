/* 浏览器端 Excel 导出：SheetJS 生成数据 + JSZip 注入图片 */
"use strict";

const XL_HEADERS = [
  "气源地", "装车日期", "车号", "供应商", "站点", "计划到站日期",
  "价格(元/吨)", "装车磅单", "卸车磅单", "运单",
  "净重(吨)", "金额(元)", "备注",
];

function excelSerial(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const dt = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  return Math.floor(dt / 86400000) + 25569;
}

function setCell(ws, r, c, value, z) {
  if (value === null || value === undefined || value === "") {
    delete ws[XLSX.utils.encode_cell({ r, c })];
    return;
  }
  const addr = XLSX.utils.encode_cell({ r, c });
  ws[addr] = { t: typeof value === "number" ? "n" : "s", v: value, z: z || "General" };
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 300);
}

function buildSheets(plans, fromDate, toDate) {
  const wb = XLSX.utils.book_new();

  // 对账清单
  const aoa = [XL_HEADERS.slice()];
  let totalWeight = 0;
  let totalAmount = 0;
  for (const p of plans) {
    const price = Number(p.price) || 0;
    const weight = Number(p.net_weight) || 0;
    const amount = price && weight ? Math.round(price * weight * 100) / 100 : null;
    totalWeight += weight;
    totalAmount += amount || 0;
    aoa.push([
      p.gas_source || "", p.load_date || "", p.truck_no || "", p.supplier || "",
      p.station || "", p.plan_arrive || "", price || null, null, null, null,
      weight || null, amount, p.note || "",
    ]);
  }
  if (plans.length) {
    aoa.push([
      null, null, `合计 ${plans.length} 车`, null, null, null, null, null, null, null,
      Math.round(totalWeight * 100) / 100 || null,
      Math.round(totalAmount * 100) / 100 || null,
      null,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const nrows = aoa.length;
  for (let r = 1; r < nrows; r++) {
    const s = excelSerial(aoa[r][1]);
    if (s !== null) setCell(ws, r, 1, s, "yyyy-mm-dd");
    const s2 = excelSerial(aoa[r][5]);
    if (s2 !== null) setCell(ws, r, 5, s2, "yyyy-mm-dd");
    setCell(ws, r, 6, aoa[r][6] || null, "#,##0");
    setCell(ws, r, 10, aoa[r][10] || null, "#,##0.00");
    setCell(ws, r, 11, aoa[r][11] || null, "#,##0.00");
  }
  ws["!cols"] = [12, 12, 12, 12, 14, 12, 11, 13, 13, 13, 10, 12, 28].map((wch) => ({ wch }));
  const rowsMeta = [];
  for (let r = 1; r < nrows; r++) rowsMeta[r] = { hpt: 72 };
  ws["!rows"] = rowsMeta;
  XLSX.utils.book_append_sheet(wb, ws, "对账清单");

  // 每日汇总
  const dayMap = {};
  for (const p of plans) {
    const d = (p.load_date || "").slice(0, 10);
    (dayMap[d] = dayMap[d] || []).push(p);
  }
  const h2 = ["日期", "车数", "单据齐全", "缺装车磅单", "缺卸车磅单", "缺运单", "金额合计(元)"];
  const aoa2 = [h2];
  let grand = 0;
  for (const d of Object.keys(dayMap).sort()) {
    const ps = dayMap[d];
    grand += ps.length;
    aoa2.push([
      d, ps.length,
      ps.filter((x) => x.complete).length,
      ps.filter((x) => !x.images.load).length,
      ps.filter((x) => !x.images.unload).length,
      ps.filter((x) => !x.images.waybill).length,
      Math.round(ps.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.net_weight) || 0), 0) * 100) / 100,
    ]);
  }
  aoa2.push([null, grand]);
  const ws2 = XLSX.utils.aoa_to_sheet(aoa2);
  for (let r = 1; r < aoa2.length; r++) {
    const s = excelSerial(aoa2[r][0]);
    if (s !== null) setCell(ws2, r, 0, s, "yyyy-mm-dd");
    setCell(ws2, r, 6, aoa2[r][6] || null, "#,##0.00");
  }
  ws2["!cols"] = [12, 10, 10, 12, 12, 10, 13].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws2, "每日汇总");

  return wb;
}

async function injectImages(zip, plans) {
  const media = []; // {fname, blob}
  const anchors = []; // {col,row,rId}
  plans.forEach((p, i) => {
    const excelRow = i + 2; // 1-based 数据行
    const row0 = excelRow - 1; // 0-based
    for (const [col0, type] of [[7, "load"], [8, "unload"], [9, "waybill"]]) {
      const img = p.images && p.images[type];
      if (img && img.blob) {
        const ext = (img.type || "").includes("png") ? "png" : "jpg";
        media.push({ fname: `image${media.length + 1}.${ext}`, blob: img.blob });
        anchors.push({ col: col0, row: row0, rId: `rId${anchors.length + 1}` });
      }
    }
  });
  if (!media.length) return;

  for (const m of media) {
    zip.file(`xl/media/${m.fname}`, m.blob);
  }

  const picXml = anchors
    .map(
      (a, i) =>
        `<xdr:twoCellAnchor editAs="oneCell">
          <xdr:from><xdr:col>${a.col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
          <xdr:to><xdr:col>${a.col + 1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${a.row + 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
          <xdr:pic>
            <xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="Picture ${i + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
            <xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${a.rId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
            <xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="135000" cy="93000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
          </xdr:pic>
          <xdr:clientData/>
        </xdr:twoCellAnchor>`
    )
    .join("");
  const drawingXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    picXml +
    "</xdr:wsDr>";
  zip.file("xl/drawings/drawing1.xml", drawingXml);

  let sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  if (!sheetXml.includes("<drawing")) {
    sheetXml = sheetXml.replace(/<\/worksheet>/, '<drawing r:id="rIdDrw"/></worksheet>');
  }
  zip.file("xl/worksheets/sheet1.xml", sheetXml);

  const relsPath = "xl/worksheets/_rels/sheet1.xml.rels";
  let relsXml = "";
  const existingRels = zip.file(relsPath);
  if (existingRels) relsXml = await existingRels.async("string");
  if (!relsXml.includes('Id="rIdDrw"')) {
    const rel =
      '<Relationship Id="rIdDrw" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
    if (relsXml) {
      relsXml = relsXml.replace(/<\/Relationships>/, rel + "</Relationships>");
    } else {
      relsXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        rel +
        "</Relationships>";
    }
    zip.file(relsPath, relsXml);
  }

  const dRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    anchors
      .map(
        (a, i) =>
          `<Relationship Id="${a.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${media[i].fname}"/>`
      )
      .join("") +
    "</Relationships>";
  zip.file("xl/drawings/_rels/drawing1.xml.rels", dRels);

  let ct = await zip.file("[Content_Types].xml").async("string");
  if (!ct.includes('Extension="png"')) {
    ct = ct.replace(/<\/Types>/, '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  if (!ct.includes('Extension="jpg"')) {
    ct = ct.replace(/<\/Types>/, '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  }
  if (!ct.includes("/xl/drawings/drawing1.xml")) {
    ct = ct.replace(
      /<\/Types>/,
      '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'
    );
  }
  zip.file("[Content_Types].xml", ct);
}

async function exportXlsx(plans, fromDate, toDate) {
  if (!window.XLSX || !window.JSZip) {
    throw new Error("导出组件未加载，请检查网络后刷新页面");
  }
  const wb = buildSheets(plans, fromDate, toDate);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const zip = await JSZip.loadAsync(out);
  await injectImages(zip, plans);
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const label = `${fromDate || "全部"}_${toDate || "全部"}`;
  download(blob, `对账清单_${label}.xlsx`);
}

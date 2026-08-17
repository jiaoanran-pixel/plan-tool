/* 车辆计划对账系统（静态版）- 前端逻辑 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const DOC_LABEL = { load: "装车磅单", unload: "卸车磅单", waybill: "运单" };

const state = {
  allPlans: [],
  plans: [],
  filterFrom: monthStart(),
  filterTo: todayStr(),
  query: "",
  filterStatus: "",
  editingId: null,
  formImages: {},
  ocr: {
    b64: null,
    parsed: null,
    candidates: [],
    selectedPlanId: null,
    docType: "",
  },
};

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function monthStart() {
  return todayStr().slice(0, 8) + "01";
}

function monthStr() {
  return todayStr().slice(0, 7);
}

function toast(msg, type = "info") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = "toast hidden"), 3200);
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "";
}

function fmtArrive(v) {
  if (!v) return "";
  return String(v).replace("T", " ");
}

function toLocalValue(v) {
  if (!v) return "";
  const s = String(v);
  if (s.includes("T")) return s;
  return s + "T00:00";
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

/* ---------------- 视图切换 ---------------- */
function switchView(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $("#view-plans").classList.toggle("hidden", name !== "plans");
  $("#view-recon").classList.toggle("hidden", name !== "recon");
  if (name === "recon") loadRecon();
}

/* ---------------- 计划列表 ---------------- */
function filterPlans() {
  let rows = state.allPlans.slice();
  if (state.filterFrom) rows = rows.filter((p) => (p.plan_arrive || "").slice(0, 10) >= state.filterFrom);
  if (state.filterTo) rows = rows.filter((p) => (p.plan_arrive || "").slice(0, 10) <= state.filterTo);
  if (state.filterStatus === "ok") rows = rows.filter((p) => p.complete);
  else if (state.filterStatus === "missing") rows = rows.filter((p) => !p.complete);
  if (state.query) {
    const q = state.query.toLowerCase();
    rows = rows.filter(
      (p) =>
        [p.truck_no, p.gas_source, p.supplier, p.station, p.driver_name, p.note]
          .join(" ")
          .toLowerCase()
          .includes(q)
    );
  }
  return rows.sort((a, b) => {
    const d = (b.plan_arrive || "").localeCompare(a.plan_arrive || "");
    return d !== 0 ? d : (b.created_at || "").localeCompare(a.created_at || "");
  });
}

async function loadPlans() {
  state.allPlans = await Storage.loadPlans();
  state.plans = filterPlans();
  renderPlans();
  renderPlanChips();
}

function renderPlanChips() {
  const total = state.plans.length;
  const complete = state.plans.filter((p) => p.complete).length;
  const missing = state.plans.filter((p) => !p.complete).length;
  $("#planChips").innerHTML = `
    <div class="chip">共 <b>${total}</b> 车</div>
    <div class="chip ok">资料齐全 <b>${complete}</b></div>
    <div class="chip warn">待补充 <b>${missing}</b></div>`;
}

function thumbHTML(img, label) {
  if (!img) return `<div class="thumb empty">${label}</div>`;
  return `<div class="thumb"><img src="${esc(img.url)}" alt="${esc(label)}" loading="lazy"><span>${label}</span></div>`;
}

function planCardHTML(p) {
  const imgs = p.images || {};
  const missTxt = p.complete
    ? "资料齐全"
    : `缺：${p.missing.map((k) => DOC_LABEL[k]).join("、")}`;
  const amount =
    p.price && p.net_weight
      ? `<span class="amount">¥${fmtPrice((Number(p.price) * Number(p.net_weight)).toFixed(2))}</span>`
      : "";
  return `
  <div class="card ${p.complete ? "ok" : "warn"}">
    <div class="card-head">
      <div class="card-title">
        <span class="truck">${esc(p.truck_no)}</span>
        <span class="date">${esc(p.load_date)}</span>
      </div>
      <span class="badge ${p.complete ? "badge-ok" : "badge-warn"}">${p.complete ? "已齐全" : "待补充"}</span>
    </div>
    <div class="card-body">
      <div class="kv"><span>气源地</span><b>${esc(p.gas_source) || "—"}</b></div>
      <div class="kv"><span>供应商</span><b>${esc(p.supplier) || "—"}</b></div>
      <div class="kv"><span>站点</span><b>${esc(p.station) || "—"}</b></div>
      <div class="kv"><span>到站</span><b>${esc(fmtArrive(p.plan_arrive)) || "—"}</b></div>
      <div class="kv"><span>价格</span><b>${fmtPrice(p.price) || "—"}</b></div>
      <div class="kv"><span>净重</span><b>${p.net_weight ? p.net_weight + " t" : "—"}</b></div>
      ${amount ? `<div class="kv"><span>金额</span><b>${amount}</b></div>` : ""}
    </div>
    <div class="card-imgs">
      ${thumbHTML(imgs.load, "装车磅单")}
      ${thumbHTML(imgs.unload, "卸车磅单")}
      ${thumbHTML(imgs.waybill, "运单")}
    </div>
    <div class="card-foot">
      <span class="miss ${p.complete ? "ok" : ""}">${missTxt}</span>
      <div class="card-actions">
        <button class="mini" data-act="copy" data-id="${p.id}">复制</button>
        <button class="mini" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="mini danger" data-act="del" data-id="${p.id}">删除</button>
      </div>
    </div>
  </div>`;
}

function renderPlans() {
  const list = $("#planList");
  if (!state.plans.length) {
    list.innerHTML = `<div class="empty-tip">
      当前日期范围没有计划。可以<a href="#" data-act="showmonth">查看本月</a>或
      <a href="#" data-act="showall">查看全部计划</a>；
      也可以点右上角"新增计划"，或"识别上传"直接拍照归档。
    </div>`;
    return;
  }
  list.innerHTML = state.plans.map(planCardHTML).join("");
}

function findPlan(id) {
  return (
    state.plans.find((x) => x.id === id) ||
    state.allPlans.find((x) => x.id === id)
  );
}

function includeDateInFilter(d) {
  if (!d) return;
  if (!state.filterFrom || d < state.filterFrom) state.filterFrom = d;
  if (!state.filterTo || d > state.filterTo) state.filterTo = d;
  $("#filterFrom").value = state.filterFrom;
  $("#filterTo").value = state.filterTo;
}

function setMonthFilter() {
  state.filterFrom = monthStart();
  state.filterTo = todayStr();
  $("#filterFrom").value = state.filterFrom;
  $("#filterTo").value = state.filterTo;
}

function clearFilter() {
  state.filterFrom = "";
  state.filterTo = "";
  state.filterStatus = "";
  $("#filterFrom").value = "";
  $("#filterTo").value = "";
  $("#filterStatus").value = "";
}

/* ---------------- 复制 ---------------- */
function planCopyText(p) {
  const lines = [
    "【运输计划】",
    `装车日期：${p.load_date}`,
    `车号：${p.truck_no}${p.trailer_no ? `（挂车：${p.trailer_no}）` : ""}`,
  ];
  if (p.gas_source) lines.push(`气源地：${p.gas_source}`);
  if (p.supplier) lines.push(`供应商：${p.supplier}`);
  if (p.station) lines.push(`站点：${p.station}`);
  if (p.plan_arrive) lines.push(`计划到站：${fmtArrive(p.plan_arrive)}`);
  if (p.price) lines.push(`价格：${p.price} 元/吨`);
  if (p.net_weight) lines.push(`净重：${p.net_weight} 吨`);
  if (p.amount) lines.push(`金额：${Number(p.amount).toLocaleString("zh-CN")} 元`);
  if (p.driver_name) {
    lines.push(`司机：${p.driver_name}${p.driver_phone ? ` ${p.driver_phone}` : ""}`);
  }
  const imgs = p.images || {};
  lines.push(
    `单据：装车磅单${imgs.load ? "✓" : "✗"} 卸车磅单${imgs.unload ? "✓" : "✗"} 运单${imgs.waybill ? "✓" : "✗"}`
  );
  if (p.note) lines.push(`备注：${p.note}`);
  return lines.join("\n");
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (e) {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyPlan(id) {
  const p = findPlan(id);
  if (!p) return;
  const text = planCopyText(p);
  let ok = false;
  if (navigator.clipboard && window.isSecureContext) {
    ok = await navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text)
    );
  } else {
    ok = fallbackCopy(text);
  }
  toast(ok ? "已复制，可直接粘贴到微信" : "复制失败，请手动选择复制", ok ? "info" : "warn");
}

/* ---------------- 计划表单 ---------------- */
function openPlanForm(plan = null) {
  state.editingId = plan ? plan.id : null;
  state.formImages = {};
  $("#planModalTitle").textContent = plan ? "编辑计划" : "新增计划";
  $("#fLoadDate").value = plan?.load_date || state.filterFrom || todayStr();
  $("#fTruckNo").value = plan?.truck_no || "";
  $("#fGasSource").value = plan?.gas_source || "";
  $("#fSupplier").value = plan?.supplier || "";
  $("#fStation").value = plan?.station || "";
  $("#fPlanArrive").value = toLocalValue(plan?.plan_arrive);
  $("#fPrice").value = plan?.price ?? "";
  $("#fNetWeight").value = plan?.net_weight ?? "";
  $("#fTrailerNo").value = plan?.trailer_no || "";
  $("#fDriverName").value = plan?.driver_name || "";
  $("#fDriverPhone").value = plan?.driver_phone || "";
  $("#fCarrier").value = plan?.carrier || "";
  $("#fNote").value = plan?.note || "";
  $("#pasteText").value = "";
  $("#parseWarnings").innerHTML = "";
  ["load", "unload", "waybill"].forEach((t) => {
    const slot = $(`.img-slot[data-type="${t}"]`);
    const img = slot.querySelector(".preview");
    const url = plan?.images?.[t]?.url || "";
    if (url) {
      img.src = url;
      img.classList.remove("hidden");
      state.formImages[t] = { url, b64: null, removed: false };
    } else {
      img.classList.add("hidden");
      img.removeAttribute("src");
      state.formImages[t] = { url: "", b64: null, removed: false };
    }
    slot.querySelector(".slot-remove").classList.toggle("hidden", !url);
  });
  showModal("planModal");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function onSlotFileChange(type, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const b64 = await readFileAsDataURL(file);
  const slot = $(`.img-slot[data-type="${type}"]`);
  const img = slot.querySelector(".preview");
  img.src = b64;
  img.classList.remove("hidden");
  state.formImages[type] = { url: b64, b64, removed: false };
  slot.querySelector(".slot-remove").classList.remove("hidden");
}

function collectForm() {
  const num = (v) => {
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const payload = {
    load_date: $("#fLoadDate").value,
    truck_no: $("#fTruckNo").value.trim(),
    gas_source: $("#fGasSource").value.trim(),
    supplier: $("#fSupplier").value.trim(),
    station: $("#fStation").value.trim(),
    plan_arrive: $("#fPlanArrive").value,
    price: num($("#fPrice").value),
    net_weight: num($("#fNetWeight").value),
    trailer_no: $("#fTrailerNo").value.trim(),
    driver_name: $("#fDriverName").value.trim(),
    driver_phone: $("#fDriverPhone").value.trim(),
    carrier: $("#fCarrier").value.trim(),
    note: $("#fNote").value.trim(),
  };
  ["load", "unload", "waybill"].forEach((t) => {
    const im = state.formImages[t];
    if (!im) return;
    if (im.removed) payload[`img_${t}_b64`] = "";
    else if (im.b64) payload[`img_${t}_b64`] = im.b64;
  });
  return payload;
}

async function savePlan(e) {
  e.preventDefault();
  const payload = collectForm();
  if (!payload.load_date || !payload.truck_no || !payload.plan_arrive) {
    toast("装车日期、车号和计划到站日期必填", "warn");
    return;
  }
  const btn = $("#planForm button[type=submit]");
  btn.disabled = true;
  try {
    const saved = await Storage.upsertPlan(payload, state.editingId);
    toast(state.editingId ? "已保存" : "已新增计划");
    includeDateInFilter(saved.load_date);
    hideModal("planModal");
    await loadPlans();
    refreshRecon();
  } catch (err) {
    toast(err.message, "warn");
  } finally {
    btn.disabled = false;
  }
}

async function deletePlan(id) {
  const p = findPlan(id);
  if (!confirm(`确认删除计划 ${p?.truck_no || ""}（${p?.load_date || ""}）？删除后图片一并移除，不可恢复。`)) return;
  try {
    await Storage.deletePlan(id);
    toast("已删除");
    await loadPlans();
    refreshRecon();
  } catch (err) {
    toast(err.message, "warn");
  }
}

/* ---------------- 剪贴板识别 ---------------- */
async function parsePaste() {
  const text = $("#pasteText").value;
  if (!text.trim()) {
    toast("请先粘贴文本", "warn");
    return;
  }
  const data = parsePasteText(text);
  const f = data.fields || {};
  if (f.load_date) $("#fLoadDate").value = f.load_date;
  if (f.truck_no) $("#fTruckNo").value = f.truck_no;
  if (f.trailer_no) $("#fTrailerNo").value = f.trailer_no;
  if (f.gas_source) $("#fGasSource").value = f.gas_source;
  if (f.supplier) $("#fSupplier").value = f.supplier;
  if (f.station) $("#fStation").value = f.station;
  if (f.plan_arrive) $("#fPlanArrive").value = f.plan_arrive;
  if (f.price) $("#fPrice").value = f.price;
  if (f.driver_name) $("#fDriverName").value = f.driver_name;
  if (f.driver_phone) $("#fDriverPhone").value = f.driver_phone;
  if (f.carrier) $("#fCarrier").value = f.carrier;
  if (f.note) $("#fNote").value = f.note;
  const warns = data.warnings || [];
  $("#parseWarnings").innerHTML = warns.length
    ? warns.map((w) => `<div>⚠ ${esc(w)}</div>`).join("")
    : '<div class="ok">✓ 识别完成，请核对后保存</div>';
  toast(!f.truck_no && !f.load_date ? "未能识别出车号/日期，请手动填写" : "已识别，请核对", "warn");
}

/* ---------------- OCR 识别上传 ---------------- */
function startOcr() {
  const input = $("#ocrFile");
  input.value = "";
  input.click();
}

async function onOcrFileChange() {
  const input = $("#ocrFile");
  const file = input.files && input.files[0];
  if (!file) return;
  const b64 = await readFileAsDataURL(file);
  state.ocr.b64 = b64;
  state.ocr.parsed = null;
  state.ocr.candidates = [];
  state.ocr.selectedPlanId = null;
  $("#ocrResult").classList.add("hidden");
  $("#ocrManual").classList.add("hidden");
  $("#ocrStatus").innerHTML =
    '<div class="loading">⏳ OCR 识别中（首次使用需下载中文语言包，约 15MB，请耐心等待）…</div>';
  try {
    const text = await Ocr.recognize(b64, (p) => {
      const pct = Math.round(p * 100);
      $("#ocrStatus").innerHTML = `<div class="loading">⏳ 正在识别… ${pct}%</div>`;
    });
    const parsed = parseOcrText(text);
    state.ocr.parsed = parsed;
    state.ocr.candidates = findCandidates(state.allPlans, parsed.truck_no, parsed.load_date);
    renderOcrResult(text, parsed, state.ocr.candidates);
  } catch (err) {
    $("#ocrStatus").innerHTML = `<div class="err">自动识别失败：${esc(err.message)}。可关闭弹窗后在卡片内手动上传。</div>`;
  }
}

function renderOcrResult(text, parsed, candidates) {
  $("#ocrStatus").innerHTML = "";
  $("#ocrResult").classList.remove("hidden");
  const typeLabel = parsed.doc_type ? DOC_LABEL[parsed.doc_type] : "未能确定";
  const conf =
    parsed.doc_type_confidence === "high"
      ? "（较确定）"
      : parsed.doc_type_confidence === "medium"
        ? "（需确认）"
        : "";
  $("#ocrSummary").innerHTML = `
    <div class="sum-row"><span>单据类型</span><b>${typeLabel}${conf}</b></div>
    <div class="sum-row"><span>车号</span><b>${esc(parsed.truck_no || "未识别")}</b></div>
    <div class="sum-row"><span>装车日期</span><b>${esc(parsed.load_date || "未识别")}</b></div>
    <div class="sum-row"><span>净重</span><b>${parsed.net_weight ? parsed.net_weight + " 吨" : "未识别"}</b></div>`;
  $("#ocrText").textContent = text || "";
  state.ocr.docType = parsed.doc_type || "";
  if (parsed.doc_type) $("#ocrDocType").value = parsed.doc_type;

  const match = $("#ocrMatch");
  if (candidates.length) {
    state.ocr.selectedPlanId = candidates[0].id;
    match.innerHTML = `
      <div class="match-title">匹配到 ${candidates.length} 个计划，选择要填入的卡片：</div>
      ${candidates
        .map(
          (c) => `
          <label class="radio-row">
            <input type="radio" name="ocrPlan" value="${c.id}" ${c.id === state.ocr.selectedPlanId ? "checked" : ""}>
            <span>${esc(c.load_date)} · ${esc(c.truck_no)} · ${esc(c.gas_source || "—")} · ${esc(c.station || "—")}
              ${c.complete ? "" : `<i class="warn">${(c.missing || []).map((k) => "缺" + DOC_LABEL[k]).join(" ")}</i>`}
            </span>
          </label>`
        )
        .join("")}`;
    if (!state.ocr.docType) {
      state.ocr.docType = "unload";
      $("#ocrDocType").value = "unload";
      $("#ocrManual").classList.remove("hidden");
    }
  } else {
    state.ocr.selectedPlanId = null;
    match.innerHTML =
      '<div class="match-title err">未找到匹配计划（按车号+日期）。请手动选择关联计划，或用识别信息新建。</div>';
    fillOcrPlanSelect();
    $("#ocrManual").classList.remove("hidden");
    if (!state.ocr.docType) {
      state.ocr.docType = "unload";
      $("#ocrDocType").value = "unload";
    }
  }
  updateAttachBtn();
}

function fillOcrPlanSelect() {
  const sel = $("#ocrPlanSel");
  sel.innerHTML =
    '<option value="">— 请选择计划 —</option>' +
    state.allPlans
      .slice()
      .sort((a, b) => (b.load_date || "").localeCompare(a.load_date || ""))
      .slice(0, 100)
      .map(
        (p) =>
          `<option value="${p.id}">${esc(p.load_date)} · ${esc(p.truck_no)} · ${esc(p.station || "—")}</option>`
      )
      .join("");
}

function updateAttachBtn() {
  const btn = $("#btnConfirmAttach");
  btn.disabled = !(state.ocr.selectedPlanId || $("#ocrPlanSel").value);
}

async function confirmAttach() {
  const planId = state.ocr.selectedPlanId || $("#ocrPlanSel").value;
  if (!planId) {
    toast("请选择要关联的计划", "warn");
    return;
  }
  const docType = state.ocr.docType || $("#ocrDocType").value;
  const blob = dataURLtoBlob(state.ocr.b64);
  const netWeight =
    docType === "unload" && state.ocr.parsed && state.ocr.parsed.net_weight
      ? state.ocr.parsed.net_weight
      : null;
  const btn = $("#btnConfirmAttach");
  btn.disabled = true;
  try {
    const plan = await Storage.attachImage(planId, docType, blob, netWeight);
    toast(`已把${DOC_LABEL[docType]}填入计划`);
    hideModal("ocrModal");
    includeDateInFilter(plan.load_date);
    await loadPlans();
  } catch (err) {
    toast(err.message, "warn");
  } finally {
    btn.disabled = false;
  }
}

async function newPlanFromOcr() {
  const p = state.ocr.parsed || {};
  const docType = state.ocr.docType || $("#ocrDocType").value;
  const payload = {
    load_date: p.load_date || state.filterFrom || todayStr(),
    truck_no: p.truck_no || "",
    net_weight: docType === "unload" ? p.net_weight || null : null,
  };
  try {
    const plan = await Storage.upsertPlan(payload);
    const blob = dataURLtoBlob(state.ocr.b64);
    await Storage.attachImage(plan.id, docType, blob, docType === "unload" ? p.net_weight : null);
    toast("已新建计划并填入图片");
    hideModal("ocrModal");
    includeDateInFilter(p.load_date || plan.load_date);
    await loadPlans();
  } catch (err) {
    toast(err.message, "warn");
  }
}

/* ---------------- 对账 ---------------- */
function reconDate(p) {
  return (p.plan_arrive || "").slice(0, 10);
}

function supplierMatches(p, supplier) {
  return !supplier || (p.supplier || "").toLowerCase().includes(supplier.toLowerCase());
}

function reconRows(from, to, supplier) {
  return state.allPlans.filter(
    (p) =>
      (!from || reconDate(p) >= from) &&
      (!to || reconDate(p) <= to) &&
      supplierMatches(p, supplier)
  );
}

function statsDay(day, supplier) {
  const rows = reconRows(day, day, supplier);
  return {
    date: day,
    total: rows.length,
    complete: rows.filter((p) => p.complete).length,
    missing_load: rows.filter((p) => !p.images.load).length,
    missing_unload: rows.filter((p) => !p.images.unload).length,
    missing_waybill: rows.filter((p) => !p.images.waybill).length,
    amount: Math.round(rows.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.net_weight) || 0), 0) * 100) / 100,
    plans: rows,
  };
}

function statsRange(from, to, supplier) {
  const rows = reconRows(from, to, supplier);
  const days = {};
  for (const p of rows) (days[reconDate(p)] = days[reconDate(p)] || []).push(p);
  const dayStats = Object.keys(days)
    .sort()
    .map((d) => statsDay(d, supplier));
  return {
    from,
    to,
    total: rows.length,
    complete: rows.filter((p) => p.complete).length,
    missing_load: rows.filter((p) => !p.images.load).length,
    missing_unload: rows.filter((p) => !p.images.unload).length,
    missing_waybill: rows.filter((p) => !p.images.waybill).length,
    amount: Math.round(rows.reduce((s, p) => s + (Number(p.price) || 0) * (Number(p.net_weight) || 0), 0) * 100) / 100,
    days: dayStats,
  };
}

function lastMonthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  const p = (n) => String(n).padStart(2, "0");
  return {
    from: `${first.getFullYear()}-${p(first.getMonth() + 1)}-${p(first.getDate())}`,
    to: `${last.getFullYear()}-${p(last.getMonth() + 1)}-${p(last.getDate())}`,
  };
}

function setReconQuick(kind) {
  let from = "";
  let to = "";
  if (kind === "today") {
    from = to = todayStr();
  } else if (kind === "month") {
    from = monthStart();
    to = todayStr();
  } else if (kind === "lastmonth") {
    const r = lastMonthRange();
    from = r.from;
    to = r.to;
  }
  $("#reconFrom").value = from;
  $("#reconTo").value = to;
  loadRecon();
}

async function loadRecon() {
  $("#reconChips").innerHTML = '<div class="chip">加载中…</div>';
  const from = $("#reconFrom").value || "";
  const to = $("#reconTo").value || "";
  const supplier = $("#reconSupplier").value.trim();
  if (from && to && from > to) {
    toast("开始日期不能晚于结束日期", "warn");
    $("#reconChips").innerHTML = "";
    return;
  }
  renderRecon(statsRange(from, to, supplier));
}

function renderRecon(s) {
  $("#reconChips").innerHTML = `
    <div class="chip">总车数 <b>${s.total}</b></div>
    <div class="chip ok">资料齐全 <b>${s.complete}</b></div>
    <div class="chip warn">缺装车磅单 <b>${s.missing_load}</b></div>
    <div class="chip warn">缺卸车磅单 <b>${s.missing_unload}</b></div>
    <div class="chip warn">缺运单 <b>${s.missing_waybill}</b></div>
    <div class="chip ok">金额合计 <b>¥${fmtPrice(s.amount.toFixed(2))}</b></div>`;

  const box = $("#reconTable");
  if (s.days.length === 1) {
    const plans = s.days[0].plans || [];
    box.innerHTML = plans.length
      ? plans.map(planCardHTML).join("")
      : '<div class="empty-tip">该日期暂无计划。</div>';
    return;
  }
  if (!s.days.length) {
    box.innerHTML = '<div class="empty-tip">该时间范围暂无计划。</div>';
    return;
  }
  box.innerHTML = `
    <table class="table">
      <thead><tr><th>计划到站日期</th><th>车数</th><th>齐全</th><th>缺装</th><th>缺卸</th><th>缺运</th><th>金额</th></tr></thead>
      <tbody>
        ${s.days
          .map(
            (d) => `<tr>
              <td>${esc(d.date)}</td><td>${d.total}</td><td class="ok">${d.complete}</td>
              <td>${d.missing_load}</td><td>${d.missing_unload}</td><td>${d.missing_waybill}</td>
              <td>${fmtPrice(d.amount)}</td></tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

function exportExcel() {
  const from = $("#reconFrom").value || "";
  const to = $("#reconTo").value || "";
  const supplier = $("#reconSupplier").value.trim();
  if (from && to && from > to) {
    toast("开始日期不能晚于结束日期", "warn");
    return;
  }
  const rows = reconRows(from, to, supplier);
  exportXlsx(rows, from, to).catch((err) => toast(err.message, "warn"));
}

/* ---------------- 弹窗 ---------------- */
function showModal(id) {
  $(`#${id}`).classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function hideModal(id) {
  $(`#${id}`).classList.add("hidden");
  if ($("#planModal").classList.contains("hidden") && $("#ocrModal").classList.contains("hidden")) {
    document.body.classList.remove("modal-open");
  }
}

/* ---------------- 事件绑定 ---------------- */
function bindEvents() {
  $$(".tab").forEach((t) =>
    t.addEventListener("click", () => switchView(t.dataset.view))
  );

  $("#btnNew").addEventListener("click", () => openPlanForm());
  $("#btnOcr").addEventListener("click", startOcr);

  $("#filterFrom").addEventListener("change", (e) => {
    state.filterFrom = e.target.value;
    renderFromFilter();
  });
  $("#filterTo").addEventListener("change", (e) => {
    state.filterTo = e.target.value;
    renderFromFilter();
  });
  let qTimer = null;
  $("#searchQ").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      renderFromFilter();
    }, 350);
  });
  $("#filterStatus").addEventListener("change", (e) => {
    state.filterStatus = e.target.value;
    renderFromFilter();
  });

  $("#planList").addEventListener("click", (e) => {
    const link = e.target.closest("[data-act]");
    if (link && (link.dataset.act === "showall" || link.dataset.act === "showmonth")) {
      e.preventDefault();
      if (link.dataset.act === "showall") clearFilter();
      else setMonthFilter();
      loadPlans();
      return;
    }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "copy") {
      copyPlan(id);
    } else if (btn.dataset.act === "edit") {
      const p = state.plans.find((x) => x.id === id);
      if (p) openPlanForm(p);
    } else if (btn.dataset.act === "del") {
      deletePlan(id);
    }
  });

  $("#reconTable").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn || !btn.dataset.id) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === "copy") {
      copyPlan(id);
    } else if (btn.dataset.act === "edit") {
      const p = findPlan(id);
      if (p) openPlanForm(p);
    } else if (btn.dataset.act === "del") {
      deletePlan(id);
    }
  });

  $("#planForm").addEventListener("submit", savePlan);
  $("#btnParse").addEventListener("click", parsePaste);
  $("#pasteText").addEventListener("paste", () => setTimeout(parsePaste, 50));
  $("#btnClearNote").addEventListener("click", () => {
    $("#fNote").value = "";
    toast("备注已清除");
  });

  $$(".img-slot").forEach((slot) => {
    const type = slot.dataset.type;
    slot.querySelector(".slot-upload").addEventListener("click", () => {
      slot.querySelector("input[type=file]").click();
    });
    slot.querySelector("input[type=file]").addEventListener("change", (e) =>
      onSlotFileChange(type, e.target)
    );
    slot.querySelector(".slot-remove").addEventListener("click", () => {
      const img = slot.querySelector(".preview");
      img.classList.add("hidden");
      img.removeAttribute("src");
      state.formImages[type] = { url: "", b64: null, removed: true };
      slot.querySelector(".slot-remove").classList.add("hidden");
    });
  });

  $("#btnPickImage").addEventListener("click", startOcr);
  $("#ocrFile").addEventListener("change", onOcrFileChange);
  $("#ocrMatch").addEventListener("change", (e) => {
    if (e.target.name === "ocrPlan") {
      state.ocr.selectedPlanId = e.target.value;
      updateAttachBtn();
    }
  });
  $("#ocrDocType").addEventListener("change", (e) => {
    state.ocr.docType = e.target.value;
  });
  $("#ocrPlanSel").addEventListener("change", updateAttachBtn);
  $("#btnConfirmAttach").addEventListener("click", confirmAttach);
  $("#btnNewFromOcr").addEventListener("click", newPlanFromOcr);

  $$("[data-quick]").forEach((b) =>
    b.addEventListener("click", () => setReconQuick(b.dataset.quick))
  );
  $("#reconFrom").addEventListener("change", loadRecon);
  $("#reconTo").addEventListener("change", loadRecon);
  let reconSupplierTimer = null;
  $("#reconSupplier").addEventListener("input", () => {
    clearTimeout(reconSupplierTimer);
    reconSupplierTimer = setTimeout(loadRecon, 250);
  });
  $("#btnExport").addEventListener("click", exportExcel);

  $$("[data-close]").forEach((b) =>
    b.addEventListener("click", () => hideModal(b.dataset.close))
  );
  $$(".modal-mask").forEach((mask) =>
    mask.addEventListener("click", (e) => {
      if (e.target === mask) hideModal(mask.id);
    })
  );
}

function renderFromFilter() {
  state.plans = filterPlans();
  renderPlans();
  renderPlanChips();
}

function refreshRecon() {
  if (!$("#view-recon").classList.contains("hidden")) loadRecon();
}

/* ---------------- 启动 ---------------- */
async function init() {
  state.filterFrom = todayStr();
  state.filterTo = todayStr();
  $("#filterFrom").value = state.filterFrom;
  $("#filterTo").value = state.filterTo;
  $("#reconFrom").value = monthStart();
  $("#reconTo").value = todayStr();
  bindEvents();
  try {
    await loadPlans();
  } catch (err) {
    toast(`初始化失败：${err.message}`, "warn");
  }
}

init();

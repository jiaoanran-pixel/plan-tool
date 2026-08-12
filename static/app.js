/* 车辆计划对账系统 - 前端逻辑 */
"use strict";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const DOC_LABEL = { load: "装车磅单", unload: "卸车磅单", waybill: "运单" };

const state = {
  plans: [],
  filterFrom: todayStr(),
  filterTo: todayStr(),
  query: "",
  editingId: null,
  formImages: {}, // {load|unload|waybill: {url, b64, removed}}
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
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function monthStr() {
  return todayStr().slice(0, 7);
}

function monthStart() {
  return todayStr().slice(0, 8) + "01";
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `请求失败（${res.status}）`);
  }
  return data;
}

function toast(msg, type = "info") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.className = "toast hidden"), 3000);
}

function fmtPrice(v) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("zh-CN") : "";
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
async function loadPlans() {
  const qs = new URLSearchParams({ from: state.filterFrom, to: state.filterTo });
  if (state.query) qs.set("q", state.query);
  const data = await api(`/api/plans?${qs}`);
  state.plans = data.plans;
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

function planCardHTML(p) {
  const imgs = p.images || {};
  const missing = p.missing || [];
  const missTxt = missing.length
    ? `缺：${missing.map((k) => DOC_LABEL[k]).join("、")}`
    : "资料齐全";
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
      <div class="kv"><span>到站</span><b>${esc(p.plan_arrive) || "—"}</b></div>
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
        <button class="mini" data-act="edit" data-id="${p.id}">编辑</button>
        <button class="mini danger" data-act="del" data-id="${p.id}">删除</button>
      </div>
    </div>
  </div>`;
}

function thumbHTML(url, label) {
  if (!url) return `<div class="thumb empty">${label}</div>`;
  return `<div class="thumb"><img src="${esc(url)}" alt="${esc(label)}" loading="lazy"><span>${label}</span></div>`;
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
  $("#filterFrom").value = "";
  $("#filterTo").value = "";
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
  $("#fPlanArrive").value = plan?.plan_arrive || "";
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
    const url = plan?.images?.[t] || "";
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
    plan_arrive: $("#fPlanArrive").value.trim(),
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
  if (!payload.load_date || !payload.truck_no) {
    toast("装车日期和车号必填", "warn");
    return;
  }
  const btn = $("#planForm button[type=submit]");
  btn.disabled = true;
  try {
    if (state.editingId) {
      const data = await api(`/api/plans/${state.editingId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("已保存");
      includeDateInFilter(data.plan.load_date);
    } else {
      const data = await api("/api/plans", { method: "POST", body: JSON.stringify(payload) });
      toast("已新增计划");
      includeDateInFilter(data.plan.load_date);
    }
    hideModal("planModal");
    await loadPlans();
  } catch (err) {
    toast(err.message, "warn");
  } finally {
    btn.disabled = false;
  }
}

async function deletePlan(id) {
  const p = state.plans.find((x) => x.id === id);
  if (!confirm(`确认删除计划 ${p?.truck_no || ""}（${p?.load_date || ""}）？删除后图片一并移除，不可恢复。`)) return;
  try {
    await api(`/api/plans/${id}`, { method: "DELETE" });
    toast("已删除");
    await loadPlans();
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
  try {
    const data = await api("/api/parse_text", {
      method: "POST",
      body: JSON.stringify({ text }),
    });
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
    if (!f.truck_no && !f.load_date) {
      toast("未能识别出车号/日期，请手动填写", "warn");
    } else {
      toast("已识别，请核对");
    }
  } catch (err) {
    toast(err.message, "warn");
  }
}

/* ---------------- OCR 识别上传 ---------------- */
async function startOcr() {
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
  $("#ocrStatus").innerHTML = '<div class="loading">⏳ OCR 识别中，请稍候…</div>';
  try {
    const data = await api("/api/ocr", {
      method: "POST",
      body: JSON.stringify({ image_base64: b64 }),
    });
    state.ocr.parsed = data.parsed;
    state.ocr.candidates = data.candidates || [];
    renderOcrResult(data);
  } catch (err) {
    $("#ocrStatus").innerHTML = `<div class="err">自动识别失败：${esc(err.message)}。可关闭弹窗后在卡片内手动上传。</div>`;
  }
}

function renderOcrResult(data) {
  $("#ocrStatus").innerHTML = "";
  $("#ocrResult").classList.remove("hidden");
  const p = data.parsed || {};
  const typeLabel = p.doc_type ? DOC_LABEL[p.doc_type] : "未能确定";
  const conf = p.doc_type_confidence === "high" ? "（较确定）" : p.doc_type_confidence === "medium" ? "（需确认）" : "";
  const dateInfo = p.load_date ? p.load_date : "未识别出日期";
  const truckInfo = p.truck_no ? p.truck_no : "未识别出车号";
  const weightInfo = p.net_weight ? `${p.net_weight} 吨` : "未识别";
  $("#ocrSummary").innerHTML = `
    <div class="sum-row"><span>单据类型</span><b>${typeLabel}${conf}</b></div>
    <div class="sum-row"><span>车号</span><b>${esc(truckInfo)}</b></div>
    <div class="sum-row"><span>装车日期</span><b>${esc(dateInfo)}</b></div>
    <div class="sum-row"><span>净重</span><b>${esc(weightInfo)}</b></div>`;
  $("#ocrText").textContent = data.text || "";
  state.ocr.docType = p.doc_type || "";
  if (p.doc_type) $("#ocrDocType").value = p.doc_type;

  const match = $("#ocrMatch");
  if (data.candidates && data.candidates.length) {
    state.ocr.selectedPlanId = data.candidates[0].id;
    match.innerHTML = `
      <div class="match-title">匹配到 ${data.candidates.length} 个计划，选择要填入的卡片：</div>
      ${data.candidates
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

async function fillOcrPlanSelect() {
  const sel = $("#ocrPlanSel");
  const data = await api("/api/plans?from=&to=");
  const plans = data.plans || [];
  sel.innerHTML =
    '<option value="">— 请选择计划 —</option>' +
    plans
      .slice(0, 100)
      .map(
        (p) =>
          `<option value="${p.id}">${esc(p.load_date)} · ${esc(p.truck_no)} · ${esc(p.station || "—")}</option>`
      )
      .join("");
}

function updateAttachBtn() {
  const btn = $("#btnConfirmAttach");
  const hasTarget = state.ocr.selectedPlanId || $("#ocrPlanSel").value;
  btn.disabled = !hasTarget;
}

async function confirmAttach() {
  const planId = state.ocr.selectedPlanId || $("#ocrPlanSel").value;
  if (!planId) {
    toast("请选择要关联的计划", "warn");
    return;
  }
  const docType = state.ocr.docType || $("#ocrDocType").value;
  const payload = {
    plan_id: planId,
    doc_type: docType,
    image_base64: state.ocr.b64,
  };
  if (state.ocr.parsed && state.ocr.parsed.net_weight && docType === "unload") {
    payload.net_weight = state.ocr.parsed.net_weight;
  }
  const btn = $("#btnConfirmAttach");
  btn.disabled = true;
  try {
    const data = await api("/api/attach", { method: "POST", body: JSON.stringify(payload) });
    toast(`已把${DOC_LABEL[docType]}填入计划`);
    hideModal("ocrModal");
    includeDateInFilter(data.plan.load_date);
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
    const data = await api("/api/plans", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const planId = data.plan.id;
    const attachPayload = {
      plan_id: planId,
      doc_type: docType,
      image_base64: state.ocr.b64,
    };
    if (docType === "unload" && p.net_weight) attachPayload.net_weight = p.net_weight;
    await api("/api/attach", { method: "POST", body: JSON.stringify(attachPayload) });
    toast("已新建计划并填入图片");
    hideModal("ocrModal");
    includeDateInFilter(p.load_date);
    await loadPlans();
  } catch (err) {
    toast(err.message, "warn");
  }
}

/* ---------------- 对账 ---------------- */
let reconMode = "day";

async function loadRecon() {
  $("#reconChips").innerHTML = '<div class="chip">加载中…</div>';
  let url = "";
  if (reconMode === "day") {
    url = `/api/stats?mode=day&date=${$("#reconDate").value || todayStr()}`;
  } else {
    url = `/api/stats?mode=month&month=${$("#reconMonth").value || monthStr()}`;
  }
  try {
    const data = await api(url);
    renderRecon(data.stats);
  } catch (err) {
    $("#reconChips").innerHTML = `<div class="chip warn">${esc(err.message)}</div>`;
  }
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
  if (s.days) {
    // 月度：按天
    if (!s.days.length) {
      box.innerHTML = '<div class="empty-tip">本月暂无计划。</div>';
      return;
    }
    box.innerHTML = `
      <table class="table">
        <thead><tr><th>日期</th><th>车数</th><th>齐全</th><th>缺装</th><th>缺卸</th><th>缺运</th><th>金额</th></tr></thead>
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
  } else if (s.plans) {
    if (!s.plans.length) {
      box.innerHTML = '<div class="empty-tip">当日暂无计划。</div>';
      return;
    }
    box.innerHTML = s.plans.map(planCardHTML).join("");
  }
}

function exportExcel() {
  let qs = "";
  if (reconMode === "day") {
    const d = $("#reconDate").value || todayStr();
    qs = `from=${d}&to=${d}`;
  } else {
    const m = $("#reconMonth").value || monthStr();
    qs = `from=${m}-01&to=${m}-31`;
  }
  window.location.href = `/api/export?${qs}`;
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
    loadPlans();
  });
  $("#filterTo").addEventListener("change", (e) => {
    state.filterTo = e.target.value;
    loadPlans();
  });
  let qTimer = null;
  $("#searchQ").addEventListener("input", (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.query = e.target.value.trim();
      loadPlans();
    }, 350);
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
    if (btn.dataset.act === "edit") {
      const p = state.plans.find((x) => x.id === id);
      if (p) openPlanForm(p);
    } else if (btn.dataset.act === "del") {
      deletePlan(id);
    }
  });

  $("#planForm").addEventListener("submit", savePlan);
  $("#btnParse").addEventListener("click", parsePaste);
  $("#pasteText").addEventListener("paste", () => setTimeout(parsePaste, 50));

  $$(".img-slot").forEach((slot) => {
    const type = slot.dataset.type;
    slot.querySelector(".slot-upload").addEventListener("click", () => {
      slot.querySelector('input[type=file]').click();
    });
    slot.querySelector('input[type=file]').addEventListener("change", (e) =>
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

  // OCR 弹窗
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

  // 对账
  $$(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      $$(".seg-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      reconMode = b.dataset.mode;
      $("#reconDate").classList.toggle("hidden", reconMode !== "day");
      $("#reconMonth").classList.toggle("hidden", reconMode !== "month");
      loadRecon();
    })
  );
  $("#reconDate").addEventListener("change", loadRecon);
  $("#reconMonth").addEventListener("change", loadRecon);
  $("#btnExport").addEventListener("click", exportExcel);

  // 关闭弹窗
  $$("[data-close]").forEach((b) =>
    b.addEventListener("click", () => hideModal(b.dataset.close))
  );
  $$(".modal-mask").forEach((mask) =>
    mask.addEventListener("click", (e) => {
      if (e.target === mask) hideModal(mask.id);
    })
  );
}

/* ---------------- 启动 ---------------- */
async function init() {
  state.filterFrom = monthStart();
  state.filterTo = todayStr();
  $("#filterFrom").value = state.filterFrom;
  $("#filterTo").value = state.filterTo;
  $("#reconDate").value = todayStr();
  $("#reconMonth").value = monthStr();
  bindEvents();
  try {
    const st = await api("/api/state");
    if (!st.ocr_available) {
      toast("OCR 未就绪，图片自动识别暂不可用", "warn");
    }
    await loadPlans();
  } catch (err) {
    toast(`服务异常：${err.message}`, "warn");
  }
}

init();

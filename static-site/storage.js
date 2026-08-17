/* 本地存储：计划数据存 localStorage，图片存 IndexedDB */
"use strict";

const PLANS_KEY = "plan_tool_plans_v1";
const DB_NAME = "plan_tool";
const IMG_STORE = "images";

/* ---------------- IndexedDB ---------------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IMG_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readonly");
    const req = tx.objectStore(IMG_STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, blob) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    tx.objectStore(IMG_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, "readwrite");
    tx.objectStore(IMG_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* ---------------- 计划数据 ---------------- */
function loadPlansRaw() {
  try {
    return JSON.parse(localStorage.getItem(PLANS_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function savePlansRaw(plans) {
  localStorage.setItem(PLANS_KEY, JSON.stringify(plans));
}

function nowStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function makeId() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

function normPlate(s) {
  return String(s || "").replace(/[^A-Z0-9\u4e00-\u9fff]/g, "").toUpperCase();
}

function computeAmount(price, weight) {
  const p = Number(price);
  const w = Number(weight);
  if (Number.isFinite(p) && Number.isFinite(w) && p && w) {
    return Math.round(p * w * 100) / 100;
  }
  return null;
}

function hydratePlan(plan) {
  const images = { load: null, unload: null, waybill: null };
  for (const t of ["load", "unload", "waybill"]) {
    images[t] = plan.images && plan.images[t] ? plan.images[t] : null;
  }
  const complete = !!images.load && !!images.unload && !!images.waybill;
  return {
    ...plan,
    images,
    complete,
    missing: ["load", "unload", "waybill"].filter((t) => !images[t]),
  };
}

async function hydrateAllPlans(plans) {
  const out = [];
  for (const p of plans) {
    const hp = hydratePlan(p);
    for (const t of ["load", "unload", "waybill"]) {
      if (hp.images[t]) {
        const blob = await idbGet(`${p.id}:${t}`);
        if (blob) {
          hp.images[t] = {
            key: `${p.id}:${t}`,
            url: URL.createObjectURL(blob),
            type: blob.type || "image/jpeg",
            blob,
          };
        }
      }
    }
    out.push(hp);
  }
  return out;
}

const Storage = {
  async loadPlans() {
    return hydrateAllPlans(loadPlansRaw());
  },

  async upsertPlan(data, id) {
    const plans = loadPlansRaw();
    const truckNo = normPlate(data.truck_no) || String(data.truck_no || "").trim();
    if (!data.load_date || !truckNo) throw new Error("装车日期和车号必填");
    const price = data.price === "" || data.price === null || data.price === undefined
      ? null : Number(data.price);
    const weight = data.net_weight === "" || data.net_weight === null || data.net_weight === undefined
      ? null : Number(data.net_weight);
    const arrive = normalizeArrive(data.plan_arrive, data.load_date);
    const fields = {
      load_date: data.load_date,
      truck_no: truckNo,
      trailer_no: String(data.trailer_no || "").trim(),
      gas_source: String(data.gas_source || "").trim(),
      supplier: String(data.supplier || "").trim(),
      station: String(data.station || "").trim(),
      plan_arrive: arrive,
      price: Number.isFinite(price) ? price : null,
      net_weight: Number.isFinite(weight) ? weight : null,
      amount: computeAmount(price, weight),
      driver_name: String(data.driver_name || "").trim(),
      driver_phone: String(data.driver_phone || "").trim(),
      carrier: String(data.carrier || "").trim(),
      note: String(data.note || "").trim(),
    };

    // 图片：data.img_*_b64 传入时暂存，统一在拿到计划 ID 后写入 IndexedDB
    const pendingImgs = {};
    for (const t of ["load", "unload", "waybill"]) {
      const b64 = data[`img_${t}_b64`];
      if (b64 !== undefined && b64 !== null) {
        pendingImgs[t] = b64 === "" ? null : dataURLtoBlob(b64);
      }
    }

    let plan;
    if (id) {
      const idx = plans.findIndex((p) => p.id === id);
      if (idx < 0) throw new Error("计划不存在");
      plan = { ...plans[idx], ...fields, id, updated_at: nowStr() };
      for (const t of Object.keys(pendingImgs)) {
        if (pendingImgs[t] === null) {
          await idbDel(`${id}:${t}`);
          const imgs = { ...(plan.images || {}) };
          delete imgs[t];
          plan.images = imgs;
        } else {
          await idbSet(`${id}:${t}`, pendingImgs[t]);
          plan.images = { ...(plan.images || {}), [t]: `${id}:${t}` };
        }
      }
      plans[idx] = plan;
    } else {
      plan = {
        id: makeId(),
        ...fields,
        images: {},
        created_at: nowStr(),
        updated_at: nowStr(),
      };
      for (const t of Object.keys(pendingImgs)) {
        if (pendingImgs[t]) {
          await idbSet(`${plan.id}:${t}`, pendingImgs[t]);
          plan.images[t] = `${plan.id}:${t}`;
        }
      }
      plans.push(plan);
    }
    savePlansRaw(plans);
    return hydratePlan(plan);
  },

  async deletePlan(id) {
    const plans = loadPlansRaw();
    const next = plans.filter((p) => p.id !== id);
    savePlansRaw(next);
    for (const t of ["load", "unload", "waybill"]) {
      await idbDel(`${id}:${t}`);
    }
  },

  async attachImage(planId, docType, blob, netWeight) {
    const key = `${planId}:${docType}`;
    await idbSet(key, blob);
    const plans = loadPlansRaw();
    const idx = plans.findIndex((p) => p.id === planId);
    if (idx >= 0) {
      const p = plans[idx];
      p.images = { ...(p.images || {}), [docType]: key };
      if (docType === "unload" && netWeight) {
        p.net_weight = Number(netWeight);
        p.amount = computeAmount(p.price, p.net_weight);
      }
      p.updated_at = nowStr();
      plans[idx] = p;
      savePlansRaw(plans);
      return hydratePlan(p);
    }
    return null;
  },

  async allPlans() {
    return loadPlansRaw();
  },
};

function dataURLtoBlob(dataURL) {
  const parts = dataURL.split(",");
  const mime = (parts[0].match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ---------------- 剪贴板/OCR 解析共用 ---------------- */
const PLATE_RE = /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{4,6}挂?/g;
const FULL_DATE_RE = /(20\d{2})[-/年.](\d{1,2})[-/月.](\d{1,2})/;
const CN_DAY_RE = /(?<![\d])(\d{1,2})[号日]/;
const PRICE_RE = /价格[：:\s]*([0-9]+(?:\.[0-9]+)?)/;
const SUPPLIER_RE = /供应商[：:\s]*([^\s；;，,]+)/;
const NET_WEIGHT_RE = /净重[：:\s]*([0-9]+(?:\.[0-9]+)?)\s*(吨|t|T|kg|KG|千克)?/;
const ID_RE = /^\d{17}[\dXx]$/;
const PHONE_RE = /^1[3-9]\d{9}$/;
const NAME_RE = /^[\u4e00-\u9fff]{2,4}$/;
const COMPANY_RE = /([\u4e00-\u9fff]{2,}(?:运输|物流|公司)[\u4e00-\u9fff]{0,12})/;
// 常用站点词典：后续新增站点时只需在此处补充。
const COMMON_STATIONS = ["宜章西西站", "宜章西东站", "鲁塘坳", "湘阴渡", "汝城南"];

function makeDate(y, m, d) {
  y = Number(y);
  m = Number(m);
  d = Number(d);
  const dt = new Date(y, m - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== m - 1 ||
    dt.getDate() !== d
  ) {
    return "";
  }
  const p = (n) => String(n).padStart(2, "0");
  return `${y}-${p(m)}-${p(d)}`;
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function normalizeArrive(planArrive, loadDate) {
  const pa = String(planArrive || "").trim();
  if (!pa) return "";
  const m0 = pa.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2})(?::(\d{2}))?$/);
  if (m0) {
    const hour = String(Number(m0[2])).padStart(2, "0");
    const minute = String(Number(m0[3] || 0)).padStart(2, "0");
    return `${m0[1]}T${hour}:${minute}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(pa)) return `${pa}T00:00`;
  let hour = null;
  let date = "";
  const m = pa.match(FULL_DATE_RE);
  if (m) {
    date = makeDate(m[1], m[2], m[3]);
    const mh = pa.match(/(\d{1,2})[点时]/);
    hour = mh ? Number(mh[1]) : null;
  } else {
    const md = pa.match(CN_DAY_RE);
    if (md) {
      const day = Number(md[1]);
      const mh = pa.match(/(\d{1,2})[点时]/);
      hour = mh ? Number(mh[1]) : null;
      const base = loadDate || todayStr();
      const bd = new Date(base + "T00:00:00");
      let y = bd.getFullYear();
      let mo = bd.getMonth() + 1;
      if (day < bd.getDate()) {
        mo += 1;
        if (mo > 12) {
          mo = 1;
          y += 1;
        }
      }
      date = makeDate(y, mo, day);
    }
  }
  if (!date) return "";
  return hour ? `${date}T${String(hour).padStart(2, "0")}:00` : `${date}T00:00`;
}

function parsePasteText(text) {
  const lines = String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const res = {
    load_date: "",
    truck_no: "",
    trailer_no: "",
    gas_source: "",
    supplier: "",
    station: "",
    plan_arrive: "",
    price: null,
    driver_name: "",
    driver_phone: "",
    carrier: "",
    note: "",
  };
  const warnings = [];
  let arriveDay = null;
  let arriveHour = null;

  if (lines.length) {
    const first = lines[0];
    // 首行只要是“气源地-站点”，就优先按横杠拆分；后面的到站日期可有可无。
    const route = first.match(/^([^\s\-—－]+)\s*[\-—－]\s*(.+)$/);
    if (route) {
      res.gas_source = route[1].trim();
      const tail = route[2].trim();
      const dateBeforeStation = tail.match(/^(\d{1,2})[号日](?:(\d{1,2})[点时])?\s*(.+)$/);
      const dateAfterStation = tail.match(/^(.*?)(\d{1,2})[号日](?:(\d{1,2})[点时])?$/);
      const arrive = dateBeforeStation || dateAfterStation;
      res.station = (
        dateBeforeStation ? dateBeforeStation[3] : dateAfterStation ? dateAfterStation[1] : tail
      ).trim();
      if (arrive) {
        arriveDay = Number(dateBeforeStation ? dateBeforeStation[1] : dateAfterStation[2]);
        arriveHour = Number(dateBeforeStation ? dateBeforeStation[2] : dateAfterStation[3]) || null;
      }
    } else {
      // 兼容“气源地 18号12点站点”：日期时间在站点前。
      const dateFirst = first.match(/^([^\s\-—－]+)\s+(\d{1,2})[号日](?:(\d{1,2})[点时])?\s*(.+)$/);
      if (dateFirst) {
        res.gas_source = dateFirst[1];
        res.station = dateFirst[4].trim();
        arriveDay = Number(dateFirst[2]);
        arriveHour = dateFirst[3] ? Number(dateFirst[3]) : null;
      } else {
        const m = first.match(/^([^\s\-—－]+)\s+(.+?)(\d{1,2})[号日](?:(\d{1,2})[点时])?$/);
        if (m) {
          res.gas_source = m[1];
          res.station = m[2];
          arriveDay = Number(m[3]);
          arriveHour = m[4] ? Number(m[4]) : null;
        }
      }
    }
  }

  for (const line of lines) {
    if (line.includes("供应商")) {
      const s = line.match(SUPPLIER_RE);
      if (s) res.supplier = s[1];
      const pr = line.match(PRICE_RE);
      if (pr) res.price = Number(pr[1]);
      continue;
    }
    if (line.includes("装车")) {
      const md = line.match(CN_DAY_RE);
      if (md) {
        const d = Number(md[1]);
        const t = new Date();
        res.load_date = makeDate(t.getFullYear(), t.getMonth() + 1, d);
        warnings.push("装车日期未写月份，已按本月推断，请核对");
      }
      continue;
    }
    if (line.includes("价格")) {
      const pr = line.match(PRICE_RE);
      if (pr) res.price = Number(pr[1]);
    }
    if (arriveDay === null && line.includes("到站")) {
      const md = line.match(CN_DAY_RE);
      if (md) {
        arriveDay = Number(md[1]);
        const mh = line.match(/(\d{1,2})[点时]/);
        arriveHour = mh ? Number(mh[1]) : null;
      }
    }
  }

  if (arriveDay !== null) {
    const base = res.load_date || todayStr();
    const bd = new Date(base + "T00:00:00");
    let y = bd.getFullYear();
    let mo = bd.getMonth() + 1;
    if (arriveDay < bd.getDate()) {
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    const date = makeDate(y, mo, arriveDay);
    if (date) {
      res.plan_arrive = arriveHour
        ? `${date}T${String(arriveHour).padStart(2, "0")}:00`
        : `${date}T00:00`;
    }
    warnings.push("计划到站日期已按装车日期推断月份，请核对");
  }

  const plates = String(text).match(PLATE_RE) || [];
  const heads = plates.filter((p) => !p.endsWith("挂"));
  const trailers = plates.filter((p) => p.endsWith("挂"));
  if (heads.length) res.truck_no = heads[0];
  if (trailers.length) res.trailer_no = trailers[0];

  const drivers = [];
  lines.forEach((ln, i) => {
    if (ID_RE.test(ln)) {
      let name = "";
      let phone = "";
      if (i > 0 && NAME_RE.test(lines[i - 1])) name = lines[i - 1];
      if (i + 1 < lines.length && PHONE_RE.test(lines[i + 1])) phone = lines[i + 1];
      drivers.push({ name, phone });
    }
  });
  if (drivers.length) {
    res.driver_name = drivers[0].name;
    res.driver_phone = drivers[0].phone;
    const extra = drivers
      .slice(1)
      .map((d) => `押运：${d.name} ${d.phone}`.trim())
      .filter(Boolean)
      .join("；");
    if (extra) res.note = extra;
  }

  // 优先识别“驾驶员：姓名 / 电话：号码”这类带标签格式。
  const driverIdx = lines.findIndex((ln) => /^(?:驾驶员|司机)(?:姓名)?\s*[：:]/.test(ln));
  if (driverIdx >= 0) {
    const name = lines[driverIdx].replace(/^(?:驾驶员|司机)(?:姓名)?\s*[：:]\s*/, "").trim();
    if (name) res.driver_name = name;
    for (let i = driverIdx + 1; i < lines.length; i++) {
      if (/^(?:押运员|押运|供应商)\s*[：:]/.test(lines[i])) break;
      const phone = lines[i].match(/^(?:电话(?:号码)?\s*[：:]?\s*)?(1\d{10})\s*$/);
      if (phone) {
        res.driver_phone = phone[1];
        break;
      }
    }
  }

  const cm = String(text).match(COMPANY_RE);
  if (cm) res.carrier = cm[1];

  // 常用站点在任意粘贴行中出现时，优先作为站点字段。
  for (const line of lines) {
    const station = COMMON_STATIONS.find((name) => line.includes(name));
    if (station) {
      res.station = station;
      break;
    }
  }
  return { fields: res, warnings };
}

function parseOcrText(text) {
  const parsed = {
    truck_no: "",
    load_date: "",
    doc_type: "",
    doc_type_confidence: "low",
    net_weight: null,
  };
  const plates = String(text).match(PLATE_RE) || [];
  const heads = plates.filter((p) => !p.endsWith("挂"));
  if (heads.length) parsed.truck_no = normPlate(heads[0]);

  const m = String(text).match(FULL_DATE_RE);
  if (m) {
    parsed.load_date = makeDate(m[1], m[2], m[3]);
  } else {
    const md = String(text).match(CN_DAY_RE);
    if (md) {
      const t = new Date();
      parsed.load_date = makeDate(t.getFullYear(), t.getMonth() + 1, Number(md[1]));
    }
  }

  const scores = { load: 0, unload: 0, waybill: 0 };
  if (text.includes("装车磅单") || text.includes("装车计量单")) scores.load += 6;
  if (text.includes("卸车磅单") || text.includes("卸车计量单")) scores.unload += 6;
  if (text.includes("运单") && !text.includes("磅单")) scores.waybill += 6;
  const kw = {
    load: ["装车", "装货", "发货单位", "发货方", "出厂", "发运", "皮重"],
    unload: ["卸车", "卸货", "收货单位", "收货方", "回皮", "实收", "结算"],
    waybill: ["托运", "承运", "运输合同", "调度", "起运地", "到达地", "货主"],
  };
  for (const k of Object.keys(kw)) {
    for (const w of kw[k]) {
      if (text.includes(w)) scores[k] += 1;
    }
  }
  let best = "load";
  for (const k of Object.keys(scores)) {
    if (scores[k] > scores[best]) best = k;
  }
  if (scores[best] >= 2) {
    parsed.doc_type = best;
    parsed.doc_type_confidence = scores[best] >= 4 ? "high" : "medium";
  }

  const nw = String(text).match(NET_WEIGHT_RE);
  if (nw) {
    let val = Number(nw[1]);
    const unit = (nw[2] || "").toLowerCase();
    if (unit === "kg" || unit === "千克") val = val / 1000;
    parsed.net_weight = Math.round(val * 1000) / 1000;
  }
  return parsed;
}

function findCandidates(plans, truckNo, loadDate, limit = 8) {
  if (!truckNo) return [];
  let rows = [];
  if (loadDate) {
    rows = plans.filter(
      (p) => p.truck_no === truckNo && p.load_date === loadDate
    );
    if (!rows.length) {
      rows = plans.filter((p) => p.truck_no === truckNo);
    }
  } else {
    rows = plans.filter((p) => p.truck_no === truckNo);
  }
  return rows
    .sort((a, b) => (b.load_date || "").localeCompare(a.load_date || ""))
    .slice(0, limit)
    .map(hydratePlan);
}

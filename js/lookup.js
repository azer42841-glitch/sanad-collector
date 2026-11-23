/* البحث في الكفالات دون إنترنت: يقرأ ملفاً مشفّراً (.sanadlk) صدّره المدير من سند. كلمة المرور لا تُحفظ، والبيانات المفكوكة في الذاكرة فقط وتُمسح عند القفل. */
(function (root) {
  "use strict";
  var KEY = "sanad-lookup-file", FORMATS = ["sanad-lookup-1", "sanad-lookup-2"];
  var STATE = { active: "سارية", upcoming: "قادمة", review: "قيد الدراسة", expired: "منتهية", waiting: "في كشف الانتظار", none: "بلا كفالة", presented: "معروض على الكفيل", approved: "اعتمد الكفيل" };
  var REQ = { review: "قيد المراجعة", presented: "معروض على الكفيل", approved: "اعتمد الكفيل" };

  function norm(s) {
    return String(s == null ? "" : s).replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); }).toLowerCase().replace(/\s+/g, " ").trim();
  }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function header(d) {      // نفس ترويسة بايثون: مفاتيح مرتبة بلا مسافات (تُربط بالتشفير فلا يُزوَّر التاريخ ولا العدد ولا الانتهاء ولا اسم الجهاز)
    var keys = d.format === "sanad-lookup-1" ? ["format", "iter", "iv", "made", "n", "salt"] : ["exp", "format", "iter", "iv", "label", "made", "n", "salt"];
    return "{" + keys.map(function (k) { return JSON.stringify(k) + ":" + JSON.stringify(d[k]); }).join(",") + "}";
  }
  function peek(text) {
    var d = JSON.parse(text);
    if (FORMATS.indexOf(d.format) < 0 || !d.ct || !d.salt || !d.iv) throw new Error("bad");
    return d;
  }
  function today() { var t = new Date(); return t.getFullYear() + "-" + ("0" + (t.getMonth() + 1)).slice(-2) + "-" + ("0" + t.getDate()).slice(-2); }
  function expired(d) { return !!(d.exp && today() > d.exp); }
  async function open(text, pass) {
    var d = peek(text), c = root.crypto || globalThis.crypto;
    if (expired(d)) { var ex = new Error("expired"); ex.code = "expired"; throw ex; }
    var base = await c.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await c.subtle.deriveKey({ name: "PBKDF2", salt: unb64(d.salt), iterations: d.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var pt = await c.subtle.decrypt({ name: "AES-GCM", iv: unb64(d.iv), additionalData: new TextEncoder().encode(header(d)) }, key, unb64(d.ct));
    var u8 = new Uint8Array(pt);
    if (u8[0] === 0x1f && u8[1] === 0x8b) pt = await new Response(new Blob([pt]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();     // ملف التحديث المباشر مضغوط
    var rows = JSON.parse(new TextDecoder().decode(pt)).rows;
    rows.forEach(function (r) { r._t = norm([r.n, r.f, r.m, r.g, r.a].concat((r.k || []).map(function (k) { return k[0]; })).join(" ")); });
    return rows;
  }
  function search(rows, q, limit) {
    var toks = norm(q).split(" ").filter(Boolean);
    if (!toks.length) return [];
    var out = [];
    for (var i = 0; i < rows.length && out.length < (limit || 60); i++) if (toks.every(function (t) { return rows[i]._t.indexOf(t) >= 0; })) out.push(rows[i]);
    return out;
  }
  var api = { norm: norm, open: open, search: search, peek: peek, expired: expired, STATE: STATE, REQ: REQ };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.sanadLookup = api;
  if (typeof document === "undefined") return;

  /* ---------------- الواجهة ---------------- */
  var $ = function (s) { return document.querySelector(s); };
  var rows = null, timer = null, fails = 0, blockedUntil = 0;
  function store(v) { try { return v == null ? localStorage.getItem(KEY) : (localStorage.setItem(KEY, v), v); } catch (e) { return null; } }
  function note(t, cls) { var m = $("#msg"); m.textContent = t || ""; m.hidden = !t; m.className = "flash" + (cls ? " " + cls : ""); }
  function view(name) { ["empty", "lock", "search"].forEach(function (n) { $("#s-" + n).hidden = n !== name; }); }
  function lock(why) {
    rows = null; clearTimeout(timer); $("#results").textContent = ""; $("#q").value = ""; $("#pw").value = "";
    refresh(); if (why) note(why);
  }
  function daysLeft(d) { return d.exp ? Math.ceil((new Date(d.exp + "T23:59:59") - new Date()) / 86400000) : null; }
  function refresh() {
    var t = store();
    if (!t) return view("empty");
    try {                           // انتهت الصلاحية: تُحذف النسخة من الجوال تلقائياً
      var dd = peek(t);
      if (expired(dd)) { try { localStorage.removeItem(KEY); } catch (_) {} rows = null; view("empty"); return note("انتهت صلاحية النسخة (" + dd.exp + ") وحُذفت بياناتها من هذا الجوال. اطلب نسخة جديدة من المدير.", "error"); }
    } catch (e) {}
    try { var d = peek(t); $("#info").textContent = (d.label ? "لـ: " + d.label + " · " : "") + "تاريخ النسخة: " + d.made + " · عدد الملفات: " + d.n + (d.exp ? " · صالحة حتى " + d.exp : "");
      var left = daysLeft(d); if (left !== null && left <= 14) note("تنتهي صلاحية هذه النسخة بعد " + left + " يوماً وتُحذف من الجوال. اطلب من المدير تجديدها.", "error"); $("#stamp").textContent = "نسخة بتاريخ " + d.made + ". ما تغيّر بعدها لا يظهر هنا."; view("lock"); }
    catch (e) { try { localStorage.removeItem(KEY); } catch (_) {} view("empty"); }
  }
  function idle() { clearTimeout(timer); timer = setTimeout(function () { lock("قُفل البحث بعد دقيقتين من الخمول."); }, 120000); }
  function line(parent, label, val) { if (!val) return; var p = document.createElement("div"); p.className = "muted"; p.textContent = label + ": " + val; parent.appendChild(p); }
  function draw() {
    var q = $("#q").value, box = $("#results"); box.textContent = "";
    if (!norm(q)) { $("#count").textContent = rows.length + " ملفاً في هذه النسخة"; return; }
    var res = search(rows, q, 60);
    $("#count").textContent = res.length ? res.length + (res.length >= 60 ? "+ نتيجة (حسّن البحث)" : " نتيجة") : "لا نتائج";
    res.forEach(function (r) {
      var c = document.createElement("div"); c.className = "card stack res";
      var h = document.createElement("div"); var b = document.createElement("b"); b.textContent = r.n; h.appendChild(b);
      var isReq = r.t === "r";
      var tag = document.createElement("span"); tag.className = "tag " + (isReq ? "w" : r.s === "active" ? "g" : r.s === "expired" || r.s === "waiting" ? "w" : ""); tag.textContent = isReq ? "طلب: " + (REQ[r.s] || r.s) : (STATE[r.s] || r.s); h.appendChild(document.createTextNode(" ")); h.appendChild(tag);
      var no = document.createElement("span"); no.className = "tag g code"; no.textContent = r.f; h.appendChild(document.createTextNode(" ")); h.appendChild(no);
      c.appendChild(h); line(c, "الشهيد", r.m); line(c, "الوصي", r.g); line(c, "المنطقة", r.a);
      (r.k || []).forEach(function (k) { line(c, "الكفيل", k[0] + " · " + (STATE[k[1]] || k[1]) + (k[2] ? " · حتى " + k[2] : "")); });
      if (!(r.k || []).length) line(c, isReq ? "الكفيل" : "الكفالة", isReq ? "لم يُعرض على كفيل بعد" : "لا كفيل مسجّل");
      box.appendChild(c);
    });
  }
  function pick(ev) {
    var f = ev.target.files && ev.target.files[0]; ev.target.value = ""; if (!f) return;
    if (f.size > 4000000) return note("الملف كبير بشكل غير متوقع.", "error");
    var rd = new FileReader();
    rd.onload = function () {
      try { peek(rd.result); } catch (e) { return note("هذا ليس ملف بحث من سند.", "error"); }
      if (store(rd.result) === null) return note("تعذّر حفظ الملف على الجوال (المساحة أو الوضع الخاص).", "error");
      note("حُفظ الملف مشفّراً. أدخل كلمة المرور.", "ok"); rows = null; refresh();
    };
    rd.readAsText(f);
  }
  /* جهاز مفعَّل: سرّ الجهاز محفوظ مشفَّراً برمز الحماية في قاعدة التطبيق؛ ملف بيانات الجهاز مشفَّر بهذا السرّ فلا كلمة مرور للملف */
  function idb() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open("sanad-offline", 1);
      r.onupgradeneeded = function () { try { r.transaction.abort(); } catch (e) {} };
      r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
    });
  }
  function meta(db, k) {
    return new Promise(function (res, rej) {
      var q = db.transaction("meta", "readonly").objectStore("meta").get(k); q.onsuccess = function () { res(q.result); }; q.onerror = function () { rej(q.error); };
    });
  }
  async function deviceSecret(pin) {
    var db = await idb(), kdf = await meta(db, "kdf"), dev = await meta(db, "device"); db.close();
    if (!kdf || !dev) throw new Error("nodevice");
    var c = root.crypto || globalThis.crypto, base = await c.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    var key = await c.subtle.deriveKey({ name: "PBKDF2", salt: kdf.salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    await c.subtle.decrypt({ name: "AES-GCM", iv: kdf.check.iv }, key, kdf.check.ct);                 /* يتحقق من الرمز */
    return new TextDecoder().decode(await c.subtle.decrypt({ name: "AES-GCM", iv: dev.iv }, key, dev.ct));
  }
  async function hasDevice() { try { var db = await idb(), d = await meta(db, "device"); db.close(); return !!d; } catch (e) { return false; } }
  /* تحديث البيانات من حاسوب الجمعية بنقرة: نوقّع طلباً قصير الأجل بسرّ الجهاز ونفتح صفحة الحاسوب، فيعيدنا ومعنا الملف */
  async function hmacHex(secret, msg) {
    var c = root.crypto || globalThis.crypto, k = await c.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return Array.prototype.map.call(new Uint8Array(await c.subtle.sign("HMAC", k, new TextEncoder().encode(msg))), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  }
  async function startSync(pinEl, btn) {
    var pin = pinEl.value; if (!pin) return note("اكتب رمز حماية الجهاز أولاً.", "error");
    var server = ""; try { server = localStorage.getItem("sanad-collector-server") || ""; } catch (e) {}
    if (!server) return note("عنوان حاسوب الجمعية غير محفوظ. أعد تفعيل الجهاز.", "error");
    btn.disabled = true; note("جارٍ التحقق من الرمز…");
    try {
      var secret = await deviceSecret(pin), db = await idb(), dev = await meta(db, "device"); db.close();
      var ts = Math.floor(Date.now() / 1000), mac = await hmacHex(secret, "sync|" + dev.d + "|" + ts);
      try { sessionStorage.setItem("sanad-sync-secret", JSON.stringify({ s: secret, t: Date.now() })); } catch (e) {}        /* لحظات فقط: لنفتح الملف بعد العودة دون إعادة كتابة الرمز */
      location.href = server + "/lookup/sync?d=" + dev.d + "&ts=" + ts + "&mac=" + mac + "&r=" + encodeURIComponent(location.origin + location.pathname);
    } catch (e) {
      btn.disabled = false; note(e && e.message === "nodevice" ? "هذا الجوال غير مفعَّل." : "رمز حماية الجهاز خاطئ.", "error");
    }
  }
  function takeSyncSecret() {
    try { var o = JSON.parse(sessionStorage.getItem("sanad-sync-secret") || "null"); sessionStorage.removeItem("sanad-sync-secret"); return o && Date.now() - o.t < 5 * 60 * 1000 ? o.s : null; } catch (e) { return null; }
  }
  async function afterReturn() {
    if (!/^#lookup=/.test(location.hash)) return;
    var raw = location.hash.slice(8);
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    try {
      var s = raw.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "=";
      var text = decodeURIComponent(escape(atob(s))); peek(text);
      if (store(text) === null) return note("تعذّر حفظ البيانات على الجوال.", "error");
      var secret = takeSyncSecret();
      if (secret) { rows = await open(text, secret); note("تم تحديث البيانات من حاسوب الجمعية.", "ok"); view("search"); draw(); idle(); $("#q").focus(); return; }
      note("وصلت البيانات الجديدة. افتحها برمز حماية الجهاز.", "ok"); refresh();
    } catch (e) { note("تعذّر قراءة البيانات القادمة من الحاسوب.", "error"); }
  }
  async function unlockDevice() {
    if (Date.now() < blockedUntil) return note("محاولات كثيرة. انتظر نصف دقيقة.", "error");
    var pin = $("#pw").value; if (!pin) return;
    $("#unlock-dev").disabled = true; note("جارٍ الفتح…");
    try {
      var secret = await deviceSecret(pin);
      rows = await open(store(), secret); fails = 0; $("#pw").value = ""; note(""); view("search"); draw(); idle(); $("#q").focus();
    } catch (e) {
      rows = null; if (!(e && e.code === "expired")) fails++; if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; }
      note(e && e.code === "expired" ? "انتهت صلاحية هذه النسخة. اطلب ملفاً جديداً من المدير." : e && e.message === "nodevice" ? "هذا الجوال غير مفعَّل. استعمل كلمة مرور الملف." : "رمز حماية الجهاز خاطئ أو الملف ليس لهذا الجهاز.", "error");
    }
    $("#unlock-dev").disabled = false;
  }
  async function unlock() {
    if (Date.now() < blockedUntil) return note("محاولات كثيرة. انتظر نصف دقيقة.", "error");
    var pw = $("#pw").value; if (!pw) return;
    $("#unlock").disabled = true; note("جارٍ الفتح…");
    try {
      rows = await open(store(), pw); fails = 0; $("#pw").value = ""; note(""); view("search"); draw(); idle(); $("#q").focus();
    } catch (e) {
      rows = null; if (!(e && e.code === "expired")) fails++; if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; }
      note(e && e.code === "expired" ? "انتهت صلاحية هذه النسخة. اطلب نسخة جديدة من المدير." : "كلمة المرور خاطئة أو الملف تالف.", "error");
    }
    $("#unlock").disabled = false;
  }
  $("#pick").addEventListener("change", pick); $("#pick2").addEventListener("change", pick);
  $("#unlock").addEventListener("click", unlock);
  $("#unlock-dev").addEventListener("click", unlockDevice);
  hasDevice().then(function (ok) { $("#unlock-dev").hidden = !ok; $("#sync-box").hidden = !ok; $("#sync-box0").hidden = !ok; });
  $("#sync").addEventListener("click", function () { startSync($("#pw"), $("#sync")); });
  $("#sync0").addEventListener("click", function () { startSync($("#pin0"), $("#sync0")); });
  afterReturn();
  $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
  $("#q").addEventListener("input", function () { draw(); idle(); });
  $("#lock").addEventListener("click", function () { lock("قُفل البحث."); });
  $("#wipe").addEventListener("click", function () {
    if (confirm("حذف البيانات من هذا الجوال؟ يمكنك استيراد ملف آخر لاحقاً.")) { try { localStorage.removeItem(KEY); } catch (e) {} lock("حُذفت البيانات من الجوال."); }
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden && rows) lock("قُفل البحث لأنك غادرت الصفحة."); else if (!document.hidden && !rows) refresh(); });
  ["click", "touchstart", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { if (rows) idle(); }, { passive: true }); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});
  refresh();
})(typeof window !== "undefined" ? window : globalThis);

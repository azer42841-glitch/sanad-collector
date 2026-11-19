/* البحث في الكفالات دون إنترنت: يقرأ ملفاً مشفّراً (.sanadlk) صدّره المدير من سند. كلمة المرور لا تُحفظ، والبيانات المفكوكة في الذاكرة فقط وتُمسح عند القفل. */
(function (root) {
  "use strict";
  var KEY = "sanad-lookup-file", FORMAT = "sanad-lookup-1";
  var STATE = { active: "سارية", upcoming: "قادمة", review: "قيد الدراسة", expired: "منتهية", waiting: "في كشف الانتظار", none: "بلا كفالة" };

  function norm(s) {
    return String(s == null ? "" : s).replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x660); }).toLowerCase().replace(/\s+/g, " ").trim();
  }
  function unb64(s) { var b = atob(s), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function header(d) {      // نفس ترويسة بايثون: مفاتيح مرتبة بلا مسافات (تُربط بالتشفير فلا يُزوَّر التاريخ ولا العدد)
    return "{" + ["format", "iter", "iv", "made", "n", "salt"].map(function (k) { return JSON.stringify(k) + ":" + JSON.stringify(d[k]); }).join(",") + "}";
  }
  function peek(text) {
    var d = JSON.parse(text);
    if (d.format !== FORMAT || !d.ct || !d.salt || !d.iv) throw new Error("bad");
    return d;
  }
  async function open(text, pass) {
    var d = peek(text), c = root.crypto || globalThis.crypto;
    var base = await c.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
    var key = await c.subtle.deriveKey({ name: "PBKDF2", salt: unb64(d.salt), iterations: d.iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    var pt = await c.subtle.decrypt({ name: "AES-GCM", iv: unb64(d.iv), additionalData: new TextEncoder().encode(header(d)) }, key, unb64(d.ct));
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
  var api = { norm: norm, open: open, search: search, peek: peek, STATE: STATE };
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
  function refresh() {
    var t = store();
    if (!t) return view("empty");
    try { var d = peek(t); $("#info").textContent = "تاريخ النسخة: " + d.made + " · عدد الملفات: " + d.n; $("#stamp").textContent = "نسخة بتاريخ " + d.made + ". ما تغيّر بعدها لا يظهر هنا."; view("lock"); }
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
      var tag = document.createElement("span"); tag.className = "tag " + (r.s === "active" ? "g" : r.s === "expired" || r.s === "waiting" ? "w" : ""); tag.textContent = STATE[r.s] || r.s; h.appendChild(document.createTextNode(" ")); h.appendChild(tag);
      var no = document.createElement("span"); no.className = "tag g code"; no.textContent = r.f; h.appendChild(document.createTextNode(" ")); h.appendChild(no);
      c.appendChild(h); line(c, "الشهيد", r.m); line(c, "الوصي", r.g); line(c, "المنطقة", r.a);
      (r.k || []).forEach(function (k) { line(c, "الكفيل", k[0] + " · " + (STATE[k[1]] || k[1]) + (k[2] ? " · حتى " + k[2] : "")); });
      if (!(r.k || []).length) line(c, "الكفالة", "لا كفيل مسجّل");
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
  async function unlock() {
    if (Date.now() < blockedUntil) return note("محاولات كثيرة. انتظر نصف دقيقة.", "error");
    var pw = $("#pw").value; if (!pw) return;
    $("#unlock").disabled = true; note("جارٍ الفتح…");
    try {
      rows = await open(store(), pw); fails = 0; $("#pw").value = ""; note(""); view("search"); draw(); idle(); $("#q").focus();
    } catch (e) {
      rows = null; fails++; if (fails >= 5) { blockedUntil = Date.now() + 30000; fails = 0; }
      note("كلمة المرور خاطئة أو الملف تالف.", "error");
    }
    $("#unlock").disabled = false;
  }
  $("#pick").addEventListener("change", pick); $("#pick2").addEventListener("change", pick);
  $("#unlock").addEventListener("click", unlock);
  $("#pw").addEventListener("keydown", function (e) { if (e.key === "Enter") unlock(); });
  $("#q").addEventListener("input", function () { draw(); idle(); });
  $("#lock").addEventListener("click", function () { lock("قُفل البحث."); });
  $("#wipe").addEventListener("click", function () {
    if (confirm("حذف البيانات من هذا الجوال؟ يمكنك استيراد ملف آخر لاحقاً.")) { try { localStorage.removeItem(KEY); } catch (e) {} lock("حُذفت البيانات من الجوال."); }
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden && rows) lock("قُفل البحث لأنك غادرت الصفحة."); });
  ["click", "touchstart", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { if (rows) idle(); }, { passive: true }); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(function () {});
  refresh();
})(typeof window !== "undefined" ? window : globalThis);

/* وضع الموظف الجامع: صفحة محلية داخل التطبيق بلا خادم ولا إنترنت.
 * يحدد رمز الموظف (EMP-xxx) مرة واحدة ثم يُوثَّق به كل طلب يجمعه، ويظهر عند المدير «جمعه EMP-xxx». */
(function () {
  "use strict";
  window.SANAD_COLLECTOR = true;
  /* قفل التطبيق: بمجرد وجود رمز موظف نُخفي الصفحة حتى يُدخَل رمز حماية الجهاز (offline.js) */
  try { if (localStorage.getItem("sanad-collector-code")) document.documentElement.classList.add("locked"); } catch (e) {}
  /* خارج تطبيق أندرويد (آيفون/متصفح): نسجّل service worker ليعمل بلا إنترنت بعد أول فتح. داخل تطبيق أندرويد الملفات من assets فلا حاجة له. */
  window.SANAD_SW_URL = window.SanadAndroid ? null : "sw.js";
  window.SANAD_SW_SCOPE = "./";
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // يطلب حماية الطلبات المحفوظة من تنظيف المتصفح
  /* آيفون: روابط الواتساب وغيره تُفتح في متصفح داخلي لا يسمح بإضافة التطبيق للشاشة الرئيسية، فننبّه ونوفّر نسخ الرابط للصقه في Safari. */
  (function () {
    var ua = navigator.userAgent || "";
    var ios = /iPhone|iPad|iPod/.test(ua);
    var inApp = ios && (!/Safari\//.test(ua) || /WhatsApp|FBAN|FBAV|Instagram|Line|Telegram/.test(ua));
    if (!inApp || window.navigator.standalone) return;
    var main = document.querySelector("main"), box = document.createElement("div");
    box.className = "flash error"; box.setAttribute("role", "alert");
    box.innerHTML = "<b>افتح الرابط في Safari.</b> هذا المتصفح الداخلي (واتساب) لا يسمح بتثبيت التطبيق. انسخ الرابط ثم الصقه في Safari.<br>";
    var b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = "نسخ الرابط";
    b.onclick = function () {
      var u = location.href.split("#")[0], done = function () { b.textContent = "تم النسخ، افتح Safari والصقه"; };
      try { navigator.clipboard.writeText(u).then(done, function () { prompt("انسخ الرابط:", u); }); } catch (e) { prompt("انسخ الرابط:", u); }
    };
    box.appendChild(b);
    if (main) main.insertBefore(box, main.firstChild);
  })();
  var $ = function (s) { return document.querySelector(s); };
  var AREAS = ["رفح", "خانيونس", "دير البلح", "المواصي", "النصيرات", "غزة", "جباليا", "بيت لاهيا", "بيت حانون"];
  var HOUSING = ["منزل", "مخيم", "خيمة مستقلة"];
  var K = "sanad-collector-code", KD = "sanad-collector-dev", KP = "sanad-collector-pending", KS = "sanad-collector-server";
  function get() { try { return localStorage.getItem(K) || ""; } catch (e) { return ""; } }
  function put(v) { try { localStorage.setItem(K, v); } catch (e) {} }
  function dev() { try { return JSON.parse(localStorage.getItem(KD) || "{}"); } catch (e) { return {}; } }
  /* سرّ الجهاز يمرّ مؤقتاً هنا ثم يأخذه offline.js فيحفظه مشفَّراً برمز الحماية */
  window.SANAD_TAKE_PENDING_DEVICE = function () {
    try { var p = JSON.parse(localStorage.getItem(KP) || "null"); localStorage.removeItem(KP); return p; } catch (e) { return null; }
  };
  function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return atob(s); }
  /* شيفرة التفعيل القادمة من صفحة التفعيل على حاسوب الجمعية: #activate=<base64url(JSON)> */
  function takeActivation(raw) {
    try {
      var p = JSON.parse(decodeURIComponent(escape(unb64u(String(raw).trim().replace(/^#?activate=/, "")))));
      if (!/^EMP-\d{3,}$/.test(p.u) || !(p.d > 0) || !/^[A-Za-z0-9_-]{43}$/.test(p.s) || (p.r !== "entry" && p.r !== "viewer")) return false;
      localStorage.setItem(KP, JSON.stringify({ u: p.u, d: p.d, s: p.s, r: p.r }));
      localStorage.setItem(KD, JSON.stringify({ d: p.d, r: p.r }));
      put(p.u);
      return true;
    } catch (e) { return false; }
  }
  if (/^#activate=/.test(location.hash)) { var okAct = takeActivation(location.hash); try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {} window.SANAD_ACT_FAILED = !okAct; }
  function fill(id, list, sel, ph) {
    var el = $("#" + id), h = ph ? '<option value="">' + ph + "</option>" : "";
    el.innerHTML = h + list.map(function (x) { return '<option value="' + x + '"' + (x === sel ? " selected" : "") + ">" + x + "</option>"; }).join("");
  }
  fill("old_residence", AREAS, "رفح");
  fill("current_residence", AREAS, "خانيونس");
  fill("housing_type", HOUSING, "", "— اختر —");
  function meta(code) {
    var m = document.querySelector('meta[name="sanad-user"]');
    if (!m) { m = document.createElement("meta"); m.name = "sanad-user"; document.head.appendChild(m); }
    m.content = code;
  }
  function show() {
    var code = get();
    if (code && !dev().d) { put(""); code = ""; }          /* جهاز قديم بلا تفعيل: يلزمه كود تفعيل من المدير */
    $("#setup").hidden = !!code; $("#app").hidden = !code;
    var viewer = dev().r === "viewer";
    if ($("#rform")) $("#rform").hidden = viewer;
    if ($("#viewer-note")) $("#viewer-note").hidden = !viewer;
    if (code) { meta(code); $("#who").textContent = code; document.documentElement.classList.add("locked"); document.dispatchEvent(new Event("sanad-lock")); }
    else document.documentElement.classList.remove("locked");
  }
  var srv = $("#srv"); try { srv.value = localStorage.getItem(KS) || ""; } catch (e) {}
  $("#act-open").addEventListener("click", function () {
    var f = $("#srv-f"), v = srv.value.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) v = "http://" + v;        /* العنوان المحلي بلا شهادة: http. وروابط النفق تُكتب بـ https:// كاملة */
    if (!/^https?:\/\/(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?$/i.test(v)) { f.classList.add("bad"); f.querySelector("small").textContent = "اكتب العنوان كما أعطاك المدير، مثل 192.168.1.20:5000"; return; }
    srv.value = v;
    try { localStorage.setItem(KS, v); } catch (e) {}
    location.href = v + "/activate?r=" + encodeURIComponent(location.origin + location.pathname);
  });
  $("#act-paste").addEventListener("click", function () {
    var f = $("#tok-f");
    if (takeActivation($("#act-token").value)) { f.classList.remove("bad"); show(); } else { f.classList.add("bad"); f.querySelector("small").textContent = "المفتاح غير صالح"; }
  });
  $("#change-emp").addEventListener("click", function () {
    if (window.confirm("إعادة التفعيل تمسح هوية هذا الجهاز عندك، وتحتاج كود تفعيل جديداً من المدير. الطلبات المحفوظة لا تُمسح. المتابعة؟")) {
      put(""); try { localStorage.removeItem(KD); localStorage.removeItem(KP); } catch (e) {} show();
    }
  });
  if (window.SANAD_ACT_FAILED) { var tf = $("#tok-f"); if (tf) { tf.classList.add("bad"); tf.querySelector("small").textContent = "تعذّر قراءة مفتاح التفعيل. أعد التفعيل من المدير."; } }
  var v = $("#ver"); if (v) v.textContent = "سند الموظف الجامع v" + (window.SANAD_VERSION || "?");
  document.addEventListener("sanad-reset", function () { put(""); });      /* «نسيت الرمز»: يمسح offline.js بيانات الجهاز ويطلب مسح الرمز */
  show();
})();

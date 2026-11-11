/* وضع الموظف الجامع: صفحة محلية داخل التطبيق بلا خادم ولا إنترنت.
 * يحدد رمز الموظف (EMP-xxx) مرة واحدة ثم يُوثَّق به كل طلب يجمعه، ويظهر عند المدير «جمعه EMP-xxx». */
(function () {
  "use strict";
  window.SANAD_COLLECTOR = true;
  /* خارج تطبيق أندرويد (آيفون/متصفح): نسجّل service worker ليعمل بلا إنترنت بعد أول فتح. داخل تطبيق أندرويد الملفات من assets فلا حاجة له. */
  window.SANAD_SW_URL = window.SanadAndroid ? null : "sw.js";
  window.SANAD_SW_SCOPE = "./";
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}   // يطلب حماية الطلبات المحفوظة من تنظيف المتصفح
  var $ = function (s) { return document.querySelector(s); };
  var AREAS = ["رفح", "خانيونس", "دير البلح", "المواصي", "النصيرات", "غزة", "جباليا", "بيت لاهيا", "بيت حانون"];
  var HOUSING = ["منزل", "مخيم", "خيمة مستقلة"];
  var K = "sanad-collector-code";
  function get() { try { return localStorage.getItem(K) || ""; } catch (e) { return ""; } }
  function put(v) { try { localStorage.setItem(K, v); } catch (e) {} }
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
    $("#setup").hidden = !!code; $("#app").hidden = !code;
    if (code) { meta(code); $("#who").textContent = code; }
  }
  $("#setup-save").addEventListener("click", function () {
    var v = $("#emp").value.trim().toUpperCase(), f = $("#setup-f");
    if (!/^EMP-\d{3,}$/.test(v)) { f.classList.add("bad"); f.querySelector("small").textContent = "الرمز بصيغة EMP-002 كما أعطاك المدير"; return; }
    put(v); show();
  });
  $("#change-emp").addEventListener("click", function () {
    if (window.confirm("تغيير الرمز يؤثر على الطلبات الجديدة فقط. المتابعة؟")) { put(""); $("#emp").value = ""; show(); }
  });
  var v = $("#ver"); if (v) v.textContent = "سند الموظف الجامع v" + (window.SANAD_VERSION || "?");
  show();
})();

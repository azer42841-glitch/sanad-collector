(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var HUES = ["#0F5F66", "#7A5C1E", "#8A3B5B", "#2C5E8A", "#4B7A3C", "#6A4C93"];

  /* تطبيق أندرويد/الجوال (PWA): تسجيل service worker للملفات الثابتة وصفحة «بلا اتصال» فقط */
  if ("serviceWorker" in navigator && window.SANAD_SW_URL !== null) {
    var hadController = !!navigator.serviceWorker.controller;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(window.SANAD_SW_URL || "/sw.js", { scope: window.SANAD_SW_SCOPE || "/" }).then(function (reg) {
        var check = function () { try { reg.update(); } catch (e) {} };           // يبحث عن إصدار جديد عند فتح التطبيق وعند عودة الاتصال
        window.addEventListener("online", check);
        document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
      }).catch(function () {});
    });
    /* تحديث جديد: لا نعيد التحميل تلقائياً (قد يكون الموظف في منتصف تعبئة طلب)، بل نعرض زراً. الطلبات المحفوظة على الجهاز لا تتأثر. */
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; }
      if (document.getElementById("sanad-update")) return;
      var b = document.createElement("div");
      b.id = "sanad-update"; b.className = "flash ok"; b.setAttribute("role", "status");
      b.innerHTML = '<b>يتوفر إصدار جديد من «سند».</b> <button type="button" class="btn sm" id="sanad-reload">تحديث الآن</button> <span class="muted">لا تُفقد الطلبات المحفوظة على الجهاز.</span>';
      (document.querySelector("main") || document.body).insertBefore(b, (document.querySelector("main") || document.body).firstChild);
      document.getElementById("sanad-reload").addEventListener("click", function () { location.reload(); });
    });
  }

  /* شاشة الدخول: إظهار كلمة المرور وتنبيه Caps Lock */
  var pwt = $("#pw-toggle");
  if (pwt) {
    var pw = $("#password");
    pwt.addEventListener("click", function () { var show = pw.type === "password"; pw.type = show ? "text" : "password"; pwt.textContent = show ? "إخفاء" : "إظهار"; });
    pw.addEventListener("keyup", function (e) { $("#caps-hint").textContent = (e.getModifierState && e.getModifierState("CapsLock")) ? "⚠ مفتاح الأحرف الكبيرة (Caps Lock) مفعّل" : ""; });
  }

  /* ألوان الأحرف الأولى بدلاً من الصور الناقصة */
  $$("[data-hue]").forEach(function (el) { el.style.background = HUES[(+el.dataset.hue) % HUES.length]; });

  /* أشرطة اللوحة */
  var bars = $$("u.w");
  bars.forEach(function (u) { u.style.width = "0"; });
  requestAnimationFrame(function () { setTimeout(function () { bars.forEach(function (u) { u.style.width = u.dataset.w + "%"; }); }, 50); });

  /* الوضع الداكن */
  var tb = $("#theme");
  if (tb) tb.addEventListener("click", function () {
    var r = document.documentElement;
    var dark = r.dataset.theme === "dark" || (!r.dataset.theme && matchMedia("(prefers-color-scheme:dark)").matches);
    r.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("sanad-theme", r.dataset.theme); } catch (e) {}
  });

  /* تأكيد العمليات الحساسة */
  $$("form[data-confirm]").forEach(function (f) {
    f.addEventListener("submit", function (e) { if (!window.confirm(f.dataset.confirm)) e.preventDefault(); });
  });

  /* أزرار النسخ (data-copy): تعمل على https وعلى http داخل الشبكة المحلية (حيث لا يتوفر clipboard) */
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var txt = b.getAttribute("data-copy"), done = function () {
        var old = b.innerHTML; b.textContent = b.getAttribute("data-done") || "تم النسخ";
        setTimeout(function () { b.innerHTML = old; }, 1800);
      }, fallback = function () {
        var ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
        ta.remove(); if (ok) done(); else window.prompt("انسخ النص:", txt);
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, fallback); else fallback();
    });
  });

  /* من أيقونة «اعتماد» في قائمة الطلبات: نفتح قرار الكفيل للحالة المطلوبة في الكشف مباشرة */
  if (/^#r\d+$/.test(location.hash)) { var dd = document.getElementById("d" + location.hash.slice(2)); if (dd) dd.open = true; }

  var pb = $("#print-btn");
  if (pb) pb.addEventListener("click", function () { window.print(); });

  /* إضافة كفيل/جهة جديدة من النماذج دون مغادرتها */
  $$("details.newdonor").forEach(function (box) {
    var sel = document.getElementById(box.dataset.ndTarget), msg = $("[data-nd-msg]", box), btn = $("[data-nd-save]", box);
    if (!sel) return;
    var base = msg.textContent;
    btn.addEventListener("click", function () {
      var name = $("[data-nd-name]", box).value.trim();
      if (name.length < 2) { msg.textContent = "اكتب اسم الكفيل أو الجهة"; return; }
      var body = new URLSearchParams({ name: name, kind: $("[data-nd-kind]", box).value, contact: $("[data-nd-contact]", box).value });
      btn.disabled = true;
      fetch("/donors/quick", { method: "POST", headers: { "X-CSRF-Token": $('meta[name="csrf-token"]').content, "Content-Type": "application/x-www-form-urlencoded" }, body: body })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          btn.disabled = false;
          if (!res.ok || !res.j.ok) { msg.textContent = (res.j && res.j.error) || "تعذرت الإضافة"; return; }
          var opt = $('option[value="' + res.j.id + '"]', sel);
          if (!opt) { opt = document.createElement("option"); opt.value = res.j.id; opt.textContent = res.j.name; sel.appendChild(opt); }
          sel.value = String(res.j.id);
          msg.textContent = res.j.existing ? "«" + res.j.name + "» موجود مسبقاً وتم اختياره." : "تمت إضافة «" + res.j.name + "» واختياره." + (base ? " " + base : "");
          $("[data-nd-name]", box).value = ""; $("[data-nd-contact]", box).value = "";
        })
        .catch(function () { btn.disabled = false; msg.textContent = "تعذر الاتصال بالخادم"; });
    });
  });

  /* تاريخ نهاية الكفالة (معاينة) */
  var spf = $("#spform");
  if (spf) {
    var calc = function () {
      var sd = $("#start_date").value, n = parseInt($("#duration_months").value, 10), out = $("#end_preview");
      if (!sd || !(n >= 1 && n <= 120)) { out.value = ""; return; }
      var p = sd.split("-").map(Number), y = p[0], m = p[1] - 1 + n, d = p[2];
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      var last = new Date(y, m + 1, 0).getDate(), e = new Date(y, m, Math.min(d, last)); e.setDate(e.getDate() - 1);
      out.value = e.getFullYear() + "-" + ("0" + (e.getMonth() + 1)).slice(-2) + "-" + ("0" + e.getDate()).slice(-2);
    };
    ["start_date", "duration_months"].forEach(function (id) { $("#" + id).addEventListener("input", calc); });
    calc();
  }

  /* نوع المساعدة: إظهار اختيار الطفل لأنواع «لكل يتيم» */
  var at = $("#aid_type");
  if (at) {
    var peror = []; try { peror = JSON.parse(at.dataset.peror || "[]"); } catch (e) {}
    var tw = $("#target-wrap");
    var sync = function () { tw.hidden = peror.indexOf(at.value) < 0; };
    at.addEventListener("change", sync); sync();
  }

  /* نموذج «طلب جديد»: معاينة المرفقات + نفس رقم الجوال والواتساب */
  var rf = $("#rform");
  if (rf) {
    var up = function (id) { var e = $("#" + id); return e; };
    ["child_id", "phone", "whatsapp"].forEach(function (id) { up(id).addEventListener("input", function (e) { e.target.value = e.target.value.replace(/\D/g, ""); }); });
    var same = $("#same-num");
    same.addEventListener("change", function () { if (same.checked) up("whatsapp").value = up("phone").value; });
    up("phone").addEventListener("input", function () { if (same.checked) up("whatsapp").value = up("phone").value; });
    $$(".slot", rf).forEach(function (slot) {
      var inp = $("input[type=file]", slot);
      var show = function (f) {
        if (!f) return;
        if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) { slot.classList.add("miss"); $("small", slot).textContent = "الصيغة غير مدعومة أو الحجم أكبر من 5MB"; inp.value = ""; return; }
        var r = new FileReader();
        r.onload = function () {
          var img = $("img", slot) || document.createElement("img"); img.alt = ""; img.src = r.result;
          var svg = $("svg", slot); if (svg) svg.replaceWith(img); else if (!img.parentNode) slot.insertBefore(img, slot.firstChild);
          slot.classList.add("has"); slot.classList.remove("miss");
          var q = $(".req", slot); q.classList.add("ok"); q.textContent = "تم الاختيار ✓"; $("small", slot).textContent = "اضغط للتغيير";
        };
        r.readAsDataURL(f);
      };
      inp.addEventListener("change", function () { show(inp.files[0]); });
      slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("over"); });
      slot.addEventListener("dragleave", function () { slot.classList.remove("over"); });
      slot.addEventListener("drop", function (e) { e.preventDefault(); slot.classList.remove("over"); var f = e.dataTransfer.files[0]; if (!f) return; var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; show(f); });
    });
    rf.addEventListener("submit", function () { $("#rsubmit").disabled = true; });
  }

  /* إثبات الكفالة */
  var ps = $("#proof-slot");
  if (ps) {
    var pi = $("input[type=file]", ps);
    pi.addEventListener("change", function () {
      var f = pi.files[0]; if (!f) return;
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) {
        ps.classList.add("miss"); $("small", ps).textContent = "الصيغة غير مدعومة أو الحجم أكبر من 5MB"; pi.value = ""; return;
      }
      var r = new FileReader();
      r.onload = function () {
        var img = $("img", ps) || document.createElement("img"); img.alt = ""; img.src = r.result;
        var svg = $("svg", ps); if (svg) svg.replaceWith(img);
        ps.classList.add("has"); ps.classList.remove("miss");
        var q = $(".req", ps); q.classList.add("ok"); q.textContent = "تم الاختيار ✓";
        $("small", ps).textContent = "اضغط للتغيير";
      };
      r.readAsDataURL(f);
    });
    ps.addEventListener("dragover", function (e) { e.preventDefault(); ps.classList.add("over"); });
    ps.addEventListener("dragleave", function () { ps.classList.remove("over"); });
    ps.addEventListener("drop", function (e) {
      e.preventDefault(); ps.classList.remove("over");
      var f = e.dataTransfer.files[0]; if (!f) return;
      var dt = new DataTransfer(); dt.items.add(f); pi.files = dt.files; pi.dispatchEvent(new Event("change"));
    });
    var pf = $("#pform");
    pf.addEventListener("submit", function (e) {
      if (!pi.files.length) { e.preventDefault(); ps.classList.add("miss"); $("small", ps).textContent = "مستند الإثبات مطلوب قبل الحفظ"; ps.scrollIntoView({behavior: "smooth", block: "center"}); }
      else $("#psubmit").disabled = true;
    });
  }

  /* ================= نموذج التسجيل ================= */
  var form = $("#form");
  if (!form) return;

  var AGE_LIMIT_YEARS = 25;
  var steps = $$(".step", form), cur = 0;
  var groups = [["martyr_name", "martyrdom_date"], ["name", "national_id", "birth_date"],
                ["guardian_name", "guardian_id", "whatsapp", "account"], []];
  var today = new Date(); today.setHours(0, 0, 0, 0);

  var rules = {
    martyr_name: function (v) { return v.trim().split(/\s+/).length >= 2 || "اكتب الاسم الأول واسم العائلة على الأقل"; },
    martyrdom_date: function (v) { return (!!v && new Date(v) <= today) || "اختر تاريخاً لا يتجاوز اليوم"; },
    name: function (v) { return v.trim().length >= 3 || "اكتب اسم الطفل"; },
    national_id: function (v) { return /^\d{9}$/.test(v) || "رقم الهوية 9 أرقام بالضبط"; },
    birth_date: function (v) {
      var d = new Date(v);
      return (!!v && d <= today && d.getFullYear() >= today.getFullYear() - AGE_LIMIT_YEARS) || "تاريخ الميلاد غير صحيح";
    },
    guardian_name: function (v) { return v.trim().length >= 3 || "اكتب اسم الوصي"; },
    guardian_id: function (v) { return /^\d{9}$/.test(v) || "رقم الهوية 9 أرقام بالضبط"; },
    whatsapp: function (v) { return /^05[69]\d{7}$/.test(v) || "الجوال يبدأ بـ 059 أو 056 ويتكون من 10 أرقام"; },
    account: function (v) { var n = v.trim().length; return (n >= 8 && n <= 40) || "أدخل رقم الحساب أو المحفظة كاملاً"; }
  };

  function check(id) {
    var f = $("#" + id), w = f.closest(".field"), r = rules[id](f.value), ok = r === true;
    w.classList.toggle("bad", !ok);
    w.classList.toggle("good", ok);
    w.querySelector("small").textContent = ok ? "" : r;
    return ok;
  }
  Object.keys(rules).forEach(function (id) { $("#" + id).addEventListener("blur", function () { check(id); }); });
  ["national_id", "guardian_id", "whatsapp"].forEach(function (id) {
    $("#" + id).addEventListener("input", function (e) { e.target.value = e.target.value.replace(/\D/g, ""); });
  });

  /* مسودة تُحفظ في الجلسة فقط، بدون الهويات والجوال والحساب */
  var DRAFT_KEY = "sanad-draft-" + (form.dataset.draft || "new");
  var SENSITIVE = ["national_id", "guardian_id", "whatsapp", "account"];
  var isEdit = (form.dataset.draft || "").indexOf("edit-") === 0;
  if (!isEdit) {
    try {
      var saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "null");
      if (saved) Object.keys(saved).forEach(function (k) { var e = $("#" + k); if (e && !e.value) e.value = saved[k]; });
    } catch (e) {}
    form.addEventListener("input", function () {
      try {
        var o = {};
        $$("input:not([type=file]):not([type=hidden]),select", form).forEach(function (e) { if (SENSITIVE.indexOf(e.id) < 0) o[e.id] = e.value; });
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(o));
      } catch (e) {}
    });
    form.addEventListener("submit", function () { try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) {} });
  }

  function show(n) {
    cur = n;
    steps.forEach(function (s, i) { s.classList.toggle("on", i === n); });
    $$("#stepper li").forEach(function (li, i) { li.classList.toggle("cur", i === n); li.classList.toggle("done", i < n); });
    $("#prev").disabled = n === 0;
    $("#next").textContent = n === 3 ? (isEdit ? "حفظ التعديلات" : "حفظ بيانات اليتيم") : "التالي";
    if (n === 3) review();
    window.scrollTo(0, 0);
  }
  function val(id) { var e = $("#" + id); return e ? (e.tagName === "SELECT" ? e.options[e.selectedIndex].text : e.value) || "—" : "—"; }
  function review() {
    var rows = [["الشهيد", val("martyr_name")], ["تاريخ الاستشهاد", val("martyrdom_date")], ["الطفل", val("name")],
      ["هوية الطفل", val("national_id")], ["السكن", val("original_residence") + " ← " + val("current_residence")],
      ["الوصي", val("guardian_name") + " (" + val("relation") + ")"], ["واتساب", val("whatsapp")], ["الحساب", val("account_type")]];
    var dl = $("#review"); dl.textContent = "";
    rows.forEach(function (r) {
      var d = document.createElement("div"), t = document.createElement("dt"), v = document.createElement("dd");
      t.textContent = r[0]; v.textContent = r[1]; d.appendChild(t); d.appendChild(v); dl.appendChild(d);
    });
  }

  /* خانات المستندات */
  function attached(slot) { var i = $("input[type=file]", slot); return (i.files && i.files.length) || slot.classList.contains("has"); }
  function setSlot(slot, file) {
    var inp = $("input[type=file]", slot);
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { slot.classList.add("miss"); $("small", slot).textContent = "الصيغة غير مدعومة (JPG أو PNG أو WebP)"; inp.value = ""; return; }
    if (file.size > 5 * 1024 * 1024) { slot.classList.add("miss"); $("small", slot).textContent = "الحجم أكبر من 5MB"; inp.value = ""; return; }
    var r = new FileReader();
    r.onload = function () {
      var img = $("img", slot) || document.createElement("img");
      img.alt = ""; img.src = r.result;
      var svg = $("svg", slot); if (svg) svg.replaceWith(img); else if (!img.parentNode) slot.insertBefore(img, slot.firstChild);
      slot.classList.add("has"); slot.classList.remove("miss");
      var q = $(".req", slot); q.classList.add("ok"); q.textContent = "تم الاختيار ✓";
      $("small", slot).textContent = "اضغط للتغيير";
    };
    r.readAsDataURL(file);
  }
  $$(".slot").forEach(function (slot) {
    var inp = $("input[type=file]", slot);
    inp.addEventListener("change", function () { if (inp.files[0]) setSlot(slot, inp.files[0]); });
    slot.addEventListener("dragover", function (e) { e.preventDefault(); slot.classList.add("over"); });
    slot.addEventListener("dragleave", function () { slot.classList.remove("over"); });
    slot.addEventListener("drop", function (e) {
      e.preventDefault(); slot.classList.remove("over");
      var f = e.dataTransfer.files[0]; if (!f) return;
      var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; setSlot(slot, f);
    });
  });

  $("#next").addEventListener("click", function () {
    var ok = true;
    groups[cur].forEach(function (id) { if (!check(id)) ok = false; });
    if (!ok) { var b = $(".bad input", form); if (b) b.focus(); return; }
    if (cur < 3) return show(cur + 1);
    var lack = $$(".slot", form).filter(function (s) { return !attached(s); });
    $$(".slot", form).forEach(function (s) { s.classList.toggle("miss", lack.indexOf(s) >= 0); });
    var wv = $("#waive_docs") || $("#waived_by_request");        /* إقرار المدير: يسمح بالمتابعة رغم نقص المستندات */
    if (lack.length && !(wv && (wv.type === "hidden" || wv.checked))) { alert_lack(lack.length); return; }
    $("#next").disabled = true;
    form.submit();
  });
  function alert_lack(n) {
    var box = $("#doc-msg") || document.createElement("div");
    box.id = "doc-msg"; box.className = "flash error"; box.textContent = "ينقص " + n + " من المستندات المطلوبة";
    $(".docs", form).before(box);
  }
  $("#prev").addEventListener("click", function () { if (cur > 0) show(cur - 1); });

  /* بعد خطأ من الخادم: انتقل إلى أول خطوة فيها خطأ */
  var firstBad = $(".bad, .slot.miss", form);
  if (firstBad) { var st = firstBad.closest(".step"); if (st) show(steps.indexOf(st)); }
})();

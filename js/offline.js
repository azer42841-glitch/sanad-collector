/* العمل دون اتصال: إدخال «طلب جديد» على الجهاز بلا إنترنت ثم المزامنة عند عودة الشبكة.
 * الأمان: كل ما يُحفظ على الجهاز (حقول وصور) مشفَّر AES-GCM-256 بمفتاح مشتق من «رمز حماية الجهاز» (PBKDF2 بـ 250 ألف دورة).
 * الرمز لا يُحفظ أبداً، ولا تُقرأ البيانات إلا بعد إدخاله. لا تُخزَّن بيانات الأيتام المعروضة، بل الطلبات الجديدة المنتظرة للإرسال فقط.
 */
(function () {
  "use strict";
  if (!window.indexedDB || !window.crypto || !crypto.subtle) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var COLLECTOR = !!window.SANAD_COLLECTOR;   // وضع الموظف الجامع: صفحة محلية في التطبيق بلا خادم، لا مزامنة بل ترحيل ملف فقط
  var DB = "sanad-offline", Q = "queue", M = "meta", KEY = null, syncing = false;
  var enc = new TextEncoder(), dec = new TextDecoder();

  /* ---------- IndexedDB ---------- */
  function open() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { var d = r.result; d.createObjectStore(Q, { keyPath: "id" }); d.createObjectStore(M, { keyPath: "k" }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function run(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store, mode), s = t.objectStore(store), out = fn(s);
        t.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); db.close(); };
        t.onerror = function () { rej(t.error); db.close(); };
      });
    });
  }
  var idbGet = function (s, k) { return run(s, "readonly", function (st) { return st.get(k); }); };
  var idbPut = function (s, v) { return run(s, "readwrite", function (st) { return st.put(v); }); };
  var idbDel = function (s, k) { return run(s, "readwrite", function (st) { return st.delete(k); }); };
  var idbAll = function (s) { return run(s, "readonly", function (st) { return st.getAll(); }); };

  /* ---------- التشفير ---------- */
  function derive(pin, salt) {
    return crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function encBuf(buf, key) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key || KEY, buf).then(function (ct) { return { iv: iv, ct: ct }; });
  }
  function decBuf(o, key) { return crypto.subtle.decrypt({ name: "AES-GCM", iv: o.iv }, key || KEY, o.ct); }

  /* ---------- نافذة رمز الحماية ---------- */
  function askPin(opts) {
    return new Promise(function (resolve) {
      var ov = document.createElement("div");
      ov.className = "modal-ov";
      ov.innerHTML = '<form class="modal card" role="dialog" aria-modal="true" aria-labelledby="pin-t"><h3 id="pin-t"></h3><p class="muted" id="pin-d"></p>' +
        '<div class="field"><label for="pin-1" id="pin-l"></label><input id="pin-1" type="password" inputmode="numeric" autocomplete="off" dir="ltr"><small></small></div>' +
        '<div class="field" id="pin-2w" hidden><label for="pin-2">أعد كتابة الرمز</label><input id="pin-2" type="password" inputmode="numeric" autocomplete="off" dir="ltr"><small></small></div>' +
        '<div class="lerr" id="pin-e" hidden></div><div class="actions"><button type="button" class="btn sec" id="pin-c">إلغاء</button><button type="submit" class="btn">متابعة</button></div><button type="button" class="btn sec sm" id="pin-f" hidden>نسيت الرمز؟</button></form>';
      document.body.appendChild(ov);
      $("#pin-t", ov).textContent = opts.title;
      $("#pin-d", ov).textContent = opts.desc;
      $("#pin-l", ov).textContent = opts.label || "رمز حماية الجهاز";
      var lo = opts.min || 8, hi = opts.max || 12;
      if (opts.confirm) $("#pin-2w", ov).hidden = false;
      var i1 = $("#pin-1", ov), i2 = $("#pin-2", ov), er = $("#pin-e", ov), sb = $("button[type=submit]", ov);
      if (opts.lock) { ov.classList.add("lockov"); $("#pin-c", ov).hidden = true; }
      if (opts.forgot) { var fb = $("#pin-f", ov); fb.hidden = false; fb.addEventListener("click", opts.forgot); }
      if (opts.wait > 0) {        /* بعد محاولات خاطئة كثيرة: انتظار قبل المحاولة التالية */
        var left = opts.wait; sb.disabled = true; i1.disabled = true; er.hidden = false;
        var tm = setInterval(function () {
          left -= 1; er.textContent = "محاولات خاطئة كثيرة. انتظر " + left + " ثانية";
          if (left <= 0) { clearInterval(tm); sb.disabled = false; i1.disabled = false; er.hidden = true; i1.focus(); }
        }, 1000);
        er.textContent = "محاولات خاطئة كثيرة. انتظر " + left + " ثانية";
      } else i1.focus();
      function done(v) { ov.remove(); resolve(v); }
      $("#pin-c", ov).addEventListener("click", function () { done(null); });
      $("form", ov).addEventListener("submit", function (e) {
        e.preventDefault();
        var v = opts.strip ? i1.value.replace(/\D/g, "") : i1.value;
        if (!new RegExp("^\\d{" + lo + "," + hi + "}$").test(v)) { er.hidden = false; er.textContent = lo === hi ? "الرمز " + lo + " رقماً" : "الرمز من " + lo + " إلى " + hi + " رقماً"; return; }
        if (opts.confirm && v !== i2.value) { er.hidden = false; er.textContent = "الرمزان غير متطابقين"; return; }
        done(v);
      });
    });
  }
  /* يضمن وجود المفتاح في الذاكرة: إنشاء رمز لأول مرة، أو إدخاله للفتح */
  function failState() { return idbGet(M, "fail").then(function (s) { return s || {}; }, function () { return {}; }); }
  function failSave(s) { s.k = "fail"; return idbPut(M, s).catch(function () {}); }
  /* «نسيت الرمز»: لا استرجاع. يُمسح ما على هذا الجهاز (الطلبات غير المُرحَّلة تضيع) ويُعاد الإعداد */
  function wipeDevice() {
    if (!window.confirm("نسيان الرمز لا حل له إلا مسح بيانات هذا الجهاز: تضيع الطلبات المحفوظة التي لم تُرحَّل، ويُعاد الإعداد من البداية. هل تريد المسح؟")) return;
    if (!window.confirm("تأكيد أخير: مسح كل بيانات سند على هذا الجهاز نهائياً؟")) return;
    document.dispatchEvent(new Event("sanad-reset"));          /* collector.js يمسح رمز الموظف */
    var r = indexedDB.deleteDatabase(DB);
    r.onsuccess = r.onerror = r.onblocked = function () { location.reload(); };
  }
  function ensureKey(mode) {
    if (KEY) return Promise.resolve(true);
    var lock = !!(mode && mode.lock);
    return idbGet(M, "kdf").then(function (kdf) {
      if (!kdf) {
        return askPin({ title: lock ? "قفل التطبيق وحماية البيانات" : "حماية البيانات على هذا الجهاز", desc: lock ? "اختر رمزاً من 8 أرقام فأكثر. يُطلب لفتح التطبيق ولحماية الطلبات المحفوظة (تُشفَّر به). لا يمكن استرجاعه إن نُسي، ولا يُرسل إلى أي مكان." : "اختر رمزاً من 8 أرقام فأكثر. تُشفَّر به الطلبات المحفوظة دون اتصال. لا يمكن استرجاعه إن نُسي، ولا يُرسل إلى أي مكان.", confirm: true, lock: lock }).then(function (pin) {
          if (!pin) return false;
          var salt = crypto.getRandomValues(new Uint8Array(16));
          return derive(pin, salt).then(function (k) { KEY = k; return encBuf(enc.encode("sanad-ok")); })
            .then(function (check) { return idbPut(M, { k: "kdf", salt: salt, check: check }); }).then(function () { return true; });
        });
      }
      function attempt(n) {
        return failState().then(function (fs) {
          var wait = Math.max(0, Math.ceil(((fs.until || 0) - Date.now()) / 1000));
          return askPin({ title: lock ? "سند مقفل" : "فتح الطلبات المحفوظة", desc: n ? "الرمز غير صحيح. حاول مرة أخرى." : lock ? "أدخل رمز حماية الجهاز لفتح التطبيق." : "أدخل رمز حماية الجهاز.",
                          lock: lock, wait: wait, forgot: lock ? wipeDevice : null }).then(function (pin) {
            if (!pin) return false;
            return derive(pin, kdf.salt).then(function (k) {
              KEY = k;
              return decBuf(kdf.check).then(function () { return failSave({}).then(function () { return true; }); }, function () {
                KEY = null;
                return failState().then(function (s) {
                  s.n = (s.n || 0) + 1;
                  if (s.n >= 5) s.until = Date.now() + Math.min(300, 30 * Math.pow(2, s.n - 5)) * 1000;      /* 30ث ثم 60 ثم 120... حتى 5 دقائق */
                  return failSave(s);
                }).then(function () { return (!lock && n >= 4) ? false : attempt(n + 1); });
              });
            });
          });
        });
      }
      return attempt(0);
    });
  }

  /* ---------- تحقق مبدئي (يطابق قواعد الخادم) قبل الحفظ دون اتصال ---------- */
  function validate(f) {
    var e = {}, words = function (t) { return (t || "").trim().split(/\s+/).filter(Boolean).length; }, ph = /^05[69]\d{7}$/;
    if (words(f.child_name) < 4) e.child_name = "اسم اليتيم رباعي: أربعة أسماء على الأقل";
    if (!/^\d{9}$/.test(f.child_id || "")) e.child_id = "رقم الهوية 9 أرقام بالضبط";
    if (words(f.martyr_name) < 2) e.martyr_name = "اكتب اسم الشهيد";
    if (!f.martyr_date || f.martyr_date > new Date().toISOString().slice(0, 10)) e.martyr_date = "تاريخ الاستشهاد غير صحيح";
    if (words(f.guardian_name) < 2) e.guardian_name = "اكتب اسم الوصي (اسمان على الأقل)";
    if (!f.account_type) e.account_type = "اختر بنك أو محفظة";
    if (((f.account || "").trim()).length < 8) e.account = "أدخل رقم الحساب أو المحفظة كاملاً";
    if (f.phone && !ph.test(f.phone)) e.phone = "الرقم يبدأ بـ 059 أو 056 ويتكون من 10 أرقام";
    if (f.whatsapp && !ph.test(f.whatsapp)) e.whatsapp = "الرقم يبدأ بـ 059 أو 056 ويتكون من 10 أرقام";
    if (!f.phone && !f.whatsapp && !e.phone && !e.whatsapp) e.phone = "أدخل رقم جوال أو واتساب واحداً على الأقل";
    if (!f.housing_type) e.housing_type = "اختر طبيعة السكن";
    if (!f.old_residence) e.old_residence = "اختر مكان السكن القديم";
    if (!f.current_residence) e.current_residence = "اختر مكان السكن الحالي";
    return e;
  }

  /* ---------- ضغط الصور قبل الحفظ (يوفر المساحة) ---------- */
  function shrink(file) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || file); }, "image/jpeg", 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }

  /* ---------- سرّ الجهاز المفعَّل: يُحفظ مشفَّراً برمز الحماية، ويوقّع كل طلب يجمعه الجهاز ---------- */
  function hmacHex(secret, msg) {
    return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]).then(function (k) {
      return crypto.subtle.sign("HMAC", k, enc.encode(msg));
    }).then(function (sig) { return Array.prototype.map.call(new Uint8Array(sig), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); });
  }
  function adoptDevice() {
    var take = window.SANAD_TAKE_PENDING_DEVICE, p = take && take();
    if (!p || !KEY) return Promise.resolve();
    return encBuf(enc.encode(p.s)).then(function (o) { return idbPut(M, { k: "device", d: p.d, iv: o.iv, ct: o.ct }); });
  }
  function signFields(fields) {
    return idbGet(M, "device").then(function (dv) {
      if (!dv || !KEY) return;
      return decBuf({ iv: dv.iv, ct: dv.ct }).then(function (buf) {
        return hmacHex(dec.decode(buf), fields.client_uid + "|" + fields.collected_by + "|" + dv.d).then(function (h) { fields.device_id = String(dv.d); fields.device_mac = h; });
      });
    });
  }

  /* ---------- الحفظ في الطابور المشفَّر ---------- */
  function me() { var m = document.querySelector('meta[name="sanad-user"]'); return m ? m.content : ""; }
  function saveEntry(form, fields) {
    var files = [];
    fields.collected_by = me();          // يوثّق من جمع الطلب حتى لو رُحِّل وزُوِمن من جهاز آخر
    var chain = Promise.resolve();
    Array.prototype.forEach.call(form.querySelectorAll('input[type=file]'), function (inp) {
      if (inp.files && inp.files[0]) chain = chain.then(function () {
        return shrink(inp.files[0]).then(function (b) { return b.arrayBuffer(); }).then(function (buf) { return encBuf(buf); })
          .then(function (e) { files.push({ name: inp.name, iv: e.iv, ct: e.ct, type: "image/jpeg" }); });
      });
    });
    return chain.then(function () { return COLLECTOR ? signFields(fields) : null; }).then(function () { return encBuf(enc.encode(JSON.stringify(fields))); }).then(function (meta) {
      var id = fields.client_uid;
      return idbPut(Q, { id: id, created: new Date().toISOString(), status: "pending", error: "", meta: meta, files: files });
    });
  }


  /* ---------- ترحيل الطلبات بين الأجهزة عبر ملف مشفَّر (بلوتوث/Nearby/أي مشاركة) ---------- */
  function b64(buf) { var u = new Uint8Array(buf), s = "", i; for (i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(t) { var s = atob(t), u = new Uint8Array(s.length), i; for (i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  function packEnc(e) { return { iv: b64(e.iv), ct: b64(e.ct) }; }
  function unpackEnc(o) { return { iv: unb64(o.iv), ct: unb64(o.ct) }; }
  function newCode() { var a = crypto.getRandomValues(new Uint32Array(3)), d = ""; a.forEach(function (x) { d += ("0000" + (x % 10000)).slice(-4); }); return d; }   // 12 رقماً عشوائياً
  function fmtCode(c) { return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8, 12); }
  function download(file) { var a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
  function shareFile(file) {
    if (window.SanadAndroid && window.SanadAndroid.shareFile) {   // داخل تطبيق أندرويد: قائمة المشاركة الأصلية (بلوتوث، Nearby...)
      return file.arrayBuffer().then(function (buf) { window.SanadAndroid.shareFile(file.name, b64(buf), "application/octet-stream"); });
    }
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: "طلبات سند", text: "ملف طلبات مشفَّر من نظام سند. رمز النقل يُبلَّغ شفهياً ولا يُرسل مع الملف." })
        .catch(function (e) { if (!e || e.name !== "AbortError") download(file); });
    }
    download(file); return Promise.resolve();
  }
  function stamp() { var d = new Date(); return d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2) + "-" + ("0" + d.getHours()).slice(-2) + ("0" + d.getMinutes()).slice(-2); }

  function exportBundle() {
    return idbAll(Q).then(function (items) {
      items = items.filter(function (i) { return i.status === "pending"; });
      if (!items.length) { toast("لا توجد طلبات بانتظار الإرسال"); return; }
      return ensureKey().then(function (ok) {
        if (!ok) return;
        var code = newCode(), salt = crypto.getRandomValues(new Uint8Array(16));
        return derive(code, salt).then(function (tk) {
          var recs = [];
          return items.reduce(function (chain, it) {
            return chain.then(function () {
              return decBuf(it.meta).then(function (m) { return encBuf(m, tk); }).then(function (meta) {
                return Promise.all(it.files.map(function (f) {
                  return decBuf(f).then(function (buf) { return encBuf(buf, tk); }).then(function (e) { return { name: f.name, type: f.type, iv: b64(e.iv), ct: b64(e.ct) }; });
                })).then(function (files) { recs.push({ id: it.id, created: it.created, meta: packEnc(meta), files: files }); });
              });
            });
          }, Promise.resolve()).then(function () { return encBuf(enc.encode("sanad-transfer"), tk); }).then(function (check) {
            var vm = document.querySelector('meta[name="sanad-version"]');
            var bundle = { v: 1, app: "sanad-offline-bundle", ver: window.SANAD_VERSION || (vm ? vm.content : ""), created: new Date().toISOString(), count: recs.length, salt: b64(salt), check: packEnc(check), records: recs };
            var file = new File([JSON.stringify(bundle)], "sanad-transfer-" + stamp() + ".sanad", { type: "application/json" });
            showExport(file, code, items);
          });
        });
      });
    });
  }
  function showExport(file, code, items) {
    var ov = document.createElement("div"); ov.className = "modal-ov";
    ov.innerHTML = '<div class="modal card" role="dialog" aria-modal="true"><h3>ترحيل ' + items.length + ' طلب إلى جهاز آخر</h3>' +
      '<p class="muted">الملف مشفَّر. أرسله بالبلوتوث أو أي وسيلة، ثم أبلغ المستلِم بـ<b>رمز النقل</b> شفهياً أو برسالة منفصلة. لا ترسله مع الملف.</p>' +
      '<div class="xfer-code" id="xc"></div>' +
      '<div class="actions"><button class="btn" type="button" id="xs">مشاركة الملف (بلوتوث…)</button><button class="btn sec" type="button" id="xd">تنزيل الملف</button></div>' +
      '<p class="muted" style="margin:0">بعد أن يؤكد المستلِم المزامنة يمكنك حذف الطلبات المُرحَّلة من هذا الجهاز.</p><div class="actions"><button class="btn sec" type="button" id="xx">تم</button></div></div>';
    document.body.appendChild(ov);
    $("#xc", ov).textContent = fmtCode(code);
    var mark = function () { return Promise.all(items.map(function (it) { it.exportedAt = new Date().toISOString(); return idbPut(Q, it); })).then(render); };
    $("#xs", ov).addEventListener("click", function () { shareFile(file).then(mark); });
    $("#xd", ov).addEventListener("click", function () { download(file); mark(); });
    $("#xx", ov).addEventListener("click", function () { ov.remove(); });
  }

  function importBundle(file) {
    if (!file) return Promise.resolve();
    if (file.size > 80 * 1024 * 1024) { toast("الملف كبير جداً"); return Promise.resolve(); }
    return file.text().then(function (txt) {
      var b; try { b = JSON.parse(txt); } catch (e) { toast("الملف ليس ملف ترحيل سند صالحاً"); return; }
      if (!b || b.v !== 1 || b.app !== "sanad-offline-bundle" || !Array.isArray(b.records) || b.records.length > 200 || !b.salt || !b.check) { toast("الملف ليس ملف ترحيل سند صالحاً"); return; }
      var bad = b.records.some(function (r) { return !/^c-[0-9a-f]{24}$/.test(r.id) || !r.meta || !Array.isArray(r.files) || r.files.length > 5 || r.files.some(function (f) { return !/^doc_(face|death|birth|wasi|guardian_id)$/.test(f.name); }); });
      if (bad) { toast("الملف تالف أو غير صالح"); return; }
      function attempt(n) {
        return askPin({ title: "استلام طلبات من جهاز آخر", desc: n ? "الرمز غير صحيح. اطلب الرمز من المرسِل وحاول مجدداً." : "أدخل «رمز النقل» (12 رقماً) الذي أبلغك به المرسِل.", label: "رمز النقل", min: 12, max: 12, strip: true }).then(function (code) {
          if (!code) return null;
          return derive(code, unb64(b.salt)).then(function (tk) { return decBuf(unpackEnc(b.check), tk).then(function () { return tk; }, function () { return n >= 4 ? null : attempt(n + 1); }); });
        });
      }
      return attempt(0).then(function (tk) {
        if (!tk) return;
        return ensureKey().then(function (ok) {
          if (!ok) { toast("لم تُستلم الطلبات: يلزم رمز حماية هذا الجهاز"); return; }
          return idbAll(Q).then(function (have) {
            var ids = {}; have.forEach(function (h) { ids[h.id] = 1; });
            var added = 0, skipped = 0;
            return b.records.reduce(function (chain, r) {
              return chain.then(function () {
                if (ids[r.id]) { skipped++; return; }
                return decBuf(unpackEnc(r.meta), tk).then(function (m) { return encBuf(m); }).then(function (meta) {
                  return Promise.all(r.files.map(function (f) { return decBuf(unpackEnc(f), tk).then(function (buf) { return encBuf(buf); }).then(function (e) { return { name: f.name, type: f.type || "image/jpeg", iv: e.iv, ct: e.ct }; }); }))
                    .then(function (files) { added++; return idbPut(Q, { id: r.id, created: r.created, status: "pending", error: "", meta: meta, files: files, imported: true }); });
                });
              });
            }, Promise.resolve()).then(function () {
              toast("استُلم " + added + " طلب" + (skipped ? " (وتجاوز " + skipped + " مستلَماً سابقاً)" : "") + (navigator.onLine ? ". اضغط «مزامنة الآن»" : ". ستُزامَن عند توفر الإنترنت"));
              return render();
            });
          });
        });
      });
    }, function () { toast("تعذرت قراءة الملف"); });
  }
  function pickBundle() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".sanad,application/json"; inp.hidden = true;
    document.body.appendChild(inp);
    inp.addEventListener("change", function () { var f = inp.files[0]; inp.remove(); importBundle(f); });
    inp.click();
  }
  function renderTools(items) {
    var box = $("#ob-tools"); if (!box) return;
    var pending = items.filter(function (i) { return i.status === "pending"; }).length;
    box.innerHTML = (COLLECTOR ? "" : '<button type="button" class="btn sec sm" id="ob-import">استلام طلبات من جهاز آخر</button>') +
      (pending ? ' <button type="button" class="btn sm" id="ob-export">ترحيل ' + pending + ' طلب (بلوتوث/مشاركة)</button>' : "");
  }

  /* ---------- مدة الاحتفاظ: ما مضى على حفظه 6 أشهر يُحذف تلقائياً من الجوال (يحتاج الموظف أن يرحّل طلباته بانتظام) ---------- */
  var RETAIN_DAYS = 180, WARN_DAYS = 30;
  function ageDays(it) { var t = Date.parse(it.created || ""); return isNaN(t) ? 0 : (Date.now() - t) / 86400000; }
  function purgeOld() {
    return idbAll(Q).then(function (all) {
      var old = all.filter(function (i) { return ageDays(i) > RETAIN_DAYS; });
      if (!old.length) return 0;
      return Promise.all(old.map(function (i) { return idbDel(Q, i.id); })).then(function () { return old.length; });
    });
  }
  function purgeAndRender() {
    return purgeOld().then(function (n) { if (n) toast("حُذف " + n + " طلب مضى على حفظه أكثر من 6 أشهر"); return render(); });
  }
  function retentionNote(items) {
    var soon = items.filter(function (i) { return ageDays(i) > RETAIN_DAYS - WARN_DAYS; }).length;
    return soon ? ' <b class="redtxt">⚠ ' + soon + ' طلب محفوظ منذ أكثر من 5 أشهر وسيُحذف تلقائياً عند بلوغ 6 أشهر. رحِّله الآن.</b>' : "";
  }

  /* ---------- شريط الحالة ---------- */
  var bar = null;
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "sanad-offline-bar"; bar.setAttribute("role", "status");
    var host = $("main") || document.body; host.insertBefore(bar, host.firstChild);
    return bar;
  }
  function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }
  function render() {
    return idbAll(Q).then(function (items) {
      renderTools(items);
      var offline = !COLLECTOR && !navigator.onLine, b = ensureBar();
      if (!offline && !items.length) { b.hidden = true; return; }
      if (COLLECTOR) {
        b.hidden = false; b.className = "flash";
        b.innerHTML = '<b>' + items.length + ' طلب محفوظ مشفَّراً على هذا الجهاز</b>' + retentionNote(items) + ' <span class="muted">رحِّلها إلى الحاسوب المركزي بالزر أعلاه عبر بلوتوث أو كابل أو فلاش.</span> ' +
          (items.some(function (i) { return i.exportedAt; }) ? '<button type="button" class="btn sec sm" id="ob-purge">حذف المُرحَّلة بعد تأكيد المستلِم</button>' : "");
        return;
      }
      b.hidden = false; b.className = "flash" + (offline ? " error" : "");
      var html = "";
      if (offline) html += '<b>⚠ أنت غير متصل بالإنترنت.</b> يمكنك تسجيل «طلب جديد» وسيُحفظ مشفَّراً على هذا الجهاز ويُرسل عند عودة الاتصال. ';
      if (items.length) {
        html += '<b>' + items.length + ' طلب محفوظ على الجهاز بانتظار المزامنة</b>' + retentionNote(items) + ' ';
        html += '<button type="button" class="btn sm" id="ob-sync"' + (offline ? " disabled" : "") + '>مزامنة الآن</button> ';
        if (items.some(function (i) { return i.exportedAt; })) html += '<button type="button" class="btn sec sm" id="ob-purge">حذف المُرحَّلة بعد تأكيد المستلِم</button> ';
        items.forEach(function (it, i) {
          html += '<div class="ob-item"><span>الطلب ' + (i + 1) + ' · ' + esc(it.created.slice(0, 16).replace("T", " ")) + ' UTC</span>' +
            (it.status === "error" ? ' <span class="redtxt">' + esc(it.error) + '</span> <button type="button" class="btn sec sm" data-ob-edit="' + esc(it.id) + '">فتح للتصحيح</button> <button type="button" class="btn sec sm" data-ob-del="' + esc(it.id) + '">حذف</button>' : ' <span class="muted">' + (it.imported ? "مستلَم من جهاز آخر · " : "") + (it.exportedAt ? "رُحِّل عبر ملف، بانتظار تأكيد المستلِم" : "بانتظار الإرسال") + '</span>') + '</div>';
        });
      }
      b.innerHTML = html;
    });
  }

  /* ---------- المزامنة ---------- */
  function csrfFrom(html) { var m = /name="csrf-token" content="([^"]+)"/.exec(html); return m ? m[1] : ""; }
  function failText(html) {
    var d = new DOMParser().parseFromString(html, "text/html");
    var m = Array.prototype.map.call(d.querySelectorAll(".field.bad small"), function (s) { return s.textContent.trim(); }).filter(Boolean);
    return m.length ? m.join("، ") : "رفض الخادم الطلب";
  }
  function syncAll() {
    if (syncing) return Promise.resolve();
    if (!navigator.onLine) { toast("لا يوجد اتصال بالإنترنت الآن"); return Promise.resolve(); }
    syncing = true;
    return idbAll(Q).then(function (items) {
      items = items.filter(function (i) { return i.status === "pending"; });
      if (!items.length) return;
      return ensureKey().then(function (ok) {
        if (!ok) return;
        var okCount = 0, stop = false, chain = Promise.resolve();
        items.forEach(function (it) {
          chain = chain.then(function () {
            if (stop) return;
            return fetch("/requests/new", { credentials: "same-origin", cache: "no-store" }).then(function (r) {
              if (new URL(r.url).pathname.indexOf("/login") === 0) { stop = true; toast("انتهت الجلسة: سجّل الدخول ثم اضغط «مزامنة الآن»"); return; }
              return r.text().then(function (html) {
                var token = csrfFrom(html);
                return decBuf(it.meta).then(function (m) {
                  var fields = JSON.parse(dec.decode(m)), fd = new FormData();
                  Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
                  fd.set("csrf_token", token); fd.set("captured_at", it.created);
                  return Promise.all(it.files.map(function (f) { return decBuf(f).then(function (buf) { fd.append(f.name, new Blob([buf], { type: f.type }), f.name + ".jpg"); }); }))
                    .then(function () { return fetch("/requests/new", { method: "POST", body: fd, credentials: "same-origin", redirect: "follow" }); })
                    .then(function (res) {
                      var path = new URL(res.url).pathname;
                      if (res.ok && /^\/requests\/\d+$/.test(path)) { okCount++; return idbDel(Q, it.id); }
                      if (path.indexOf("/login") === 0) { stop = true; toast("انتهت الجلسة: سجّل الدخول ثم أعد المزامنة"); return; }
                      return res.text().then(function (t) { it.status = "error"; it.error = res.status === 422 ? failText(t) : "تعذرت المزامنة (" + res.status + ")"; return idbPut(Q, it); });
                    });
                });
              });
            }).catch(function () { stop = true; toast("انقطع الاتصال أثناء المزامنة، ستُعاد المحاولة"); });
          });
        });
        return chain.then(function () { if (okCount) toast("تمت مزامنة " + okCount + " طلب بنجاح"); });
      });
    }).then(function () { syncing = false; return render(); }, function () { syncing = false; });
  }

  function toast(t) {
    var e = $("#toast");
    if (!e) { e = document.createElement("div"); e.id = "toast"; e.className = "toast"; e.setAttribute("role", "status"); document.body.appendChild(e); }
    e.textContent = t; e.classList.add("show"); setTimeout(function () { e.classList.remove("show"); }, 3500);
  }

  /* ---------- فتح طلب فاشل للتصحيح ---------- */
  function editEntry(id) {
    if (!$("#rform")) { location.href = "/requests/new#edit-" + encodeURIComponent(id); return Promise.resolve(); }
    return ensureKey().then(function (ok) {
      if (!ok) return;
      return idbGet(Q, id).then(function (it) {
        return decBuf(it.meta).then(function (m) {
          var f = JSON.parse(dec.decode(m)), form = $("#rform");
          Object.keys(f).forEach(function (k) { var el = form.elements[k]; if (el && el.type !== "file" && k !== "csrf_token") el.value = f[k]; });
          return Promise.all(it.files.map(function (x) {
            return decBuf(x).then(function (buf) {
              var inp = form.elements[x.name]; if (!inp) return;
              var dt = new DataTransfer(); dt.items.add(new File([buf], x.name + ".jpg", { type: x.type })); inp.files = dt.files; inp.dispatchEvent(new Event("change"));
            });
          }));
        }).then(function () { return idbDel(Q, id); }).then(function () { toast("فُتح الطلب للتصحيح. عدّل ثم اضغط «تسجيل الطلب»"); return render(); });
      });
    });
  }

  /* ---------- ربط نموذج «طلب جديد» ---------- */
  function uid() { var a = crypto.getRandomValues(new Uint8Array(12)); return "c-" + Array.prototype.map.call(a, function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); }
  function reachable() {
    if (COLLECTOR || !navigator.onLine) return Promise.resolve(false);
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 3500);
    return fetch("/offline?ping=" + Date.now(), { cache: "no-store", signal: ctl.signal, credentials: "omit" }).then(function () { clearTimeout(t); return true; }, function () { clearTimeout(t); return false; });
  }
  function bindForm() {
    var form = $("#rform[data-offline]");
    if (!form) return;
    var u = $("#client_uid"); if (u && !u.value) u.value = uid();
    form.addEventListener("submit", function (e) {
      if (form.dataset.sending) return;
      e.preventDefault();
      var fields = {};
      Array.prototype.forEach.call(form.elements, function (el) { if (el.name && el.type !== "file" && el.type !== "checkbox" && el.type !== "submit" && el.name !== "csrf_token") fields[el.name] = el.value; });
      reachable().then(function (online) {
        if (online) { form.dataset.sending = "1"; form.submit(); return; }          // متصل: إرسال عادي والخادم يتحقق
        var errs = validate(fields);
        Array.prototype.forEach.call(form.querySelectorAll(".field"), function (f) { f.classList.remove("bad"); });
        Object.keys(errs).forEach(function (k) { var el = form.elements[k]; if (el) { var w = el.closest(".field"); w.classList.add("bad"); w.querySelector("small").textContent = errs[k]; } });
        if (Object.keys(errs).length) { toast("راجع الحقول المظللة"); var first = $(".field.bad", form); if (first) first.scrollIntoView({ block: "center" }); var sb = $("#rsubmit"); if (sb) sb.disabled = false; return; }
        ensureKey().then(function (ok) {
          if (!ok) { toast("لم يُحفظ الطلب: يلزم رمز حماية الجهاز"); var sb2 = $("#rsubmit"); if (sb2) sb2.disabled = false; return; }
          saveEntry(form, fields).then(function () {
            toast(COLLECTOR ? "حُفظ الطلب مشفَّراً على هذا الجهاز. رحِّله إلى الحاسوب المركزي لاحقاً" : "حُفظ الطلب مشفَّراً على هذا الجهاز وسيُرسل عند عودة الاتصال");
            form.reset(); Array.prototype.forEach.call(form.querySelectorAll(".slot"), function (s) { s.classList.remove("has"); });
            if (u) u.value = uid(); var sb3 = $("#rsubmit"); if (sb3) sb3.disabled = false;
            window.scrollTo(0, 0); render();
          }, function () { toast("تعذر الحفظ على الجهاز (المساحة ممتلئة؟)"); var sb4 = $("#rsubmit"); if (sb4) sb4.disabled = false; });
        });
      });
    });
  }

  /* ---------- أحداث عامة ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.id === "ob-sync") syncAll();
    if (t.id === "ob-export") exportBundle();
    if (t.id === "ob-import") pickBundle();
    if (t.id === "ob-purge" && window.confirm("هل أكّد المستلِم أن الطلبات المُرحَّلة وصلت وزامنها؟ ستُحذف من هذا الجهاز نهائياً.")) {
      idbAll(Q).then(function (all) { return Promise.all(all.filter(function (i) { return i.exportedAt; }).map(function (i) { return idbDel(Q, i.id); })); }).then(render);
    }
    var ed = t.closest && t.closest("[data-ob-edit]"); if (ed) editEntry(ed.dataset.obEdit);
    var dl = t.closest && t.closest("[data-ob-del]");
    if (dl && window.confirm("حذف هذا الطلب المحفوظ على الجهاز نهائياً؟")) idbDel(Q, dl.dataset.obDel).then(render);
  });
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (f.action && /\/logout$/.test(new URL(f.action, location.href).pathname)) {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: "clear-pages" });
      idbAll(Q).then(function (items) { if (items.length) toast("تنبيه: بقي " + items.length + " طلب محفوظ على الجهاز، ولن يُرسل قبل الدخول والمزامنة"); });
    }
  }, true);
  if (!COLLECTOR) window.addEventListener("offline", render);
  if (!COLLECTOR) window.addEventListener("online", function () { render().then(function () { if (KEY) syncAll(); else idbAll(Q).then(function (i) { if (i.length) toast("عاد الاتصال: اضغط «مزامنة الآن» لإرسال الطلبات المحفوظة"); }); }); });

  /* ---------- قفل التطبيق (الموظف الجامع): رمز الحماية عند كل فتح، وقفل تلقائي عند الخمول أو العودة من الخلفية ---------- */
  var IDLE_MS = 2 * 60 * 1000, BG_MS = 60 * 1000, lockBusy = false, idleT = null, hiddenAt = 0, de = document.documentElement;
  function modalOpen() { return !!document.querySelector(".modal-ov"); }
  function unlockFlow() {
    if (!COLLECTOR || lockBusy) return;
    lockBusy = true; de.classList.add("locked");
    ensureKey({ lock: true }).then(function (ok) {
      lockBusy = false;
      if (ok) { de.classList.remove("locked"); armIdle(); adoptDevice().then(purgeAndRender); } else unlockFlow();
    });
  }
  function lockNow() {
    if (!COLLECTOR || lockBusy || !$("#app") || $("#app").hidden) return;
    if (modalOpen()) { setTimeout(lockNow, 15000); return; }       /* لا نقاطع عملية جارية (حفظ/ترحيل) */
    KEY = null; unlockFlow();
  }
  function armIdle() { clearTimeout(idleT); if (COLLECTOR) idleT = setTimeout(lockNow, IDLE_MS); }
  if (COLLECTOR) {
    ["pointerdown", "keydown", "touchstart", "scroll"].forEach(function (ev) { document.addEventListener(ev, function () { if (!lockBusy && KEY) armIdle(); }, { passive: true }); });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > BG_MS) lockNow();
    });
    document.addEventListener("sanad-lock", unlockFlow);
    document.addEventListener("click", function (e) { if (e.target && e.target.id === "lock-now") lockNow(); });
    if (de.classList.contains("locked")) unlockFlow();
  }

  bindForm();
  purgeAndRender();
  /* تهيئة العمل دون اتصال: تحميل صفحة «طلب جديد» مرة ليحتفظ بها المتصفح، فتُفتح بلا إنترنت */
  if (!COLLECTOR && navigator.onLine && "serviceWorker" in navigator && !$("#rform")) {
    try { if (!sessionStorage.getItem("sanad-warm")) { fetch("/requests/new", { credentials: "same-origin" }).catch(function () {}); sessionStorage.setItem("sanad-warm", "1"); } } catch (x) {}
  }
  if (location.hash.indexOf("#edit-") === 0 && $("#rform")) editEntry(decodeURIComponent(location.hash.slice(6)));
})();

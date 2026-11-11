(function () {
  try {
    var t = localStorage.getItem("sanad-theme");
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  } catch (e) {}
})();

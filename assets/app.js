/* Unified Tools setup site — tabs, platform picker, lightbox. */
(function () {
  "use strict";

  /* ---------- Tabs ---------- */
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));

  function activateTab(name) {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    panels.forEach((p) => p.classList.toggle("active", p.id === "tab-" + name));
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  /* ---------- Platform picker → tab + scroll ---------- */
  document.querySelectorAll(".pick[data-go]").forEach((card) => {
    card.addEventListener("click", () => {
      activateTab(card.dataset.go);
      document.getElementById("install").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------- Default tab from the visitor's device ---------- */
  (function pickDefault() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIOS) activateTab("ios");
    else if (isAndroid) activateTab("android");
    // otherwise leave Desktop (the default active tab)
  })();

  /* ---------- Lightbox ---------- */
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbClose = document.getElementById("lb-close");

  function openLightbox(src, alt) {
    lbImg.src = src;
    lbImg.alt = alt || "";
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
  }
  function closeLightbox() {
    lb.classList.remove("open");
    lbImg.src = "";
    document.body.style.overflow = "";
  }

  document.addEventListener("click", (e) => {
    const img = e.target.closest(".shot, .tool-shot img, .ref img");
    if (img && img.tagName === "IMG") openLightbox(img.currentSrc || img.src, img.alt);
  });
  lb.addEventListener("click", closeLightbox);
  lbClose.addEventListener("click", closeLightbox);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lb.classList.contains("open")) closeLightbox();
  });
})();

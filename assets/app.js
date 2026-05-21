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

  /* ---------- Device detection ---------- */
  function deviceIsIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function deviceIsAndroid() {
    return /Android/.test(navigator.userAgent || "");
  }
  const deviceIsMobile = deviceIsIOS() || deviceIsAndroid();

  /* ---------- Default tab from the visitor's device ---------- */
  (function pickDefault() {
    if (deviceIsIOS()) activateTab("ios");
    else if (deviceIsAndroid()) activateTab("android");
    // otherwise leave Desktop (the default active tab)
  })();

  /* ---------- Device-aware tool screenshots ----------
     Each .tool-shot img ships with a desktop src plus a data-shot-mobile
     attribute. On phones/tablets we swap to the mobile capture so the preview
     matches what the visitor actually sees on their own device. Runs before the
     (lazy, below-the-fold) images load, so mobile users don't fetch both. */
  (function swapToolShots() {
    if (!deviceIsMobile) return; // desktop keeps the default desktop src
    document.querySelectorAll(".tool-shot img[data-shot-mobile]").forEach((img) => {
      const mobileSrc = img.getAttribute("data-shot-mobile");
      if (mobileSrc) img.setAttribute("src", mobileSrc);
    });
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

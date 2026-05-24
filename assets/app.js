/* Gambling Tools setup site — tabs, platform picker, lightbox, version
   badges, scroll reveal. Vanilla JS, no dependencies. */
(function () {
  "use strict";

  /* ---------- Accessible tabs ---------- */
  const tablist = document.querySelector('[role="tablist"]');
  const tabBtns = Array.from(document.querySelectorAll(".tab-btn"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));

  function activateTab(name, focus) {
    tabBtns.forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    panels.forEach((p) => {
      const on = p.id === "tab-" + name;
      p.classList.toggle("active", on);
      if (on) p.removeAttribute("hidden");
      else p.setAttribute("hidden", "");
    });
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  if (tablist) {
    tablist.addEventListener("keydown", (e) => {
      const i = tabBtns.indexOf(document.activeElement);
      if (i < 0) return;
      let next = null;
      if (e.key === "ArrowRight") next = (i + 1) % tabBtns.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabBtns.length) % tabBtns.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabBtns.length - 1;
      if (next !== null) { e.preventDefault(); activateTab(tabBtns[next].dataset.tab, true); }
    });
  }

  /* ---------- Platform picker → tab + scroll ---------- */
  document.querySelectorAll(".pick[data-go]").forEach((card) => {
    card.addEventListener("click", () => {
      activateTab(card.dataset.go);
      const install = document.getElementById("install");
      if (install) install.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  /* ---------- Device detection ---------- */
  function deviceIsIOS() {
    const ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function deviceIsAndroid() { return /Android/.test(navigator.userAgent || ""); }
  const deviceIsMobile = deviceIsIOS() || deviceIsAndroid();

  /* Default the Setup tab to the visitor's device. */
  if (deviceIsIOS()) activateTab("ios");
  else if (deviceIsAndroid()) activateTab("android");

  /* ---------- Device-aware tool screenshots ----------
     Swap each .tool-shot img to its mobile capture on phones/tablets, before
     the lazy below-the-fold images load, so mobile users don't fetch both. */
  if (deviceIsMobile) {
    document.querySelectorAll(".tool-shot img[data-shot-mobile]").forEach((img) => {
      const m = img.getAttribute("data-shot-mobile");
      if (m) img.setAttribute("src", m);
    });
  }

  /* ---------- Lightbox (navigate all images within the clicked tool) ---------- */
  const lb = document.getElementById("lightbox");
  const lbImg = document.getElementById("lb-img");
  const lbClose = document.getElementById("lb-close");
  const lbPrev = document.getElementById("lb-prev");
  const lbNext = document.getElementById("lb-next");
  const lbCount = document.getElementById("lb-count");
  if (lb && lbImg) {
    let group = [];
    let idx = 0;

    function render() {
      const item = group[idx];
      if (!item) return;
      lbImg.src = item.src;
      lbImg.alt = item.alt || "";
      if (lbCount) lbCount.textContent = (idx + 1) + " / " + group.length;
      lb.classList.toggle("single", group.length <= 1);
    }
    function open(list, start) {
      group = list; idx = start;
      lb.classList.add("open");
      document.body.style.overflow = "hidden";
      render();
    }
    function close() {
      lb.classList.remove("open"); lbImg.src = ""; group = [];
      document.body.style.overflow = "";
    }
    function go(delta) {
      if (group.length <= 1) return;
      idx = (idx + delta + group.length) % group.length;
      render();
    }

    document.addEventListener("click", (e) => {
      const img = e.target.closest(".tool-shots img, .shot, .ref img");
      if (!img || img.tagName !== "IMG") return;
      const tool = img.closest(".tool");
      if (tool) {
        const imgs = Array.from(tool.querySelectorAll(".tool-shots img"));
        open(imgs.map((m) => ({ src: m.currentSrc || m.src, alt: m.alt })), Math.max(0, imgs.indexOf(img)));
      } else {
        open([{ src: img.currentSrc || img.src, alt: img.alt }], 0);
      }
    });

    if (lbPrev) lbPrev.addEventListener("click", (e) => { e.stopPropagation(); go(-1); });
    if (lbNext) lbNext.addEventListener("click", (e) => { e.stopPropagation(); go(1); });
    if (lbClose) lbClose.addEventListener("click", (e) => { e.stopPropagation(); close(); });
    lbImg.addEventListener("click", (e) => e.stopPropagation());
    lb.addEventListener("click", close);

    let wheelLock = false;
    lb.addEventListener("wheel", (e) => {
      if (!lb.classList.contains("open") || group.length <= 1) return;
      e.preventDefault();
      if (wheelLock) return;
      wheelLock = true; setTimeout(() => (wheelLock = false), 200);
      go(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1);
    }, { passive: false });

    document.addEventListener("keydown", (e) => {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "ArrowDown") go(1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(-1);
    });

    let touchX = 0;
    lb.addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", (e) => {
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  /* ---------- Live version badges ----------
     Read @version from the bundled scripts (same origin) and write it into
     [data-ver-target]. Range request keeps it light; the header is at the top. */
  async function injectVersion(file, key) {
    const targets = document.querySelectorAll('[data-ver-target="' + key + '"]');
    if (!targets.length) return;
    try {
      const res = await fetch(file, { headers: { Range: "bytes=0-2047" } });
      if (!res.ok && res.status !== 206) throw new Error("status " + res.status);
      const m = (await res.text()).match(/@version\s+([0-9][0-9A-Za-z.\-]*)/);
      if (!m) throw new Error("no @version");
      targets.forEach((el) => (el.textContent = "v" + m[1]));
    } catch (err) {
      targets.forEach((el) => (el.textContent = "latest"));
    }
  }
  injectVersion("Desktop/desktop.user.js", "desktop");
  injectVersion("Mobile/mobile.user.js", "mobile");

  /* ---------- Scroll reveal (resilient: IO + sweep, never stuck hidden) ---------- */
  (function () {
    const els = document.querySelectorAll("[data-reveal]");
    if (!els.length) return;
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.top < (window.innerHeight || 800) * 0.92 && r.bottom > 0;
    };
    const sweep = () => els.forEach((el) => { if (inView(el)) el.classList.add("in"); });
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
      els.forEach((el) => io.observe(el));
    }
    requestAnimationFrame(sweep);
    setTimeout(sweep, 0);
    setTimeout(sweep, 300);
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep, { passive: true });
  })();
})();

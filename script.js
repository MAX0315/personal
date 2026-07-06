const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.12 }
);

document.querySelectorAll("[data-reveal]").forEach((item) => revealObserver.observe(item));

document.querySelectorAll(".portal-link").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const kx = dx === 0 ? Infinity : cx / Math.abs(dx);
    const ky = dy === 0 ? Infinity : cy / Math.abs(dy);
    const edge = Math.min(Math.max(1 / Math.min(kx, ky), 0), 1);
    let degrees = Math.atan2(dy, dx) * (180 / Math.PI) + 90;

    if (degrees < 0) degrees += 360;

    card.style.setProperty("--edge-proximity", `${(edge * 100).toFixed(3)}`);
    card.style.setProperty("--cursor-angle", `${degrees.toFixed(3)}deg`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--edge-proximity", "0");
  });
});

document.querySelectorAll(".copy-contact").forEach((button) => {
  button.addEventListener("click", async () => {
    const value = button.dataset.copy || "";
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = value;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.left = "-9999px";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }

    const label = button.textContent;
    button.textContent = "已复制";
    button.classList.add("is-copied");
    window.setTimeout(() => {
      button.textContent = label || "复制";
      button.classList.remove("is-copied");
    }, 1100);
  });
});

document.querySelectorAll(".video-card video").forEach((video) => {
  const card = video.closest(".video-card");
  card.addEventListener("mouseenter", () => video.play().catch(() => {}));
  card.addEventListener("mouseleave", () => {
    video.pause();
    video.currentTime = 0;
  });
});

const dialog = document.querySelector("#videoDialog");
if (dialog) {
  const player = dialog.querySelector("video");
  const close = dialog.querySelector(".dialog-close");

  document.querySelectorAll(".video-card").forEach((card) => {
    card.addEventListener("click", () => {
      const preview = card.querySelector("video");
      player.src = preview.currentSrc || preview.getAttribute("src");
      player.poster = preview.getAttribute("poster");
      player.muted = false;
      player.volume = 1;
      dialog.showModal();
      player.play().catch(() => {});
    });
  });

  function closeDialog() {
    player.pause();
    player.removeAttribute("src");
    player.load();
    dialog.close();
  }

  close.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
}

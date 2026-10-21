document.querySelectorAll(".company-logo").forEach((image) => {
  image.hidden = true;
  image.addEventListener("load", () => { image.hidden = false; }, { once: true });
  image.addEventListener("error", () => { image.hidden = true; }, { once: true });
  if (image.complete) image.hidden = image.naturalWidth === 0;
});

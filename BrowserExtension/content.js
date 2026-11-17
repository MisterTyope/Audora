(function () {
  console.log(
    "%c[Audora] content.js charge sur cette page",
    "background:#FF3B30;color:#fff;padding:4px 8px;border-radius:4px;font-weight:bold;"
  );

  const WIDGET_ID = "ytdlp-bridge-widget";
  const BTN_COLOR = "#272727";
  const BTN_COLOR_HOVER = "#3D3D3D";

  // On avait essaye d'inserer le bouton DANS #buttons (a cote de "Creer"), et
  // les logs confirmaient l'insertion. Mais YouTube (Polymer) re-genere
  // regulierement le contenu de ce conteneur, ce qui efface silencieusement
  // tout enfant ajoute manuellement. Solution robuste : le bouton vit en dehors
  // de cette zone (attache a document.body, position fixed) et se recale en
  // continu sur la position reelle du bouton "Creer", sans jamais y etre insere.
  function findCreateButton() {
    const container = document.querySelector("ytd-masthead #buttons") || document.getElementById("buttons");
    if (!container) return null;
    return (
      container.querySelector('button[aria-label="Créer"]') ||
      container.querySelector("ytd-button-renderer") ||
      container.firstElementChild
    );
  }

  function sendDownloadRequest(format, onDone) {
    chrome.runtime.sendMessage(
      { type: "DOWNLOAD_REQUEST", videoUrl: location.href, format: format },
      (response) => {
        if (!response || !response.ok) {
          alert(
            "Impossible de contacter l'application Audora.\n" +
            "Verifie qu'elle est bien ouverte sur ton PC, puis reessaie."
          );
        }
        if (onDone) onDone();
      }
    );
  }

  function makeMenuItem(label, format, menu, btn) {
    const item = document.createElement("button");
    item.textContent = label;
    item.style.cssText = [
      "display: block",
      "width: 100%",
      "background: transparent",
      "color: #F1F1F1",
      "border: none",
      "text-align: left",
      "padding: 10px 16px",
      "font-size: 13px",
      "font-weight: 500",
      "font-family: 'Roboto', 'Segoe UI', Arial, sans-serif",
      "cursor: pointer",
    ].join(";");
    item.addEventListener("mouseenter", () => (item.style.background = BTN_COLOR_HOVER));
    item.addEventListener("mouseleave", () => (item.style.background = "transparent"));

    item.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.style.display = "none";
      const originalLabel = btn.dataset.label;
      setButtonLabel(btn, "...");
      btn.disabled = true;
      btn.style.opacity = "0.7";
      sendDownloadRequest(format, () => {
        btn.disabled = false;
        btn.style.opacity = "1";
        setButtonLabel(btn, originalLabel);
      });
    });

    return item;
  }

  function makeDownloadIcon() {
    // Fleche de telechargement originale (ligne + triangle), simple, pas une icone YouTube.
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "18");
    svg.setAttribute("height", "18");
    svg.style.cssText = "flex-shrink: 0;";

    const path = document.createElementNS(svgNS, "path");
    path.setAttribute(
      "d",
      "M12 3a1 1 0 011 1v9.086l2.293-2.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 " +
      "111.414-1.414L11 13.086V4a1 1 0 011-1Zm-7 15a1 1 0 011 1v1h12v-1a1 1 0 112 0v1a2 2 0 01-2 " +
      "2H6a2 2 0 01-2-2v-1a1 1 0 011-1Z"
    );
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);
    return svg;
  }

  function setButtonLabel(btn, text) {
    btn.dataset.label = text;
    btn.querySelector(".ytdlp-btn-text").textContent = text;
  }

  function makeDownloadWidget() {
    const container = document.createElement("div");
    container.id = WIDGET_ID;
    container.style.cssText = "position: fixed; display: inline-flex; align-items: center; z-index: 999999;";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.label = "▾";
    btn.style.cssText = [
      `background: ${BTN_COLOR}`,
      "color: #F1F1F1",
      "border: none",
      "border-radius: 18px",
      "padding: 0 16px",
      "height: 36px",
      "display: inline-flex",
      "align-items: center",
      "gap: 8px",
      "font-size: 13px",
      "font-weight: 600",
      "font-family: 'Roboto', 'Segoe UI', Arial, sans-serif",
      "cursor: pointer",
      "white-space: nowrap",
      "box-shadow: 0 1px 4px rgba(0,0,0,0.3)",
    ].join(";");
    btn.addEventListener("mouseenter", () => (btn.style.background = BTN_COLOR_HOVER));
    btn.addEventListener("mouseleave", () => (btn.style.background = BTN_COLOR));

    const icon = makeDownloadIcon();
    const textSpan = document.createElement("span");
    textSpan.className = "ytdlp-btn-text";
    textSpan.textContent = btn.dataset.label;

    btn.appendChild(icon);
    btn.appendChild(textSpan);

    const menu = document.createElement("div");
    menu.style.cssText = [
      "display: none",
      "position: absolute",
      "top: calc(100% + 6px)",
      "right: 0",
      `background: ${BTN_COLOR}`,
      "border-radius: 10px",
      "box-shadow: 0 4px 16px rgba(0,0,0,0.4)",
      "overflow: hidden",
      "min-width: 150px",
      "z-index: 999999",
    ].join(";");
    menu.appendChild(makeMenuItem("Video (MP4)", "mp4", menu, btn));
    menu.appendChild(makeMenuItem("Audio (MP3)", "mp3", menu, btn));

    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      menu.style.display = menu.style.display === "none" ? "block" : "none";
    });
    document.addEventListener("click", () => (menu.style.display = "none"));

    container.style.position = "relative";
    container.appendChild(btn);
    container.appendChild(menu);
    return container;
  }

  function getOrCreateWidget() {
    let widget = document.getElementById(WIDGET_ID);
    if (!widget) {
      widget = makeDownloadWidget();
      document.body.appendChild(widget);
    }
    return widget;
  }

  function repositionWidget() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    const anchor = findCreateButton();
    if (!anchor) {
      // Repli : coin bas-droit, garanti visible meme si YouTube change encore sa structure.
      widget.style.top = "";
      widget.style.left = "";
      widget.style.bottom = "24px";
      widget.style.right = "24px";
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const widgetWidth = widget.offsetWidth || 140;
    widget.style.bottom = "";
    widget.style.right = "";
    widget.style.top = rect.top + "px";
    widget.style.left = (rect.left - widgetWidth - 8) + "px";
  }

  function updateVisibility() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    widget.style.display = location.pathname.startsWith("/watch") ? "inline-flex" : "none";
  }

  function init() {
    console.log("[Audora] init() demarre.");
    getOrCreateWidget();
    repositionWidget();
    updateVisibility();

    // Le bouton "Creer" peut bouger (redimensionnement de fenetre, changement
    // de mise en page) : on recale la position en continu, sans jamais toucher
    // au DOM gere par YouTube.
    window.addEventListener("resize", repositionWidget);
    setInterval(repositionWidget, 1000);
  }

  document.addEventListener("yt-navigate-finish", updateVisibility);
  window.addEventListener("popstate", updateVisibility);

  init();
})();

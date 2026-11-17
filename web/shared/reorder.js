// Glisser-deposer pour remettre des titres dans l'ordre (file d'attente, playlists).
// Fichier partage : souris sur le PC, doigt sur le telephone (Pointer Events).
//
// Utilisation dans le HTML :
//   <div data-reorder="playlist" data-reorder-id="12">          <- la liste
//     <div data-reorder-item> ... <span data-drag-handle></span> </div>   <- chaque ligne + sa poignee
//   </div>
// A la fin d'un deplacement, la liste emet l'evenement "reorder" (detail : kind, id, from, to),
// avec les positions dans la liste. Au clavier : poignee + fleche haut/bas.
(function (global) {
  "use strict";

  let drag = null;
  const EDGE = 56;  // zone pres du bord ou la liste defile toute seule

  function scrollParent(el) {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const style = getComputedStyle(p).overflowY;
      if ((style === "auto" || style === "scroll") && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }

  function emit(container, from, to) {
    if (from === to) return;
    container.dispatchEvent(new CustomEvent("reorder", {
      bubbles: true,
      detail: { kind: container.dataset.reorder, id: container.dataset.reorderId, from, to },
    }));
  }

  function itemsOf(container) {
    return [...container.querySelectorAll("[data-reorder-item]")].filter((el) => el.closest("[data-reorder]") === container);
  }

  function onDown(e) {
    const handle = e.target.closest("[data-drag-handle]");
    if (!handle || (e.pointerType === "mouse" && e.button !== 0)) return;
    const container = handle.closest("[data-reorder]");
    const item = handle.closest("[data-reorder-item]");
    if (!container || !item) return;
    e.preventDefault();
    const items = itemsOf(container);
    const from = items.indexOf(item);
    const scroller = scrollParent(container);
    const rects = items.map((el) => el.getBoundingClientRect());
    const step = items.length > 1
      ? (from < items.length - 1 ? rects[from + 1].top - rects[from].top : rects[from].top - rects[from - 1].top)
      : rects[from].height;
    drag = { container, item, items, from, to: from, rects, step, scroller, scroll0: scroller.scrollTop,
      y0: e.clientY, y: e.clientY, handle, pointerId: e.pointerId, frame: 0 };
    try { handle.setPointerCapture(e.pointerId); } catch { /* deja relache */ }
    item.classList.add("dragging");
    container.classList.add("reordering");
    document.body.classList.add("reordering");
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function layout() {
    const d = drag;
    const scrolled = d.scroller.scrollTop - d.scroll0;
    const dy = d.y - d.y0 + scrolled;
    d.item.style.transform = `translateY(${dy}px)`;
    const center = d.rects[d.from].top + d.rects[d.from].height / 2 + dy;
    let to = d.from;
    while (to < d.items.length - 1 && center > d.rects[to + 1].top + d.rects[to + 1].height / 2) to++;
    while (to > 0 && center < d.rects[to - 1].top + d.rects[to - 1].height / 2) to--;
    d.to = to;
    d.items.forEach((el, i) => {
      if (el === d.item) return;
      const shift = d.from < to && i > d.from && i <= to ? -d.step : d.from > to && i >= to && i < d.from ? d.step : 0;
      el.style.transform = shift ? `translateY(${shift}px)` : "";
    });
  }

  function autoScroll() {
    if (!drag) return;
    const box = drag.scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : drag.scroller.getBoundingClientRect();
    const speed = drag.y < box.top + EDGE ? -(box.top + EDGE - drag.y) / 4 : drag.y > box.bottom - EDGE ? (drag.y - box.bottom + EDGE) / 4 : 0;
    if (speed) {
      drag.scroller.scrollTop += speed;
      layout();
    }
    drag.frame = requestAnimationFrame(autoScroll);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    drag.y = e.clientY;
    layout();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { container, item, items, from, to, frame } = drag;
    drag = null;
    cancelAnimationFrame(frame);
    items.forEach((el) => { el.style.transform = ""; });
    item.classList.remove("dragging");
    container.classList.remove("reordering");
    document.body.classList.remove("reordering");
    if (e.type === "pointerup") emit(container, from, to);
  }

  function onKey(e) {
    const handle = e.target.closest?.("[data-drag-handle]");
    if (!handle || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const container = handle.closest("[data-reorder]");
    const items = container ? itemsOf(container) : [];
    const from = items.indexOf(handle.closest("[data-reorder-item]"));
    const to = from + (e.key === "ArrowUp" ? -1 : 1);
    if (from < 0 || to < 0 || to >= items.length) return;
    e.preventDefault();
    e.stopPropagation();
    emit(container, from, to);
    // La liste est redessinee : on garde le focus sur la poignee du titre deplace.
    requestAnimationFrame(() => {
      const again = document.querySelector(`[data-reorder="${container.dataset.reorder}"]`);
      const handles = again ? itemsOf(again).map((el) => el.querySelector("[data-drag-handle]")) : [];
      handles[to]?.focus();
    });
  }

  // La poignee ne doit pas declencher l'action de sa ligne (lecture du titre).
  function swallowClick(e) {
    if (e.target.closest?.("[data-drag-handle]")) {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }

  document.addEventListener("pointerdown", onDown);
  document.addEventListener("pointermove", onMove, { passive: false });
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", swallowClick, true);

  /** Deplace l'element `from` a la position `to` (copie du tableau). */
  function move(list, from, to) {
    const out = list.slice();
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
  }

  global.AudoraReorder = { move };
})(typeof window !== "undefined" ? window : globalThis);

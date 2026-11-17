// The shared top bar's phone menu and the designer's sheets take turns (#149): only one of them is open at a time, so
// their layers never overlap. The bar tells the page when its menu opens; the page folds the menu away when a sheet opens.

/** Sent on window when the shared bar's phone menu opens. */
export const SITE_MENU_OPENED = "ts-site-menu-opened";

/** Fold the shared bar's phone menu away, if it is open, the way its own button does (so its aria-expanded stays true). */
export function closeSiteMenu(root: ParentNode = document): void {
  root.querySelector<HTMLButtonElement>("rm-header[data-open] .rm-header__menu")?.click();
}

/**
 * Folds the bar's menu away when a finger or the mouse goes down anywhere outside it. The bar itself only listens for
 * clicks, and the designer's plan cancels the click after a touch (so a tap on a handle can't click what appears under
 * it): without this, panning or tapping the plan would leave the menu open over it. Returns the stop function.
 */
export function closeSiteMenuOnPressOutside(bar: Element, doc: Document = document): () => void {
  const onDown = (event: PointerEvent) => {
    if (bar.hasAttribute("data-open") && !(event.target instanceof Node && bar.contains(event.target))) closeSiteMenu(bar.parentNode ?? doc);
  };
  doc.addEventListener("pointerdown", onDown, true);
  return () => doc.removeEventListener("pointerdown", onDown, true);
}

/** Calls `onOpen` each time the bar's menu opens (its `data-open` appears); returns the stop function. */
export function watchSiteMenu(bar: Element, onOpen: () => void): () => void {
  let open = bar.hasAttribute("data-open");
  const observer = new MutationObserver(() => {
    const now = bar.hasAttribute("data-open");
    if (now && !open) onOpen();
    open = now;
  });
  observer.observe(bar, { attributes: true, attributeFilter: ["data-open"] });
  return () => observer.disconnect();
}

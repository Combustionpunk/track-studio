// The shared top bar's phone menu and the designer's sheets take turns (#149): only one of them is open at a time, so
// their layers never overlap. The bar tells the page when its menu opens; the page folds the menu away when a sheet opens.

/** Sent on window when the shared bar's phone menu opens. */
export const SITE_MENU_OPENED = "ts-site-menu-opened";

/** Fold the shared bar's phone menu away, if it is open, the way its own button does (so its aria-expanded stays true). */
export function closeSiteMenu(root: ParentNode = document): void {
  root.querySelector<HTMLButtonElement>("rm-header[data-open] .rm-header__menu")?.click();
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

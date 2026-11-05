// The right-click / long-press command menu.

export type Command = "sit" | "fetch" | "roll over" | "spin" | "treat" | "nap" | "follow me" | "zoomies" | "go home";

export const COMMANDS: Command[] = ["sit", "fetch", "roll over", "spin", "treat", "nap", "follow me", "zoomies", "go home"];

// keeps the menu on screen: flips left/up near the right/bottom edges
export function menuPosition(x: number, y: number, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const left = x + w > vw ? x - w : x;
  const top = y + h > vh ? y - h : y;
  return { left: Math.max(0, left), top: Math.max(0, top) };
}

let menu: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function closeMenu(): void {
  cleanup?.();
  cleanup = null;
  if (menu) menu.hidden = true;
}

// x, y are viewport coordinates
export function openMenu(x: number, y: number, onPick: (c: Command) => void): void {
  closeMenu();
  menu ??= document.getElementById("olex-menu");
  if (!menu) return;
  const m = menu;
  m.replaceChildren();
  const title = document.createElement("div");
  title.className = "olex-menu-title";
  title.textContent = "olex";
  m.appendChild(title);
  const items = COMMANDS.map((c) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.textContent = `→ ${c}`;
    b.addEventListener("click", () => {
      closeMenu();
      onPick(c);
    });
    m.appendChild(b);
    return b;
  });

  m.hidden = false;
  const r = m.getBoundingClientRect();
  const pos = menuPosition(x, y, r.width, r.height, innerWidth, innerHeight);
  m.style.left = `${pos.left}px`;
  m.style.top = `${pos.top}px`;
  items[0].focus();

  const onKey = (e: KeyboardEvent) => {
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") closeMenu();
    else if (e.key === "ArrowDown") items[(i + 1) % items.length].focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length].focus();
    else return;
    e.preventDefault();
  };
  const onOutside = (e: PointerEvent) => {
    if (!m.contains(e.target as Node)) closeMenu();
  };
  // let the opening click finish before listening for outside clicks
  const t = setTimeout(() => document.addEventListener("pointerdown", onOutside), 0);
  document.addEventListener("keydown", onKey);
  addEventListener("scroll", closeMenu, { once: true, passive: true });
  cleanup = () => {
    clearTimeout(t);
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onKey);
    removeEventListener("scroll", closeMenu);
  };
}

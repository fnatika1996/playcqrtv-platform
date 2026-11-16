const sprite = "/assets/icons/cqrtv/ui/admin-icon-sprite.svg#";
const svgNs = "http://www.w3.org/2000/svg";

export function upgradeIcon(image) {
  const source = image instanceof HTMLImageElement ? image.src : image instanceof HTMLElement ? image.dataset.src : "";
  if (!source.includes("/assets/icons/cqrtv/ui/")) return false;
  const key = source.split("/ui/").at(-1)?.split(".")[0];
  if (!key || !/^[a-z0-9-]+$/.test(key)) return false;
  const icon = document.createElementNS(svgNs, "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("focusable", "false");
  icon.classList.add("admin-icon", ...[...image.classList].filter(name => /^[a-zA-Z0-9_-]+$/.test(name)));
  const alt = image instanceof HTMLImageElement ? image.alt : "";
  if (alt) {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", alt);
  } else {
    icon.setAttribute("aria-hidden", "true");
  }
  const use = document.createElementNS(svgNs, "use");
  use.setAttribute("href", sprite + key);
  icon.append(use);
  image.replaceWith(icon);
  return true;
}

function hydrate(root = document) {
  root.querySelectorAll?.('img[src*="/assets/icons/cqrtv/ui/"],.pack-icon[data-src]').forEach(upgradeIcon);
}

hydrate();
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) {
    if (node instanceof HTMLImageElement || node instanceof HTMLElement && node.matches(".pack-icon[data-src]")) upgradeIcon(node);
    else if (node instanceof Element) hydrate(node);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

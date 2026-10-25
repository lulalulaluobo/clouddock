// Observe the nearby cards once; never read every card's layout on scroll.
export function observeResources(container, onVisible, margin = 240) {
  const visible = new Set(), nodes = new Set();
  let frame = 0, stopped = false;
  const notify = () => {
    if (!frame && !stopped) frame = requestAnimationFrame(() => {
      frame = 0;
      if (!stopped) onVisible([...visible].filter(node => node.isConnected).map(node => node.dataset.resourceKey));
    });
  };
  const root = container.closest('#app');
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target); else visible.delete(entry.target);
    }
    notify();
  }, { root, rootMargin: `${margin}px 0px`, threshold: 0 }) : null;
  // Old browsers keep the existing behavior, but coalesce it to one frame.
  const scan = () => {
    visible.clear();
    const bounds = root?.getBoundingClientRect() || { top: 0, bottom: innerHeight };
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.bottom >= bounds.top - margin && rect.top <= bounds.bottom + margin) visible.add(node);
    }
    notify();
  };
  let fallbackFrame = 0;
  const scheduleScan = () => {
    if (!fallbackFrame) fallbackFrame = requestAnimationFrame(() => { fallbackFrame = 0; scan(); });
  };
  if (!observer) {
    (root || window).addEventListener('scroll', scheduleScan, { passive: true });
    window.addEventListener('resize', scheduleScan);
  }
  return {
    refresh() {
      if (stopped) return;
      const current = new Set(container.querySelectorAll('[data-resource-key]'));
      for (const node of nodes) if (!current.has(node)) { observer?.unobserve(node); visible.delete(node); nodes.delete(node); }
      for (const node of current) if (!nodes.has(node)) { nodes.add(node); observer?.observe(node); }
      if (observer) notify(); else scheduleScan();
    },
    disconnect() {
      stopped = true; observer?.disconnect(); cancelAnimationFrame(frame); cancelAnimationFrame(fallbackFrame);
      (root || window).removeEventListener('scroll', scheduleScan); window.removeEventListener('resize', scheduleScan);
      nodes.clear(); visible.clear();
    }
  };
}

// icons.js - the page's own line icons (24 x 24, stroke paths), drawn for this page: the dealer's site uses a custom icon font,
// which is not copied. One set of path data feeds both the 3D panels (canvas Path2D) and the cards (inline SVG). UC-6.2.
export const ICONS = {
  coupe: 'M2.5 16H4M9 16h6M20 16h1.5v-3l-2.6-1.1-3.4-3.4H9.2l-3.1 3.5L3 13v3M4 16a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M15 16a2.5 2.5 0 1 0 5 0 2.5 2.5 0 1 0-5 0M9.5 12h6',
  offroad: 'M2 20l6-10 4 6 3-4 7 8zM8 10l1.5-3M15 12l1-2',
  concept: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  thrill: 'M13 2L4 14h7l-1 8 9-12h-7z',
  adventure: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM15.5 8.5l-2 5-5 2 2-5z',
  luxury: 'M6 3h12l4 6-10 12L2 9zM2 9h20M9 3l3 18M15 3l-3 18',
  numbers: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  fly: 'M3 12a9 4 0 1 0 18 0 9 4 0 1 0-18 0M12 3v4M12 17v4M9 6l3-3 3 3',
  wheel: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6zM2.5 10.5l6.6 1M14.9 11.5l6.6-1M12 15v6.8',
  flag: 'M5 21V4M5 4h12l-2 4 2 4H5',
  plug: 'M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20zM12 11v6M12 7.5v.5',
  lot: 'M3 21V9l9-6 9 6v12M7 21v-6h10v6M7 17h10',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 10a4 4 0 1 0 0 8 4 4 0 1 0 0-8z',
};

export function svgIcon(name, size = 22) {
  const d = ICONS[name];
  if (!d) throw new Error('icons.js has no icon ' + name);
  return '<svg class="ico" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
}

// draw an icon on a 2D canvas at (x, y), `size` px square, in `color`
export function drawIcon(g, name, x, y, size, color) {
  const d = ICONS[name];
  if (!d) throw new Error('icons.js has no icon ' + name);
  g.save();
  g.translate(x, y); g.scale(size / 24, size / 24);
  g.strokeStyle = color; g.lineWidth = 1.8; g.lineCap = 'round'; g.lineJoin = 'round';
  g.stroke(new Path2D(d));
  g.restore();
}

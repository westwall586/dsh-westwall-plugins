/** Inline SVG icons. Every glyph inherits the host color through currentColor. */

import { createElement } from 'react';

function svg(size, attributes, children) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
      focusable: 'false',
      ...attributes,
    },
    ...children,
  );
}

/** Sidebar entry: a reading card with ruled lines. */
export function PanelIcon({ size = 16, active = false, className }) {
  return svg(size, { strokeWidth: active ? 1.7 : 1.4, className }, [
    createElement('rect', { key: 'frame', x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 }),
    createElement('path', { key: 'lines', d: 'M5 6.2h4.2M5 8.6h6M5 11h3' }),
  ]);
}

export function ChevronLeftIcon({ size = 14, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', { key: 'chevron', d: 'M10 4 6 8l4 4' }),
  ]);
}

export function ChevronRightIcon({ size = 14, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', { key: 'chevron', d: 'M6 4l4 4-4 4' }),
  ]);
}

export function RefreshIcon({ size = 12, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', { key: 'arc', d: 'M13.5 8a5.5 5.5 0 1 1-1.9-4.2M13.5 2.5V6H10' }),
  ]);
}

export function StarIcon({ size = 11, className }) {
  return svg(size, { viewBox: '0 0 24 24', strokeWidth: 1.8, className }, [
    createElement('path', {
      key: 'star',
      d: 'M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z',
    }),
  ]);
}

export function CheckIcon({ size = 13, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', { key: 'check', d: 'M3 8.5 6.5 12 13 4.8' }),
  ]);
}

export function OpenIcon({ size = 13, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', { key: 'frame', d: 'M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5M9.5 2.5h4v4M13.3 2.7 7.5 8.5' }),
  ]);
}

/** A tweet row's delete action: a bin for removing the bookmark on X. */
export function TrashIcon({ size = 13, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('path', {
      key: 'bin',
      d: 'M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8M6.8 6.8v3.6M9.2 6.8v3.6',
    }),
  ]);
}

/** Video badge on a brief cover: a filled triangle in the current color. */
export function PlayIcon({ size = 8, className }) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'currentColor',
      stroke: 'none',
      className,
      'aria-hidden': true,
      focusable: 'false',
    },
    createElement('path', { key: 'play', d: 'M4.5 3.2v9.6l8-4.8z' }),
  );
}

/** Rail footer: a gear for the settings view. */
export function SettingsIcon({ size = 12, className }) {
  return svg(size, { strokeWidth: 1.4, className }, [
    createElement('circle', { key: 'hub', cx: 8, cy: 8, r: 2.1 }),
    createElement('path', {
      key: 'teeth',
      d: 'M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.7 3.7l1.1 1.1M11.2 11.2l1.1 1.1M12.3 3.7l-1.1 1.1M4.8 11.2l-1.1 1.1',
    }),
  ]);
}

/** Filters row: a checked box with trailing rows, the select-mode toggle. */
export function SelectIcon({ size = 12, className }) {
  return svg(size, { strokeWidth: 1.5, className }, [
    createElement('rect', { key: 'box', x: 2.5, y: 2.5, width: 7, height: 7, rx: 1.5 }),
    createElement('path', { key: 'check', d: 'M4.6 6 5.8 7.2 8 4.8M11 8.5h2.5M11 12h3' }),
  ]);
}

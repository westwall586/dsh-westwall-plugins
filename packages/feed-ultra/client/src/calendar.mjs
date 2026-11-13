/** The month calendar in the left rail. It knows only its props: month, today, entries, selection. */

import { createElement } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons.mjs';
import {
  calendarDot,
  formatDateTitle,
  formatWeekday,
  monthGridRange,
  monthKeyOf,
  monthTitle,
} from './view-model.mjs';

const h = createElement;
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

export function Calendar({ month, today, entries, selected, text, onSelect, onMonth }) {
  if (!month) return null;
  const range = monthGridRange(month);
  const todayMonth = today ? monthKeyOf(today) : month;
  const nextDisabled = month >= todayMonth;

  const week = WEEKDAYS.map(day => h('span', { key: day }, text(`weekdayShort.${day}`)));

  const cells = range.cells.map((day) => {
    if (monthKeyOf(day) !== month) {
      return h('span', { key: day, className: 'dl-cal-cell is-blank', 'aria-hidden': true });
    }
    const future = Boolean(today) && day > today;
    const dot = calendarDot(entries ? entries.get(day) : null);
    const classes = ['dl-cal-cell'];
    if (future) classes.push('is-future');
    if (day === today) classes.push('is-today');
    if (day === selected) classes.push('is-selected');
    return h('button', {
      key: day,
      type: 'button',
      className: classes.join(' '),
      disabled: future,
      'data-day': day,
      'aria-label': `${formatDateTitle(day, text)} ${formatWeekday(day, text)}`,
      'aria-current': day === today ? 'date' : undefined,
      'aria-pressed': day === selected ? 'true' : undefined,
      onClick: () => onSelect(day),
    },
      h('span', { className: 'dl-cal-num' }, String(Number(day.slice(8)))),
      dot ? h('span', { className: `dl-cal-dot is-${dot}`, 'aria-hidden': true }) : null,
    );
  });

  return h('div', { className: 'dl-cal' },
    h('div', { className: 'dl-cal-head' },
      h('span', { className: 'dl-cal-month' }, monthTitle(month, text)),
      h('div', { className: 'dl-cal-nav' },
        h('button', {
          type: 'button',
          className: 'dl-cal-nav-btn',
          title: text('calendar.prevMonth'),
          'aria-label': text('calendar.prevMonth'),
          onClick: () => onMonth(-1),
        }, h(ChevronLeftIcon, { size: 12 })),
        h('button', {
          type: 'button',
          className: 'dl-cal-nav-btn',
          title: text('calendar.nextMonth'),
          'aria-label': text('calendar.nextMonth'),
          disabled: nextDisabled,
          onClick: () => onMonth(1),
        }, h(ChevronRightIcon, { size: 12 })),
      ),
    ),
    h('div', { className: 'dl-cal-week' }, ...week),
    h('div', { className: 'dl-cal-grid' }, ...cells),
  );
}

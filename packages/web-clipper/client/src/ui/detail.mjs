/**
 * Compact usage section for the clipper's row page.
 *
 * A row's detail page does not render the package README; the bundle page does.
 * When the clipper is carried by Feed Ultra, this section gives that row page
 * the same essential usage and naming facts.
 */
import { createElement } from 'react'

function isClipperRow(subject) {
  return subject?.kind === 'row'
    && subject.row?.rowId === 'dsh-web-clipper'
    && (subject.pkg?.name === '@westwall/dsh-feed-ultra'
      || subject.pkg?.name === '@westwall/dsh-web-clipper')
}

export function createDetailSection({ t }) {
  return function WebClipperDetail(props) {
    if (!isClipperRow(props?.subject)) return null
    return createElement('section', { className: 'dwc-detail' },
      createElement('h3', { className: 'dwc-detail-title' }, t('detail.title')),
      createElement('p', { className: 'dwc-detail-text' }, t('detail.usage')),
      createElement('p', { className: 'dwc-detail-text' }, t('detail.copy')),
      createElement('p', { className: 'dwc-detail-text' }, t('detail.naming')))
  }
}

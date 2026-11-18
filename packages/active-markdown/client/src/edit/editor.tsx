import * as React from 'react'
import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { sameText } from './model.ts'
import { scrollportOf } from '../scroll.ts'

export interface EditorAdopt {
  text: string
  token: number
}

export interface SourceEditorProps {
  initialText: string
  entryLine: number
  adopt: EditorAdopt
  readOnly: boolean
  label: string
  onUpdate(text: string, cursorLine: number): void
  onSave(text: string, cursorLine: number): void
  onExit(): void
}

function fitHeight(container: HTMLElement): void {
  const port = scrollportOf(container)
  if (port === null) {
    const top = Math.max(0, container.getBoundingClientRect().top)
    container.style.height = `${Math.max(180, window.innerHeight - top - 24)}px`
    return
  }
  const offset = container.getBoundingClientRect().top - port.getBoundingClientRect().top + port.scrollTop
  container.style.height = `${Math.max(180, Math.floor(port.clientHeight - offset) - 1)}px`
}

const theme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--dsw-alias-label-primary)',
    backgroundColor: 'transparent',
    fontFamily: 'var(--dsh-font-family-code)',
    fontSize: 'var(--dsh-code-font-size)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit', lineHeight: '1.65' },
  '.cm-content': { padding: '10px 0', caretColor: 'var(--dsw-alias-link)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--dsw-alias-link)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--dsw-alias-link) 22%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-link) 5%, transparent)' },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--dsw-alias-label-tertiary)',
    borderRight: '0.5px solid var(--dsw-alias-border-l1)',
  },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-link) 7%, transparent)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
  '.cm-matchingBracket': { backgroundColor: 'color-mix(in srgb, var(--dsw-alias-link) 14%, transparent)' },
})

const highlight = HighlightStyle.define([
  { tag: tags.heading1, color: 'var(--dsw-alias-label-primary)', fontWeight: '700', fontSize: '1.35em' },
  { tag: tags.heading2, color: 'var(--dsw-alias-label-primary)', fontWeight: '700', fontSize: '1.2em' },
  { tag: tags.heading3, color: 'var(--dsw-alias-label-primary)', fontWeight: '650', fontSize: '1.1em' },
  { tag: [tags.heading4, tags.heading5, tags.heading6], color: 'var(--dsw-alias-label-secondary)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--dsw-alias-link)', textDecoration: 'underline' },
  { tag: tags.monospace, color: 'var(--dsw-alias-label-primary)', backgroundColor: 'var(--dsw-alias-markdown-inline-code)' },
  { tag: tags.quote, color: 'var(--dsw-alias-label-secondary)' },
  { tag: [tags.contentSeparator, tags.processingInstruction, tags.meta], color: 'var(--dsw-alias-label-tertiary)' },
])

function cursorLineOf(view: EditorView): number {
  return view.state.doc.lineAt(view.state.selection.main.head).number
}

export function SourceEditor(props: SourceEditorProps): ReactNode {
  const host = useRef<HTMLDivElement | null>(null)
  const view = useRef<EditorView | null>(null)
  const initialText = useRef(props.initialText)
  const entryLine = useRef(props.entryLine)
  const adoptedToken = useRef(0)
  const suppress = useRef(false)
  const readOnly = useRef(new Compartment())
  const callbacks = useRef({
    onUpdate: props.onUpdate,
    onSave: props.onSave,
    onExit: props.onExit,
    label: props.label,
  })
  callbacks.current = {
    onUpdate: props.onUpdate,
    onSave: props.onSave,
    onExit: props.onExit,
    label: props.label,
  }

  useLayoutEffect(() => {
    const container = host.current
    if (container === null) return
    const state = EditorState.create({
      doc: initialText.current,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightSpecialChars(),
        indentOnInput(),
        bracketMatching(),
        markdown(),
        syntaxHighlighting(highlight),
        EditorView.lineWrapping,
        theme,
        readOnly.current.of([
          EditorView.editable.of(!props.readOnly),
          EditorState.readOnly.of(props.readOnly),
        ]),
        EditorView.contentAttributes.of({
          'aria-label': callbacks.current.label,
          'aria-multiline': 'true',
        }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: (current) => {
              if (current.composing) return false
              callbacks.current.onSave(current.state.doc.toString(), cursorLineOf(current))
              return true
            },
          },
          {
            key: 'Escape',
            run: (current) => {
              if (current.composing) return false
              callbacks.current.onExit()
              return true
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (suppress.current) return
          if (!update.docChanged && !update.selectionSet) return
          callbacks.current.onUpdate(update.state.doc.toString(), cursorLineOf(update.view))
        }),
      ],
    })
    const editor = new EditorView({ state, parent: container })
    view.current = editor
    const line = editor.state.doc.line(Math.min(Math.max(1, entryLine.current), editor.state.doc.lines))
    suppress.current = true
    editor.dispatch({ selection: { anchor: line.from } })
    suppress.current = false
    editor.focus()
    fitHeight(container)

    const port = scrollportOf(container)
    const fit = (): void => fitHeight(container)
    const observer = new ResizeObserver(fit)
    if (port !== null) observer.observe(port)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
      editor.destroy()
      view.current = null
    }
  }, [])

  useLayoutEffect(() => {
    const container = host.current
    if (container !== null) fitHeight(container)
  })

  useLayoutEffect(() => {
    const editor = view.current
    if (editor === null) return
    editor.dispatch({
      effects: readOnly.current.reconfigure([
        EditorView.editable.of(!props.readOnly),
        EditorState.readOnly.of(props.readOnly),
      ]),
    })
  }, [props.readOnly])

  useLayoutEffect(() => {
    const editor = view.current
    if (editor === null || props.adopt.token === adoptedToken.current) return
    adoptedToken.current = props.adopt.token
    if (sameText(editor.state.doc.toString(), props.adopt.text)) return
    suppress.current = true
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: props.adopt.text } })
    suppress.current = false
  }, [props.adopt])

  return <div className="am-edit-editor" ref={host} aria-label={props.label} />
}

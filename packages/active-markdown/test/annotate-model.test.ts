import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addAnnotation,
  editAnnotation,
  maxSeq,
  nextSeq,
  removeAnnotation,
  restoreAnnotation,
  type Annotation,
  type AnnotationInput,
} from '../client/src/annotate/model.ts'

function input(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return {
    kind: 'text',
    body: '意见',
    quote: '选中的原文',
    prefix: '前文',
    suffix: '后文',
    startOffset: 3,
    blockStartId: 'paragraph-1',
    blockEndId: 'paragraph-1',
    blockSignature: '',
    section: '章节',
    lineStart: 2,
    lineEnd: 2,
    ...overrides,
  }
}

function add(annotations: readonly Annotation[], seq: number, id: string, body = '意见'): Annotation[] {
  return addAnnotation(annotations, input({ body }), {
    id,
    seq,
    createdAt: '2026-11-17T00:00:00.000Z',
  })
}

test('追加批注带上 id、编号、正文与锚点', () => {
  const [annotation, ...rest] = add([], 1, 'a1')
  assert.equal(rest.length, 0)
  assert.equal(annotation!.id, 'a1')
  assert.equal(annotation!.seq, 1)
  assert.equal(annotation!.body, '意见')
  assert.equal(annotation!.quote, '选中的原文')
  assert.equal(annotation!.startOffset, 3)
  assert.equal(annotation!.kind, 'text')
  assert.equal(annotation!.createdAt, '2026-11-17T00:00:00.000Z')
})

test('编辑只改正文，编号与锚点不动', () => {
  const before = add(add([], 1, 'a1'), 2, 'a2')
  const after = editAnnotation(before, 'a1', '改过的意见')
  assert.equal(after[0]!.body, '改过的意见')
  assert.equal(after[0]!.seq, 1)
  assert.equal(after[1]!.body, '意见')
  assert.equal(before[0]!.body, '意见')
})

test('删除不重排，撤销按原 id 与原编号放回', () => {
  const before = add(add(add([], 1, 'a1'), 2, 'a2'), 3, 'a3')
  const removed = removeAnnotation(before, 'a2')
  assert.deepEqual(removed.map(annotation => annotation.seq), [1, 3])

  const restored = restoreAnnotation(removed, before[1]!)
  assert.deepEqual(restored.map(annotation => [annotation.id, annotation.seq]), [['a1', 1], ['a2', 2], ['a3', 3]])
})

test('撤销一条仍在列表里的批注不产生重复', () => {
  const before = add(add([], 1, 'a1'), 2, 'a2')
  assert.deepEqual(restoreAnnotation(before, before[0]!), before)
})

test('编号单调：高水位让删掉的编号不再发给下一条', () => {
  let list = add(add(add([], 1, 'a1'), 2, 'a2'), 3, 'a3')
  let available = nextSeq(list, 1)
  assert.equal(available, 4)

  list = removeAnnotation(list, 'a3')
  assert.equal(maxSeq(list), 2)
  // The store keeps the high-water mark after the delete.
  assert.equal(nextSeq(list, available), 4)
  list = add(list, available, 'a4')
  assert.deepEqual(list.map(annotation => annotation.seq), [1, 2, 4])
  assert.equal(nextSeq(list, 4), 5)
})

test('空列表从 1 开始，没有 tag/priority/status 字段', () => {
  assert.equal(nextSeq([], 1), 1)
  const [annotation] = add([], 1, 'a1')
  assert.equal('tag' in annotation!, false)
  assert.equal('priority' in annotation!, false)
  assert.equal('status' in annotation!, false)
  assert.equal(Object.keys(annotation!).includes('tag'), false)
})

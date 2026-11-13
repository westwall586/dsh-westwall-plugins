// 判定用例：写入门禁纯逻辑（同日互斥）——Host 提交路径消费。
// requireConfirm / mapSubmitReport 随模型工具路径移除（2026-09-24 Wave，审计 M4）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DayMutex, acquireAll } from '../src/gates.ts'

test('DayMutex：同日并发互斥、不同日并行、完成释放', async () => {
  const mutex = new DayMutex()
  const releaseA = mutex.acquire('2026-09-21')
  assert.throws(() => mutex.acquire('2026-09-21'), /进行中/)
  const releaseB = mutex.acquire('2026-09-18') // 不同日不阻塞
  releaseB()
  releaseA()
  mutex.acquire('2026-09-21')() // 释放后可重入
})

test('acquireAll：任一日失败回滚已获取的锁（review F1/F5）', () => {
  const mutex = new DayMutex()
  const held = mutex.acquire('2026-09-17') // 该日已被外部持有
  assert.throws(() => acquireAll(mutex, ['2026-09-18', '2026-09-17', '2026-09-16']), /2026-09-17.*进行中/)
  // 失败回滚：09-18 已获取但必须被释放，不得泄漏
  mutex.acquire('2026-09-18')()
  const release = acquireAll(mutex, ['2026-09-18', '2026-09-16'])
  release()
  held()
})

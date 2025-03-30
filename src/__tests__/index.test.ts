import { describe, test, expect, beforeEach, vi } from 'vitest'
import { FlexEvent } from '../event'
import { TimeoutError } from '../errors'

interface TestEvents {
  'user.login': { userId: string }
  'user.logout': { userId: string }
  'user.profile.update': { userId: string; data: any }
  'message.received': { from: string; content: string }
  'system.status': { status: 'online' | 'offline' }
}

describe('FlexEvent', () => {
  let events: FlexEvent<TestEvents>

  beforeEach(() => {
    events = new FlexEvent<TestEvents>()
  })

  // ... [保留之前的所有测试用例]

  test('事件监听器的类型安全性', () => {
    const events = new FlexEvent<{
      'user.login': { userId: string }
      'user.data': { data: number }
    }>()

    // 正确的类型应该能通过编译
    events.on('user.login', (event) => {
      const userId: string = event.payload.userId
      expect(typeof userId).toBe('string')
    })

    events.on('user.data', (event) => {
      const data: number = event.payload.data
      expect(typeof data).toBe('number')
    })

    // 触发事件
    events.emit({
      type: 'user.login',
      payload: { userId: '123' }
    })

    events.emit({
      type: 'user.data',
      payload: { data: 123 }
    })
  })

  test('事件触发的并发性能', async () => {
    const concurrentEvents = 100
    const handler = vi.fn()
    events.on('concurrent', handler)

    // 并发触发多个事件
    const startTime = performance.now()
    await Promise.all(
      Array.from({ length: concurrentEvents }, (_, i) => 
        events.emitAsync({
          type: 'concurrent',
          payload: { userId: i.toString() }
        })
      )
    )
    const endTime = performance.now()

    // 验证所有事件都被处理
    expect(handler).toHaveBeenCalledTimes(concurrentEvents)
    
    // 验证性能（平均每个事件处理时间应该很短）
    const averageTime = (endTime - startTime) / concurrentEvents
    expect(averageTime).toBeLessThan(1) // 平均每个事件处理时间应小于1ms
  })

  test('事件监听器的生命周期管理', () => {
    const handler = vi.fn()
    const subscriber = events.on('lifecycle', handler)

    // 验证初始状态
    expect(events['_listeners'].size).toBe(1)

    // 触发事件
    events.emit({
      type: 'lifecycle',
      payload: { userId: '123' }
    })

    // 取消订阅
    subscriber.off()

    // 验证清理
    expect(events['_listeners'].size).toBe(0)
    expect(events['_subscribers'].children.get('lifecycle')?.listeners.size).toBe(0)

    // 再次触发事件
    events.emit({
      type: 'lifecycle',
      payload: { userId: '123' }
    })

    // 验证不再触发
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('事件路径的边界条件', () => {
    const handler = vi.fn()
    const edgeCases = [
      '',                    // 空字符串
      '.',                   // 单个分隔符
      '..',                  // 多个分隔符
      'a..b',               // 中间有多个分隔符
      'a.b.',               // 末尾有分隔符
      '.a.b',               // 开头有分隔符
      'very.long.path.'.repeat(10), // 非常长的路径
      '*.*.*',              // 多个通配符
      '**.**.test',         // 多个多层通配符
      '*test*',             // 通配符在中间
      '中文.测试.路径'        // Unicode字符
    ]

    // 测试所有边界情况
    edgeCases.forEach(path => {
      events.on(path, handler)
      events.emit({
        type: path,
        payload: { userId: '123' }
      })
    })

    // 验证所有事件都被正确处理
    expect(handler).toHaveBeenCalledTimes(edgeCases.length)
  })

  test('通配符匹配的性能', () => {
    const wildcardPatterns = [
      'a.*.c',
      'a.**.c',
      '**.c',
      'a.**',
      '*.*.*',
      '**.test.**'
    ]

    const testCases = [
      'a.b.c',
      'a.b.b.c',
      'x.y.c',
      'a.b.test.c',
      'a.b.c.d.e'
    ]

    const handler = vi.fn()
    
    // 注册所有通配符模式
    wildcardPatterns.forEach(pattern => {
      events.on(pattern, handler)
    })

    // 测试匹配性能
    const startTime = performance.now()
    
    // 多次触发每个测试用例
    for (let i = 0; i < 100; i++) {
      testCases.forEach(testCase => {
        events.emit({
          type: testCase,
          payload: { userId: '123' }
        })
      })
    }

    const endTime = performance.now()
    const totalEvents = testCases.length * 100
    const timePerEvent = (endTime - startTime) / totalEvents

    // 验证性能（每个事件的处理时间应该很短）
    expect(timePerEvent).toBeLessThan(1) // 每个事件的处理时间应小于1ms

    // 验证匹配正确性
    expect(handler).toHaveBeenCalled()
  })

  test('事件监听器的引用完整性', () => {
    const results: string[] = []
    const obj = {
      value: 'test',
      handler: function(event: any) {
        results.push(this.value)
      }
    }

    // 使用不同的方式绑定监听器
    const bound = obj.handler.bind(obj)
    const subscriber1 = events.on('test1', bound)
    const subscriber2 = events.on('test2', obj.handler.bind(obj))

    // 触发事件
    events.emit({
      type: 'test1',
      payload: { userId: '123' }
    })

    events.emit({
      type: 'test2',
      payload: { userId: '123' }
    })

    // 验证this绑定正确
    expect(results).toEqual(['test', 'test'])

    // 清理
    subscriber1.off()
    subscriber2.off()

    // 验证清理完整性
    events.emit({
      type: 'test1',
      payload: { userId: '123' }
    })
    events.emit({
      type: 'test2',
      payload: { userId: '123' }
    })

    expect(results).toEqual(['test', 'test'])
  })
})
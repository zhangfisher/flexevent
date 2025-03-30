import { describe, test, expect, vi } from 'vitest';
import { FlexEvent } from '../event';

describe('FlexEvent 事件系统', () => {
  test('基本事件订阅与触发', async () => {
    const events = new FlexEvent();
    const mockFn = vi.fn();

    events.on('user.login', (e) => mockFn(e.payload));
    events.emit({ type: 'user.login', payload: { id: 1 } });

    expect(mockFn).toBeCalledWith({ id: 1 });
  });

  test('多层通配符匹配逻辑', () => {
    const events = new FlexEvent();
    const mockWildcard = vi.fn();
    const mockDoubleWildcard = vi.fn();

    events.on('user.*', () =>{
       mockWildcard()
    });
    events.on('**', () => {
      mockDoubleWildcard()
    });

    events.emit({ type: 'user.login', payload: null });
    events.emit({ type: 'order.created', payload: null });

    expect(mockWildcard).toBeCalledTimes(1);
    expect(mockDoubleWildcard).toBeCalledTimes(2);
  });

  test('自定义分隔符支持', () => {
    const events = new FlexEvent({ delimiter: '/' });
    const mockFn = vi.fn();

    events.on('system/error', () => mockFn());
    events.emit({ type: 'system/error', payload: null });

    expect(mockFn).toBeCalledTimes(1);
  });

  test('保留事件触发机制', () => {
    const events = new FlexEvent();
    const lateListener = vi.fn();

    events.emit({ type: 'retained.event', payload: 'data' }, true);
    events.on('retained.event', (e) => lateListener(e.payload));

    expect(lateListener).toBeCalledWith('data');
  });

  test('一次性监听器自动移除', () => {
    const events = new FlexEvent();
    const mockOnce = vi.fn();

    events.once('single.event', () => mockOnce());
    events.emit({ type: 'single.event', payload: null });
    events.emit({ type: 'single.event', payload: null });

    expect(mockOnce).toBeCalledTimes(1);
  });

  test('中文路径事件支持', () => {
    const events = new FlexEvent();
    const mockFn = vi.fn();

    events.on('订单/创建', () => mockFn());
    events.emit({ type: '订单/创建', payload: null });

    expect(mockFn).toBeCalledTimes(1);
  });

  test('异步事件处理流程', async () => {
    const events = new FlexEvent();
    const asyncMock = vi.fn().mockResolvedValue('done');

    events.on('async.event', async (e) => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return asyncMock(e.payload);
    });

    await events.emitAsync({ type: 'async.event', payload: 'data' });

    expect(asyncMock).toBeCalledWith('data');
  });

  test('类型安全性验证', () => {
    interface StrictEvents {
      'strict.event': { count: number };
    }

    const events = new FlexEvent<StrictEvents>();
    const validHandler = (e: { payload: { count: number } }) => {};
    const invalidHandler = (e: { payload: string }) => {};

    // @ts-expect-error 测试类型错误
    events.on('strict.event', invalidHandler);
    events.on('strict.event', validHandler);
  });
});
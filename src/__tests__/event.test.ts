
import { describe, test, expect, vi } from 'vitest';
import { FlexEvent } from '../event';
import { FlexEventListener, IEvent } from '../types';
import { TimeoutError } from '../errors';

describe('FlexEvent 事件系统', () => {
  test('offAll方法 - 不带参数时应移除所有监听器', () => {
    const events = new FlexEvent();
    const mockFn1 = vi.fn();
    const mockFn2 = vi.fn();

    events.on('event1', mockFn1);
    events.on('event2', mockFn2);

    events.offAll();

    events.emit({ type: 'event1', payload: null });
    events.emit({ type: 'event2', payload: null });

    expect(mockFn1).not.toHaveBeenCalled();
    expect(mockFn2).not.toHaveBeenCalled();

    // 验证内部状态
    const instance = events as any;
    expect(instance._listeners.size).toBe(0);
    expect(instance._subscribers.listeners.size).toBe(0);
    expect(instance._subscribers.children.size).toBe(0);
  });

  test('offAll方法 - 带参数时应只移除指定事件的监听器', () => {
    const events = new FlexEvent();
    const mockFn1 = vi.fn();
    const mockFn2 = vi.fn();

    events.on('event1', mockFn1);
    events.on('event2', mockFn2);

    events.offAll('event1');

    events.emit({ type: 'event1', payload: null });
    events.emit({ type: 'event2', payload: null });

    expect(mockFn1).not.toHaveBeenCalled();
    expect(mockFn2).toHaveBeenCalled();
  });

  test('clear方法 - 应同时清除所有监听器和保留事件', () => {
    const events = new FlexEvent();
    const mockFn = vi.fn();
    const retainedEvent = { type: 'retained', payload: 'data' };

    // 添加监听器和保留事件
    events.on('test', mockFn);
    events.emit(retainedEvent, true);

    // 清除所有
    events.clear();

    // 验证监听器被移除
    events.emit({ type: 'test', payload: null });
    expect(mockFn).not.toHaveBeenCalled();

    // 验证保留事件被清除
    const newListener = vi.fn();
    events.on('retained', newListener);
    expect(newListener).not.toHaveBeenCalled();

    // 验证内部状态
    const instance = events as any;
    expect(instance._listeners.size).toBe(1); // 新添加的监听器
    expect(instance._retainedEvents.size).toBe(0);
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
  test('Initialize Event System with Default Delimiter', () => {
    // Create new instance with default options
    const events = new FlexEvent();

    // Access private properties using type assertion to verify initialization
    const instance = events as any;

    // Verify delimiter is set to default '.'
    expect(instance._delimiter).toBe('.');

    // Verify collections are initialized and empty
    expect(instance._listeners).toBeInstanceOf(Map);
    expect(instance._listeners.size).toBe(0);

    expect(instance._subscribers).toEqual({
      listeners: expect.any(Set),
      children: expect.any(Map)
    });
    expect(instance._subscribers.listeners.size).toBe(0);
    expect(instance._subscribers.children.size).toBe(0);

    expect(instance._listenerCount).toBe(0);
    
    expect(instance._retainedEvents).toBeInstanceOf(Map);
    expect(instance._retainedEvents.size).toBe(0);

    expect(instance._onceListeners).toBeInstanceOf(Set);
    expect(instance._onceListeners.size).toBe(0);

    expect(instance._processedListeners).toBeInstanceOf(Set);
    expect(instance._processedListeners.size).toBe(0);
  });
  test('Initialize Event System with Custom Delimiter', () => {
    // Arrange & Act
    const events = new FlexEvent({ delimiter: '/' });

    // Assert
    // Access the private _delimiter property using type assertion
    expect((events as any)._delimiter).toBe('/');
    
    // Additional verification through behavior
    const mockFn = vi.fn();
    events.on('system/error', mockFn);
    events.emit({ type: 'system/error', payload: null });
    expect(mockFn).toHaveBeenCalled();
    
    // Verify incorrect delimiter doesn't trigger the event
    const mockFn2 = vi.fn();
    events.on('system.error', mockFn2);
    events.emit({ type: 'system/error', payload: null });
    expect(mockFn2).not.toHaveBeenCalled();
  });
  test('synchronous event emission should trigger all matching listeners', () => {
    // Arrange
    const events = new FlexEvent();
    const mockListener1 = vi.fn();
    const mockListener2 = vi.fn();
    const testPayload = { message: 'test data' };
    
    // Register multiple listeners for the same event
    events.on('test', (event) => mockListener1(event.payload));
    events.on('test', (event) => mockListener2(event.payload));

    // Act
    events.emit({ type: 'test', payload: testPayload });

    // Assert
    expect(mockListener1).toHaveBeenCalledTimes(1);
    expect(mockListener2).toHaveBeenCalledTimes(1);
    expect(mockListener1).toHaveBeenCalledWith(testPayload);
    expect(mockListener2).toHaveBeenCalledWith(testPayload);
  });

  test('synchronous event emission should not trigger unmatched listeners', () => {
    // Arrange
    const events = new FlexEvent();
    const mockListener = vi.fn();
    const testPayload = { message: 'test data' };
    
    // Register listener for a different event
    events.on('other-event', (event) => mockListener(event.payload));

    // Act
    events.emit({ type: 'test', payload: testPayload });

    // Assert
    expect(mockListener).not.toHaveBeenCalled();
  });

  test('synchronous event emission should handle multiple events independently', () => {
    // Arrange
    const events = new FlexEvent();
    const mockListener1 = vi.fn();
    const mockListener2 = vi.fn();
    const testPayload1 = { message: 'test data 1' };
    const testPayload2 = { message: 'test data 2' };
    
    // Register listeners for different events
    events.on('test1', (event) => mockListener1(event.payload));
    events.on('test2', (event) => mockListener2(event.payload));

    // Act
    events.emit({ type: 'test1', payload: testPayload1 });
    events.emit({ type: 'test2', payload: testPayload2 });

    // Assert
    expect(mockListener1).toHaveBeenCalledTimes(1);
    expect(mockListener2).toHaveBeenCalledTimes(1);
    expect(mockListener1).toHaveBeenCalledWith(testPayload1);
    expect(mockListener2).toHaveBeenCalledWith(testPayload2);
  });
  test('should handle async event emission with multiple listeners', async () => {
    // Create event instance
    const events = new FlexEvent();
    
    // Mock async listeners
    const listener1 = vi.fn().mockResolvedValue('result1');
    const listener2 = vi.fn().mockResolvedValue('result2');
    const listener3 = vi.fn().mockRejectedValue(new Error('test error'))
    // Add listeners
    events.on('test', async () => listener1());
    events.on('test', async () => listener2());
    events.on('test', async () => listener3());

    // Test data
    const testData = { message: 'test message' };

    // Emit async event and get results
    const results = await events.emitAsync({ 
      type: 'test', 
      payload: testData 
    });

    // Verify all listeners were called
    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();

    // Verify results array contains all outcomes
    expect(results.length).toHaveLength(3);
    
    // Check successful results
    expect(results[0]).toEqual({
      status: 'fulfilled',
      value: 'result1'
    });
    expect(results[1]).toEqual({
      status: 'fulfilled',
      value: 'result2'
    });
    
    // Check failed result
    expect(results[2]).toEqual({
      status: 'rejected',
      reason: expect.any(Error)
    });
  });

  test('should handle async event emission with no listeners', async () => {
    const events = new FlexEvent();
    const results = await events.emitAsync({ 
      type: 'nonexistent', 
      payload: null 
    });
    
    expect(results).toEqual([]);
  });

  test('should handle async event emission with retained events', async () => {
    const events = new FlexEvent();
    const listener = vi.fn().mockResolvedValue('retained');

    // Emit retained event
    await events.emitAsync({ 
      type: 'retained', 
      payload: 'data' 
    }, true);

    // Add listener after emission
    events.on('retained', async () => listener());

    // Verify listener was called with retained event
    expect(listener).toHaveBeenCalled();
  });
  test('should store retained events in _retainedEvents Map', () => {
    // Arrange
    const events = new FlexEvent();
    const testEvent: IEvent = {
      type: 'test',
      payload: 'test data'
    };

    // Act
    events.emit(testEvent, true);

    // Assert
    // Access the private _retainedEvents map using type assertion
    const retainedEvents = (events as any)._retainedEvents as Map<string, IEvent>;
    
    // Check if the event is stored in the _retainedEvents Map
    expect(retainedEvents.has('test')).toBe(true);
    expect(retainedEvents.get('test')).toEqual(testEvent);

    // Verify that late subscribers receive the retained event
    const mockListener = vi.fn();
    events.on('test', mockListener);
    expect(mockListener).toHaveBeenCalledWith(testEvent);
  });
});
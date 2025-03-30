import { TimeoutError } from "./errors";
import { FlexEventOptions, IEvent, FlexEventListener, FlexEventSubscriber } from "./types";


/**
 * 订阅者节点结构，用于树状组织事件
 */
interface SubscriberNode {
  listeners: Set<number>;
  children: Map<string, SubscriberNode>;
}

/**
 * FlexEvent - 灵活的事件发射器，支持通配符订阅和自定义分隔符
 * 
 * @example
 * ```typescript
 * interface MyEvents {
 *   'user.login': { userId: string };
 *   'user.logout': { userId: string };
 *   'message.received': { from: string; content: string };
 * }
 * 
 * const events = new FlexEvent<MyEvents>();
 * events.on('user.login', (event) => {
 *   // event.payload 的类型为 { userId: string }
 * });
 * ```
 */


export class FlexEvent<Events extends Record<string, any> = Record<string, any>> {
  private _listeners: Map<number, FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>>;
  private _subscribers: SubscriberNode;
  private _listenerCount: number;
  private _retainedEvents: Map<string, IEvent<keyof Events & string, Events[keyof Events]>>;
  private _onceListeners: Set<number>;
  private readonly _delimiter: string;
  private _processedListeners: Set<number>; 

  constructor(options: FlexEventOptions = {}) {
    this._listeners = new Map();
    this._subscribers = { listeners: new Set(), children: new Map() };
    this._listenerCount = 0;
    this._retainedEvents = new Map();
    this._onceListeners = new Set();
    this._delimiter = options.delimiter || '.';
    this._processedListeners = new Set();
  }
  private _navigateToNode(eventType:string,create?:boolean){
  /**
   * 在订阅者树中导航到指定节点
   * @param eventType 事件类型
   * @param create 是否创建不存在的节点
   * @returns 目标节点和路径部分
   */
    const parts = eventType.split(this._delimiter);
    let current = this._subscribers;

    for (const part of parts) {
      if (!current.children.has(part)) {
        if (!create) break;
        current.children.set(part, { listeners: new Set(), children: new Map() });
      }
      current = current.children.get(part)!;
    }

    return { node: current, parts };
  }

  /**
   * 添加监听器到事件系统
   * @param eventType 事件类型
   * @param listener 监听器函数
   * @param isOnce 是否为一次性监听器
   * @returns 订阅者对象
   */
  private _addListener<K extends keyof Events & string>(
    eventType: K | string,
    listener: FlexEventListener<IEvent<K, Events[K]>>,
    isOnce: boolean = false
  ): FlexEventSubscriber {
    const listenerId = this._listenerCount++;
    this._listeners.set(listenerId, listener as FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>);
    if (isOnce) {
      this._onceListeners.add(listenerId);
    }

    const { node } = this._navigateToNode(eventType, true);
    node.listeners.add(listenerId);

    // 检查保留的事件
    if (this._retainedEvents.has(eventType)) {
      const event = this._retainedEvents.get(eventType)!;
      listener(event as IEvent<K, Events[K]>);
      if (isOnce) {
        this._listeners.delete(listenerId);
        this._onceListeners.delete(listenerId);
        node.listeners.delete(listenerId);
        return { off: () => {} };
      }
    }

    return {
      off: () => {
        this._listeners.delete(listenerId);
        if (isOnce) {
          this._onceListeners.delete(listenerId);
        }
        node.listeners.delete(listenerId);
      }
    };
  }

  /**
   * 从节点中移除监听器
   * @param node 目标节点
   * @param listener 要移除的监听器
   */
  private _removeListenerFromNode(
    node: SubscriberNode,
    listener: FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>
  ): void {
    for (const [id, fn] of this._listeners.entries()) {
      if (fn === listener && node.listeners.has(id)) {
        node.listeners.delete(id);
        this._listeners.delete(id);
        this._onceListeners.delete(id);
        break;
      }
    }
  }

  /**
   * 处理事件触发的监听器
   * @param node 当前节点
   * @param listener 监听器函数
   * @param id 监听器ID
   * @param event 事件对象
   * @param isAsync 是否异步处理
   */
  private async _processListener(
    node: SubscriberNode,
    listener: FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>,
    id: number,
    event: IEvent<keyof Events & string, Events[keyof Events]>,
    isAsync: boolean
  ): Promise<any> {
    try {
      const result = listener(event);
      if (isAsync && result instanceof Promise) {
        return await result;
      }
      return result;
    } finally {
      if (this._onceListeners.has(id)) {
        this._listeners.delete(id);
        this._onceListeners.delete(id);
        node.listeners.delete(id);
      }
    }
  }

  /**
   * 递归触发订阅者的事件
   * @param node 当前节点
   * @param parts 事件路径部分
   * @param event 事件对象
   * @param isAsync 是否异步处理
   */
  private _emitToSubscribers(
    node: SubscriberNode,
    parts: string[],
    event: IEvent<keyof Events & string, Events[keyof Events]>,
    isAsync: boolean = false,
  ): void | Promise<any[]> {
    const promises: Promise<any>[] = [];
    
    // 处理当前层级的监听器
    for (const id of node.listeners) {
      // 跳过已处理过的监听器
      if (this._processedListeners.has(id)) continue;
      
      const listener = this._listeners.get(id);
      if (listener) {
        this._processedListeners.add(id);
        if (isAsync) {
          promises.push(this._processListener(node, listener, id, event, isAsync));
        } else {
          this._processListener(node, listener, id, event, isAsync);
        }
      }
    }

    if (parts.length === 0) {
      return isAsync ? Promise.all(promises) : undefined;
    }

    const [current, ...rest] = parts;
    const childPromises: Promise<any>[] = [];

    // 处理精确匹配
    if (node.children.has(current)) {
      const result = this._emitToSubscribers(node.children.get(current)!, rest, event, isAsync);
      if (result instanceof Promise) {
        childPromises.push(result);
      }
    }

    // 处理单层通配符
    if (node.children.has('*')) {
      const result = this._emitToSubscribers(node.children.get('*')!, rest, event, isAsync);
      if (result instanceof Promise) {
        childPromises.push(result);
      }
    }

    // 处理多层通配符
    if (node.children.has('**')) {
      const doubleWildcard = node.children.get('**')!;
      // 对于多层通配符，只在当前层级触发一次
      const result = this._emitToSubscribers(doubleWildcard, [], event, isAsync);
      if (result instanceof Promise) {
        childPromises.push(result);
      }
    }

    if (isAsync) {
      return Promise.all([...promises, ...childPromises]).then(results => 
        results.flat()
      );
    }
  }

  /**
   * 递归移除订阅者
   * @param node 当前节点
   * @param parts 事件路径部分
   */
  private _removeSubscribers(node: SubscriberNode, parts: string[]): void {
    if (parts.length === 0) {
      for (const id of node.listeners) {
        this._listeners.delete(id);
      }
      node.listeners.clear();
      return;
    }

    const [current, ...rest] = parts;
    if (node.children.has(current)) {
      this._removeSubscribers(node.children.get(current)!, rest);
      if (rest.length === 0) {
        node.children.delete(current);
      }
    }
  }

  /**
   * 订阅事件
   * @param eventType 事件类型（支持分隔符表示法和通配符：* 表示单层，** 表示多层）
   * @param listener 回调函数
   * @returns 包含off方法的订阅者对象，用于取消订阅
   * @example
   * ```typescript
   * interface MyEvents {
   *   'user.login': { userId: string };
   * }
   * 
   * const events = new FlexEvent<MyEvents>();
   * events.on('user.login', (event) => {
   *   console.log(event.payload.userId); // 类型为string
   * });
   * ```
   */
  on<K extends keyof Events & string>(
    eventType: K | string,
    listener: FlexEventListener<IEvent<K, Events[K]>>
  ): FlexEventSubscriber {
    return this._addListener(eventType, listener);
  }

  /**
   * 订阅事件一次，触发后自动取消订阅
   * @param eventType 事件类型（支持分隔符表示法和通配符：* 表示单层，** 表示多层）
   * @param listener 回调函数
   * @returns 包含off方法的订阅者对象，用于取消订阅
   */
  once<K extends keyof Events & string>(
    eventType: K | string,
    listener: FlexEventListener<IEvent<K, Events[K]>>
  ): FlexEventSubscriber {
    return this._addListener(eventType, listener, true);
  }

  /**
   * 触发事件
   * @param event 包含类型和载荷的事件对象
   * @param retain 是否为后续订阅者保留事件
   */
  emit<K extends keyof Events & string>(
    event: IEvent<K, Events[K]>,
    retain: boolean = false
  ): void {
    if (retain) {
      this._retainedEvents.set(event.type, event as IEvent<keyof Events & string, Events[keyof Events]>);
    }

    const { parts } = this._navigateToNode(event.type);
    this._emitToSubscribers(
      this._subscribers,
      parts,
      event as IEvent<keyof Events & string, Events[keyof Events]>,
      false, 
    );
  }

  /**
   * 异步触发事件
   * @param event 包含类型和载荷的事件对象
   * @param retain 是否为后续订阅者保留事件
   * @returns Promise，解析为所有监听器的结果数组
   */
  async emitAsync<K extends keyof Events & string>(
    event: IEvent<K, Events[K]>,
    retain: boolean = false
  ): Promise<Array<{ status: string; value?: any; reason?: any; }>> {
    if (retain) {
      this._retainedEvents.set(event.type, event as IEvent<keyof Events & string, Events[keyof Events]>);
    }

    const { parts } = this._navigateToNode(event.type);
    const results = await this._emitToSubscribers(
      this._subscribers,
      parts,
      event as IEvent<keyof Events & string, Events[keyof Events]>,
      true 
    ) || [];
    
    return Promise.allSettled(results.flat().filter(r => r !== undefined));
  }

  /**
   * 移除特定事件的特定监听器
   * @param eventType 事件类型（使用配置的分隔符）
   * @param listener 要移除的监听器
   */
  off<K extends keyof Events & string>(
    eventType: K | string,
    listener: FlexEventListener<IEvent<K, Events[K]>>
  ): void {
    const { node } = this._navigateToNode(eventType);
    this._removeListenerFromNode(node, listener as FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>);
  }

  /**
   * 订阅所有事件
   * @param listener 回调函数，将接收所有事件的通知
   * @returns 包含off方法的订阅者对象，用于取消订阅
   * @example
   * ```typescript
   * interface MyEvents {
   *   'user.login': { userId: string };
   *   'user.logout': { userId: string };
   * }
   * 
   * const events = new FlexEvent<MyEvents>();
   * events.onAny((event) => {
   *   // event.type 可能是 'user.login' 或 'user.logout'
   *   // event.payload 类型会根据事件类型自动推断
   *   console.log(event.type, event.payload);
   * });
   * ```
   */
  onAny(listener: FlexEventListener<IEvent<keyof Events & string, Events[keyof Events]>>): FlexEventSubscriber {
    return this._addListener('**', listener);
  }

  /**
   * 移除特定事件的所有监听器，如果未指定事件类型则移除所有事件的监听器
   * @param eventType 可选的事件类型（使用配置的分隔符）
   */
  offAll(eventType?: string): void {
    if (!eventType) {
      this._listeners.clear();
      this._subscribers = { listeners: new Set(), children: new Map() };
      this._retainedEvents.clear();
      return;
    }

    const { parts } = this._navigateToNode(eventType);
    this._removeSubscribers(this._subscribers, parts);
  }

  /**
   * 等待事件触发
   * @param eventType 事件类型
   * @param timeout 超时时间（毫秒），默认为0（不超时）
   * @returns Promise，resolve时返回触发的事件，超时时抛出TimeoutError
   * @example
   * ```typescript
   * interface MyEvents {
   *   'user.login': { userId: string };
   * }
   * 
   * const events = new FlexEvent<MyEvents>();
   * try {
   *   const event = await events.waitFor('user.login', 5000);
   *   console.log(event.payload.userId);
   * } catch (error) {
   *   if (error instanceof TimeoutError) {
   *     console.log('Waiting for user login timed out');
   *   }
   * ```
   */
  waitFor<K extends keyof Events & string>(
    eventType: K | string,
    timeout: number = 0
  ): Promise<IEvent<K, Events[K]>> {
    return new Promise((resolve, reject) => {
      let timeoutId: any;
      
      // 创建事件监听器
      const subscriber = this.once(eventType, (event) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(event as IEvent<K, Events[K]>);
      });

      // 如果设置了超时时间，创建定时器
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          subscriber.off(); // 清理事件监听器
          reject(new TimeoutError(`Waiting for event "${eventType}" timed out after ${timeout}ms`));
        }, timeout);
      }
    });
  }
  clear(){
    this.offAll()
    this._retainedEvents.clear()
  }
}
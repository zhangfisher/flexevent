/**
 * 事件接口定义
 */
export interface IEvent<Type extends string = string, Payload = any> {
    type: Type;
    payload?: Payload;
  }
  
  /**
   * 事件监听器函数类型
   */
export type FlexEventListener<E extends IEvent> = (event: E) => void | Promise<any>;
  
  /**
   * FlexEvent构造函数选项
   */
export interface FlexEventOptions {
    /**
     * 事件类型分隔符，默认为'.'
     */
    delimiter?: string;
}
  
  /**
   * 订阅者接口，用于取消订阅
   */
export interface FlexEventSubscriber {
    off: () => void;
}
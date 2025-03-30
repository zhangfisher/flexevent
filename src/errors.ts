/**
 * 超时错误类
 */
export class TimeoutError extends Error {
    constructor(message: string = 'Operation timed out') {
      super(message);
      this.name = 'TimeoutError';
    }
  }
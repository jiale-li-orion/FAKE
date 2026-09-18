/**
 * jsdom 环境准备。
 *
 * 只补 jsdom 缺失的浏览器 API，不 mock 任何业务模块 ——
 * 业务模块的替换由各用例自己显式声明，避免隐式全局 mock 让测试难以推理。
 */

// jsdom 未实现 matchMedia；motion 库会用到
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdom 未实现 Element.scrollTo；消息列表自动滚动会调用
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo() {};
}

// motion 需要 rAF；jsdom 有实现但为防差异做兜底
if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame;
}

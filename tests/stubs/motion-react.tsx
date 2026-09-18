/**
 * `motion/react` 的测试替身。
 *
 * jsdom 里没有动画引擎，`motion` 组件最终也只是渲染 div，对功能断言毫无影响；
 * 但它的模块图很大，冷加载会把 vitest worker 的启动拖过 60 秒硬上限
 * （`START_TIMEOUT` 在 vitest 源码里是常量，不可配置）。
 *
 * 替换后组件行为不变：`motion.div` 渲染 div，布局类 props 被丢弃，
 * `AnimatePresence` 直接透传 children。
 */
import React from 'react';

const MOTION_ONLY_PROPS = new Set([
  'initial', 'animate', 'exit', 'transition', 'variants', 'whileHover',
  'whileTap', 'whileFocus', 'whileInView', 'layout', 'layoutId', 'drag',
  'dragConstraints', 'onAnimationComplete', 'onAnimationStart', 'style',
]);

function makeMotionComponent(tag: string) {
  return React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) {
      // 丢弃动画专用 props，其余（className/style/data-*/onClick…）原样透传
      if (MOTION_ONLY_PROPS.has(k)) {
        if (k === 'style') clean.style = v;   // style 是真实 DOM 属性，保留
        continue;
      }
      clean[k] = v;
    }
    return React.createElement(tag, { ...clean, ref });
  });
}

export const motion = new Proxy({} as Record<string, unknown>, {
  get: (_t, tag: string) => makeMotionComponent(String(tag)),
});

/** 测试中不需要进出场语义，直接渲染 children */
export function AnimatePresence({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

export const useAnimation = () => ({ start: async () => {}, stop: () => {} });
export const useMotionValue = (v: unknown) => ({ get: () => v, set: () => {} });
export const useTransform = () => ({ get: () => 0, set: () => {} });
export const LayoutGroup = ({ children }: { children?: React.ReactNode }) =>
  React.createElement(React.Fragment, null, children);

/**
 * dsh-powerbox test harness
 *
 * 这个仓库不能 import react / react-dom：插件运行在 DSH 内核页面里，宿主
 * 负责提供 react（ModuleLoader 的 `require('react')`）。为了在没有宿主、
 * 没有 react 依赖的环境下也能测真实行为，harness 提供一个钩子语义等价的
 * 极小 react（createElement + useState/useRef/useCallback/useEffect）和一个
 * 直接建 DOM 的极小渲染器，并用 jsdom 承载。
 *
 * 语义边界（够本插件使用，也足够严格）：
 *   - useState/useRef 按调用顺序存槽，setState 触发重渲染；
 *   - useEffect 在渲染提交后执行，返回函数作为清理函数；
 *   - 渲染器把 createElement 描述树物化成真实 DOM，事件用 addEventListener；
 *   - 每次重渲染整棵重建（React 复用节点；本插件的断言不依赖节点身份，
 *     仅「关闭后焦点归还」一条按当前 DOM 里的触发按钮比对）。
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

export const FRAGMENT = Symbol('Fragment');

export function createReactHarness() {
  let hooks = [];
  let cursor = 0;
  let pendingEffects = [];
  let cleanups = [];
  let rerender = null;
  let rendering = false;
  let dirty = false;

  const sameDeps = (a, b) => {
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
  };

  const schedule = () => {
    if (rendering) { dirty = true; return; }
    if (rerender) rerender();
  };

  const react = {
    Fragment: FRAGMENT,
    createElement(type, props, ...children) {
      const merged = {};
      if (props) for (const k of Object.keys(props)) merged[k] = props[k];
      const flat = [];
      const push = (c) => {
        if (Array.isArray(c)) c.forEach(push);
        else if (c !== null && c !== undefined && c !== false && c !== true) flat.push(c);
      };
      children.forEach(push);
      if (flat.length) merged.children = flat;
      return { type, props: merged };
    },
    useState(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { value: typeof initial === 'function' ? initial() : initial, kind: 'state' };
      const set = (value) => {
        const next = typeof value === 'function' ? value(hooks[i].value) : value;
        if (Object.is(next, hooks[i].value)) return;
        hooks[i].value = next;
        schedule();
      };
      return [hooks[i].value, set];
    },
    useRef(initial) {
      const i = cursor++;
      if (!(i in hooks)) hooks[i] = { current: initial, kind: 'ref' };
      return hooks[i];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (!prev || !sameDeps(prev.deps, deps)) hooks[i] = { fn, deps, kind: 'cb' };
      return hooks[i].fn;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const prev = hooks[i];
      if (prev && sameDeps(prev.deps, deps)) return;
      hooks[i] = { deps, kind: 'effect' };
      pendingEffects.push({ index: i, fn });
    },
  };

  return {
    react,
    setRerender(fn) { rerender = fn; },
    beginRender() {
      rendering = true;
      cursor = 0;
      pendingEffects = [];
      for (const fn of cleanups) {
        try { fn(); } catch { /* 清理失败不影响断言 */ }
      }
      cleanups = [];
    },
    endRender() {
      rendering = false;
      const effects = pendingEffects;
      pendingEffects = [];
      for (const e of effects) {
        const result = e.fn();
        if (typeof result === 'function') cleanups.push(result);
      }
      if (dirty) { dirty = false; schedule(); }
    },
    teardown() {
      for (const fn of cleanups) {
        try { fn(); } catch { /* 同上 */ }
      }
      cleanups = [];
      hooks = [];
    },
  };
}

/**
 * 把 createElement 描述树渲染成真实 DOM。
 * ref 会写回 { current }；className/style/disabled/on* 各有专门处理。
 */
export function renderTree(harness, element, parent, document) {
  const { react } = harness;
  if (element === null || element === undefined || element === false || element === true) return;
  if (typeof element === 'string' || typeof element === 'number') {
    parent.appendChild(document.createTextNode(String(element)));
    return;
  }
  if (Array.isArray(element)) {
    for (const child of element) renderTree(harness, child, parent, document);
    return;
  }
  const { type, props } = element;
  if (type === react.Fragment) {
    for (const child of props.children || []) renderTree(harness, child, parent, document);
    return;
  }
  if (typeof type === 'function') {
    renderTree(harness, type(props), parent, document);
    return;
  }
  const node = document.createElement(type);
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key === 'children') continue;
    if (key === 'key') continue;
    if (key === 'ref') {
      if (value && typeof value === 'object') value.current = node;
      continue;
    }
    if (key === 'className') { if (value) node.setAttribute('class', String(value)); continue; }
    if (key === 'style') {
      if (value && typeof value === 'object') for (const s of Object.keys(value)) node.style[s] = value[s];
      continue;
    }
    if (key === 'disabled') { if (value) node.setAttribute('disabled', ''); continue; }
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
      continue;
    }
    if (value === null || value === undefined || value === false) continue;
    if (value === true) { node.setAttribute(key, ''); continue; }
    node.setAttribute(key, String(value));
  }
  for (const child of props.children || []) renderTree(harness, child, node, document);
  parent.appendChild(node);
}

/** 迷你 jsdom 环境：提供 window/document，供插件 bundle 在 vm 里执行。 */
export function createDom(url = 'http://127.0.0.1/') {
  return new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url,
    pretendToBeVisual: true,
    // 插件 bundle 由内核注入执行；这里需要同一窗口的 vm 上下文，
    // outside-only = 只允许我们从外部跑脚本，不执行页面自带 script。
    runScripts: 'outside-only',
  });
}

/** 挂载组件并返回可控句柄（整棵重建式渲染）。 */
export function mount(Component, props, document, harness) {
  assert.ok(harness, '必须传入组件实际使用的 react harness（钩子状态与调度器必须同源）');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const { react } = harness;

  const paint = () => {
    harness.beginRender();
    container.textContent = '';
    renderTree(harness, react.createElement(Component, props), container, document);
    harness.endRender();
  };
  harness.setRerender(paint);
  paint();

  return {
    harness,
    container,
    get root() { return container; },
    paint,
    unmount() {
      harness.teardown();
      container.remove();
    },
  };
}

export const q = (root, selector) => root.querySelector(selector);
export const qa = (root, selector) => Array.from(root.querySelectorAll(selector));
export const click = (node) => {
  assert.ok(node, '待点击元素必须存在');
  node.dispatchEvent(new node.ownerDocument.defaultView.MouseEvent('click', { bubbles: true, cancelable: true }));
};
/** promise 链需要多轮微任务才落定，用宏任务一次冲干净。 */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

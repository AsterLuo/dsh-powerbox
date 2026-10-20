// dsh-powerbox — 行为测试
//
// 覆盖：
//   1. 装配契约：注册到 conversation.session.header.utilities（list 插槽需
//      id/order/locale），字典走 ctx.locale.register；
//   2. 交互流程：按钮 → 模式弹窗（重启 / 关闭）→ 各自的二次确认 → 桥调用；
//      取消 / Esc / 点遮罩不产生任何桥调用；未二次确认前不调用桥；确认后
//      只调用一次；请求在途时确认按钮禁用；
//   3. 无桌面桥降级：按钮禁用 + 可读提示，不抛异常；
//   4. 包元数据与 bundle 契约：安装后能被官方 CLI 识别并自动挂载。
//
// 运行：npm test   （或 node --test test/*.test.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  createReactHarness, createDom, mount, q, click, flush,
} from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const clientSrc = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf8');

const PLUGIN_NAME = 'dsh-powerbox';
const SLOT = 'conversation.session.header.utilities';
const NS = 'powerbox';
const SEL = {
  trigger: '[data-control-name="powerbox.trigger"]',
  dialog: '[data-control-name="powerbox.dialog"]',
  modeRestart: '[data-control-name="powerbox.mode-restart"]',
  modeShutdown: '[data-control-name="powerbox.mode-shutdown"]',
  modeCancel: '[data-control-name="powerbox.mode-cancel"]',
  confirmRestart: '[data-control-name="powerbox.confirm-restart"]',
  confirmShutdown: '[data-control-name="powerbox.confirm-shutdown"]',
  confirmBack: '[data-control-name="powerbox.confirm-back"]',
  backdrop: '[data-control-name="powerbox.backdrop"]',
};

// ---------------------------------------------------------------------------
// 记录型桌面桥：留下调用痕迹，便于断言「调用了几次 / 有没有被调用」
// ---------------------------------------------------------------------------
function makeBridge(overrides = {}) {
  const calls = [];
  const record = (name, result) => (...args) => {
    calls.push({ name, args });
    return Promise.resolve(result === undefined ? { ok: true } : result);
  };
  return {
    calls,
    boot: {
      start: record('boot.start'),
      stop: record('boot.stop'),
      state: record('boot.state', { running: true }),
      restart: record('boot.restart', { ok: true, webUrl: 'http://127.0.0.1:12808/', port: 12808 }),
    },
    windowControls: { close: record('windowControls.close') },
    _call: (method, params) => {
      calls.push({ name: '_call:' + method, args: [params] });
      return Promise.resolve({ ok: true });
    },
    ...overrides,
  };
}

/** 在 jsdom 里执行插件 bundle，拿回导出的 apply / __internals。 */
function loadPlugin(options = {}) {
  const dom = createDom();
  const { window } = dom;
  if (options.bridge !== null) window.dshDesktop = options.bridge === undefined ? makeBridge() : options.bridge;

  const harness = createReactHarness();
  let loaded = null;
  window.__ModuleLoader__ = {
    load({ id, factory }) {
      loaded = {
        id,
        exports: factory((name) => {
          if (name === 'react') return harness.react;
          throw new Error('unexpected require: ' + name);
        }),
      };
    },
  };

  vm.runInContext(clientSrc, dom.getInternalVMContext(), { filename: 'dsh-powerbox/client.js' });
  assert.ok(loaded, '插件必须调用 __ModuleLoader__.load');
  return { dom, window, document: window.document, loaded, id: loaded.id, exports: loaded.exports, harness };
}

/** 假 ctx：slots / locale 面（只保留插件真正消费的键）。 */
function makeCtx() {
  const registered = [];
  const dictionaries = [];
  const effects = [];
  const injected = [];
  const ctx = {
    locale: {
      bind: (ns) => (key) => ns + ':' + key,
      register: (ns, dict) => { dictionaries.push({ ns, dict }); return () => {}; },
    },
    slots: {
      inject: (name, cb) => { injected.push({ name, cb }); return () => {}; },
      register: (options, component) => { registered.push({ options, component }); return () => {}; },
    },
    effect: (fn, label) => {
      effects.push({ fn, label });
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
  };
  return { ctx, registered, dictionaries, effects, injected };
}

function mountFromCtx(pluginHarness, ctxBundle, overrides = {}) {
  pluginHarness.exports.apply(ctxBundle.ctx);
  assert.equal(ctxBundle.injected.length, 1, '只应注入一个插槽');
  ctxBundle.injected[0].cb();
  assert.equal(ctxBundle.registered.length, 1, '应注册一个条目');
  const { options, component } = ctxBundle.registered[0];
  const handle = mount(
    component,
    { sessionId: 's-1', t: (k) => 'T:' + k, ...overrides },
    pluginHarness.document,
    pluginHarness.harness,
  );
  return { handle, options, component, document: pluginHarness.document, window: pluginHarness.window };
}

// ---------------------------------------------------------------------------
// 1. 装配契约
// ---------------------------------------------------------------------------
test('注册到会话/项目页头部右侧插槽（list 插槽契约完整）', () => {
  const p = loadPlugin();
  const bundle = makeCtx();
  const { options, handle } = mountFromCtx(p, bundle);

  assert.equal(options.name, SLOT, '落点必须是会话/项目页头部右侧 utilities 插槽');
  assert.equal(typeof options.id, 'string', 'list 插槽必须提供 id');
  assert.ok(options.id.length > 0);
  assert.equal(typeof options.order, 'number', 'order 决定右侧按钮排序');
  assert.equal(options.locale, NS, 'locale 命名空间要与字典注册一致');
  assert.equal(p.exports.inject.includes('slots'), true);
  assert.equal(p.exports.inject.includes('locale'), true);
  handle.unmount();
});

test('中英字典齐备且键集合一致', () => {
  const p = loadPlugin();
  const { NS: ns, zh, en } = p.exports.__internals;
  assert.equal(ns, NS);
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort(), 'zh/en 键必须一一对应');
  for (const key of ['trigger', 'modeRestart', 'modeShutdown', 'restartConfirm', 'shutdownConfirm', 'cancel']) {
    assert.equal(typeof zh[key], 'string');
    assert.ok(zh[key].length > 0, key + ' 不应为空');
  }
});

test('apply 注册字典并登记 effect 清理', () => {
  const p = loadPlugin();
  const bundle = makeCtx();
  p.exports.apply(bundle.ctx);
  assert.equal(bundle.dictionaries.length, 1);
  assert.equal(bundle.dictionaries[0].ns, NS);
  assert.equal(bundle.effects.length, 1, '字典注册应包在 ctx.effect 里以便卸载回收');
});

// ---------------------------------------------------------------------------
// 2. 交互流程
// ---------------------------------------------------------------------------
test('初始只渲染一个电源按钮，不渲染任何弹层', () => {
  const p = loadPlugin();
  const { handle } = mountFromCtx(p, makeCtx());
  const trigger = q(handle.root, SEL.trigger);
  assert.ok(trigger, '必须渲染触发按钮');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(q(handle.root, '[role="dialog"]'), null, '未点击前不得出现弹层');
  handle.unmount();
});

test('点击按钮弹出模式选择：重启 / 关闭两个模式都在', () => {
  const p = loadPlugin();
  const { handle } = mountFromCtx(p, makeCtx());
  click(q(handle.root, SEL.trigger));

  const dialog = q(handle.root, SEL.dialog);
  assert.ok(dialog, '必须出现弹窗');
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  assert.equal(dialog.getAttribute('data-phase'), 'mode');
  assert.ok(q(handle.root, SEL.modeRestart), '缺少重启模式');
  assert.ok(q(handle.root, SEL.modeShutdown), '缺少关闭模式');
  assert.ok(q(handle.root, SEL.modeCancel), '缺少取消');
  handle.unmount();
});

test('模式弹窗点取消：不调用任何桌面桥，弹层关闭', () => {
  const p = loadPlugin();
  const { handle } = mountFromCtx(p, makeCtx());
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeCancel));
  assert.equal(q(handle.root, SEL.dialog), null);
  assert.equal(bridge.calls.length, 0, '取消不得触发重启或关闭');
  handle.unmount();
});

test('重启：必须经过二次确认，未确认前绝不调用 boot.restart', async () => {
  const p = loadPlugin();
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeRestart));

  const dialog = q(handle.root, SEL.dialog);
  assert.equal(dialog.getAttribute('data-phase'), 'confirm-restart', '必须进入二次确认阶段');
  assert.equal(bridge.calls.length, 0, '选了重启但未二次确认时不得调用桥');

  const confirm = q(handle.root, SEL.confirmRestart);
  assert.ok(confirm, '缺少二次确认按钮');
  assert.equal(confirm.disabled, false);
  click(confirm);
  await flush();

  assert.equal(bridge.calls.filter((c) => c.name === 'boot.restart').length, 1,
    '确认后必须且只能调用一次 boot.restart');
  assert.equal(bridge.calls.filter((c) => c.name.indexOf('_call:win.close') === 0).length, 0,
    '重启路径不得触发关闭');
  handle.unmount();
});

test('重启确认后进入忙碌态并禁用按钮（防重复触发）', async () => {
  const p = loadPlugin();
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeRestart));
  click(q(handle.root, SEL.confirmRestart));
  await flush();

  const dialog = q(handle.root, SEL.dialog);
  assert.equal(dialog.getAttribute('data-phase'), 'busy-restart');
  assert.equal(q(handle.root, SEL.confirmRestart).disabled, true, '在途期间确认按钮必须禁用');
  assert.equal(q(handle.root, SEL.confirmBack).disabled, true, '在途期间返回按钮必须禁用');
  click(q(handle.root, SEL.confirmRestart));
  await flush();
  assert.equal(bridge.calls.filter((c) => c.name === 'boot.restart').length, 1, '不得重复触发');
  handle.unmount();
});

test('关闭：必须经过二次确认，确认后调用 win.close-force 恰好一次', async () => {
  const p = loadPlugin();
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  const shutdownMode = q(handle.root, SEL.modeShutdown);
  assert.equal(shutdownMode.getAttribute('data-state'), 'dangerous', '关闭模式应标记为危险操作');
  click(shutdownMode);

  const dialog = q(handle.root, SEL.dialog);
  assert.equal(dialog.getAttribute('data-phase'), 'confirm-shutdown');
  assert.equal(dialog.getAttribute('data-state'), 'dangerous');
  assert.equal(bridge.calls.length, 0, '选了关闭但未二次确认时不得调用桥');

  click(q(handle.root, SEL.confirmShutdown));
  await flush();
  assert.equal(bridge.calls.filter((c) => c.name === '_call:win.close-force').length, 1,
    '确认后必须且只能调用一次 win.close-force');
  assert.equal(bridge.calls.filter((c) => c.name === 'boot.restart').length, 0,
    '关闭路径不得触发重启');
  handle.unmount();
});

test('二次确认可返回模式选择，返回后仍不调用桥', () => {
  const p = loadPlugin();
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeShutdown));
  click(q(handle.root, SEL.confirmBack));

  assert.equal(q(handle.root, SEL.dialog).getAttribute('data-phase'), 'mode', '返回应回到模式选择');
  assert.equal(bridge.calls.length, 0);
  handle.unmount();
});

test('Esc 关闭弹层；忙碌态 Esc 不关闭（避免中断进行中的重启）', async () => {
  const p = loadPlugin();
  const bridge = makeBridge();
  p.window.dshDesktop = bridge;
  const { handle, document } = mountFromCtx(p, makeCtx());

  const esc = () => document.dispatchEvent(new document.defaultView.KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  }));

  click(q(handle.root, SEL.trigger));
  assert.ok(q(handle.root, SEL.dialog));
  esc();
  assert.equal(q(handle.root, SEL.dialog), null, 'Esc 应关闭弹层');

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeRestart));
  click(q(handle.root, SEL.confirmRestart));
  await flush();
  esc();
  assert.ok(q(handle.root, SEL.dialog), '重启在途时 Esc 不应关闭弹层');
  handle.unmount();
});

test('点击遮罩关闭弹层，点击卡片内部不关闭', () => {
  const p = loadPlugin();
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.dialog));
  assert.ok(q(handle.root, SEL.dialog), '点卡片内部不应关闭');

  click(q(handle.root, SEL.backdrop));
  assert.equal(q(handle.root, SEL.dialog), null, '点遮罩应关闭');
  handle.unmount();
});

test('关闭弹层后焦点归还触发按钮', () => {
  const p = loadPlugin();
  const { handle, document } = mountFromCtx(p, makeCtx());
  const trigger = q(handle.root, SEL.trigger);
  trigger.focus();
  assert.equal(document.activeElement, trigger);

  click(trigger);
  click(q(handle.root, SEL.modeCancel));
  // 本 harness 整棵重建 DOM，故按「当前 DOM 里的触发按钮」比对焦点落点。
  assert.equal(document.activeElement, q(handle.root, SEL.trigger), '关闭后焦点应回到触发按钮');
  handle.unmount();
});

// ---------------------------------------------------------------------------
// 3. 无桌面桥降级
// ---------------------------------------------------------------------------
test('无桌面桥（普通浏览器打开）：按钮禁用并给出可读提示，点击不抛异常', () => {
  const p = loadPlugin({ bridge: null });
  assert.equal(p.exports.__internals.hasBridge(), false);
  const { handle } = mountFromCtx(p, makeCtx());
  const trigger = q(handle.root, SEL.trigger);
  assert.ok(trigger);
  assert.equal(trigger.disabled, true, '无桥时按钮必须禁用，避免半残可点');
  assert.equal(trigger.getAttribute('aria-label'), NS + ':triggerDisabled');
  click(trigger);
  assert.equal(q(handle.root, SEL.dialog), null);
  handle.unmount();
});

test('桥缺少关闭能力时同样判定为不可用', () => {
  const p = loadPlugin({ bridge: { boot: { restart: () => Promise.resolve({ ok: true }) } } });
  assert.equal(p.exports.__internals.hasBridge(), false);
});

test('桥报错时展示失败文案而不是静默', async () => {
  const p = loadPlugin();
  p.window.dshDesktop = makeBridge({ boot: { restart: () => Promise.reject(new Error('sidecar down')) } });
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeRestart));
  click(q(handle.root, SEL.confirmRestart));
  await flush();

  const dialog = q(handle.root, SEL.dialog);
  assert.equal(dialog.getAttribute('data-phase'), 'error-restart');
  assert.match(dialog.textContent, new RegExp(NS + ':restartFailed'));
  handle.unmount();
});

test('桥返回 ok:false 时同样进入失败态并可重试', async () => {
  const p = loadPlugin();
  p.window.dshDesktop = makeBridge({ _call: () => Promise.resolve({ ok: false, error: 'denied' }) });
  const { handle } = mountFromCtx(p, makeCtx());

  click(q(handle.root, SEL.trigger));
  click(q(handle.root, SEL.modeShutdown));
  click(q(handle.root, SEL.confirmShutdown));
  await flush();

  const dialog = q(handle.root, SEL.dialog);
  assert.equal(dialog.getAttribute('data-phase'), 'error-shutdown');
  assert.match(dialog.textContent, /denied/);
  assert.equal(q(handle.root, SEL.confirmShutdown).disabled, false, '失败后应可重试');
  handle.unmount();
});

// ---------------------------------------------------------------------------
// 4. 包元数据与 bundle 安装契约
// ---------------------------------------------------------------------------
test('package.json 声明了 bundle patch 与 web client 半边', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, PLUGIN_NAME);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './lib/index.js');
  assert.ok(pkg.exports['./client'], '必须导出 ./client 供客户端加载');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'bundle patch 是自动挂载的关键声明');
  assert.equal(pkg.license, 'MIT');
});

test('cordis.patch.yml 插入行与包名一致（否则装上也不会加载）', () => {
  const text = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  assert.match(text, /- insert:/);
  assert.match(text, /- id: powerbox/);
  assert.match(text, new RegExp("name: '" + PLUGIN_NAME + "'"));
});

test('host 半边是合法 bundle（loader 需要 name/apply）', async () => {
  // Windows 下动态 import 需要文件 URL，不能直接给盘符路径。
  const host = await import(new URL('../lib/index.js', import.meta.url).href);
  assert.equal(host.name, 'powerbox');
  assert.equal(typeof host.apply, 'function');
  assert.doesNotThrow(() => host.apply());
});

/**
 * dsh-powerbox — 项目/会话页右上角「电源」按钮（浏览器半边）。
 *
 * 交互（两段式，破坏性操作必须二次确认）：
 *   1. 点右上角按钮 → 弹窗①「选择操作」：重启 DSH / 关闭 DSH / 取消
 *   2. 选模式 → 弹窗②「再次确认」：确认 / 返回 / 取消
 *   3. 确认后调用桌面桥：
 *        · 重启 DSH → window.dshDesktop.boot.restart()
 *              sidecar 重编 dsh web 服务 → 壳收 boot.web-ready → 自动导航新实例
 *        · 关闭 DSH → window.dshDesktop._call('win.close-force', {})
 *              壳层 app.exit(0) → ExitRequested 优雅退出（shutdown RPC →
 *              sidecar 有界回收 dsh web 进程树），不留孤儿进程
 *
 * 落点：conversation.session.header.utilities（会话/项目页头部右侧 list 插槽，
 * 与官方 open-in-app、schedule 同一插槽）。无桌面桥（普通浏览器打开）时按钮
 * 降级禁用并给出提示，绝不半残运行。
 *
 * 手写 ModuleLoader bundle，无构建步骤（同 dsh-viewport-lock / dsh-plugin-shield）。
 */
window.__ModuleLoader__.load({
  id: "dsh-powerbox",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;

    var NS = "powerbox";

    var CSS = [
      ".__pbx_trigger{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#8b8f96);cursor:pointer;line-height:1;transition:background .12s ease,color .12s ease,border-color .12s ease}",
      ".__pbx_trigger:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.14));color:var(--dsw-alias-label-primary,#e8e8e8);border-color:var(--dsw-alias-border-l2,rgba(128,128,128,.3))}",
      ".__pbx_trigger:disabled{opacity:.45;cursor:default}",
      ".__pbx_trigger svg{width:16px;height:16px;display:block}",
      ".__pbx_backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.42);padding:24px}",
      ".__pbx_card{width:100%;max-width:400px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:var(--dsw-alias-bg-layer-1,#1f2125);color:var(--dsw-alias-label-primary,#e8e8e8);box-shadow:0 18px 48px rgba(0,0,0,.45);padding:18px 18px 14px;font-size:13px;line-height:1.55}",
      ".__pbx_title{margin:0 0 6px;font-size:15px;font-weight:600}",
      ".__pbx_body{margin:0;color:var(--dsw-alias-label-secondary,#a8adb5);font-size:12.5px;line-height:1.6;white-space:pre-wrap}",
      ".__pbx_warn{margin:10px 0 0;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-state-error-primary,#e05a5a);color:var(--dsw-alias-state-error-primary,#e05a5a);font-size:12px;line-height:1.55}",
      ".__pbx_err{margin:10px 0 0;color:var(--dsw-alias-state-error-primary,#e05a5a);font-size:12px}",
      ".__pbx_modes{display:flex;flex-direction:column;gap:8px;margin-top:14px}",
      ".__pbx_mode{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:11px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.08));color:inherit;padding:10px 12px;font:inherit;cursor:pointer;transition:border-color .12s ease,background .12s ease}",
      ".__pbx_mode:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#4d7cfe)}",
      ".__pbx_mode:disabled{opacity:.5;cursor:default}",
      ".__pbx_modeIcon{flex:none;width:18px;height:18px;margin-top:1px}",
      ".__pbx_modeText{flex:1;min-width:0}",
      ".__pbx_modeName{font-size:13px;font-weight:600;display:block}",
      ".__pbx_modeHint{margin-top:2px;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b8f96);line-height:1.5;display:block}",
      ".__pbx_footer{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}",
      ".__pbx_btn{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;border-radius:9px;padding:6px 14px;font:inherit;font-size:12.5px;cursor:pointer}",
      ".__pbx_btn:hover:not(:disabled){border-color:var(--dsw-alias-state-business-primary,#4d7cfe)}",
      ".__pbx_btn:disabled{opacity:.5;cursor:default}",
      ".__pbx_btnDanger{border-color:var(--dsw-alias-state-error-primary,#e05a5a);background:var(--dsw-alias-state-error-primary,#e05a5a);color:#fff}",
      ".__pbx_btnPrimary{border-color:var(--dsw-alias-state-business-primary,#4d7cfe);background:var(--dsw-alias-state-business-primary,#4d7cfe);color:#fff}",
      "@media (prefers-reduced-motion:reduce){.__pbx_trigger,.__pbx_mode{transition:none}}"
    ].join("\n");

    var CSS_TAG = "dsh-powerbox/main.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") === null) {
      var tag = document.createElement("style");
      tag.dataset.plugin = "dsh-powerbox";
      tag.dataset.pluginCss = CSS_TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    var zh = {
      trigger: "电源操作",
      triggerDisabled: "电源操作仅桌面端可用",
      modeTitle: "选择操作",
      modeBody: "请选择要对 DSH 执行的操作。两项操作都会中断当前正在进行的任务。",
      modeRestart: "重启 DSH",
      modeRestartHint: "重新拉起 dsh 服务（页面会自动重新连接），会话与配置保留。",
      modeShutdown: "关闭 DSH",
      modeShutdownHint: "退出桌面端并回收 dsh 服务进程。",
      cancel: "取消",
      back: "返回",
      restartTitle: "再次确认：重启 DSH",
      restartBody: "即将重启 dsh 服务。正在运行的对话/工具调用会被中断，页面将短暂失联后自动恢复。",
      restartWarn: "若当前有任务正在执行，请先等它结束或手动停止。",
      restartConfirm: "确认重启",
      shutdownTitle: "再次确认：关闭 DSH",
      shutdownBody: "即将退出 Deepseek Harness EAC。正在运行的对话/工具调用会被中断，未保存的输入可能丢失。",
      shutdownWarn: "退出后需要重新启动应用；后台不会保留本窗口。",
      shutdownConfirm: "确认关闭",
      restarting: "正在重启 dsh 服务…",
      closing: "正在退出…",
      restartFailed: "重启失败：",
      closeFailed: "关闭失败：",
      noBridge: "未检测到桌面桥（请在桌面端打开本页面）"
    };

    var en = {
      trigger: "Power actions",
      triggerDisabled: "Power actions are available in the desktop app only",
      modeTitle: "Choose an action",
      modeBody: "Pick what to do with DSH. Both actions interrupt any task that is currently running.",
      modeRestart: "Restart DSH",
      modeRestartHint: "Restarts the dsh service (the page reconnects automatically). Sessions and settings are preserved.",
      modeShutdown: "Quit DSH",
      modeShutdownHint: "Exits the desktop app and reaps the dsh service process.",
      cancel: "Cancel",
      back: "Back",
      restartTitle: "Confirm: restart DSH",
      restartBody: "The dsh service will restart. Running conversations and tool calls are interrupted; the page reconnects shortly.",
      restartWarn: "If a task is running, wait for it to finish or stop it first.",
      restartConfirm: "Restart now",
      shutdownTitle: "Confirm: quit DSH",
      shutdownBody: "Deepseek Harness EAC will exit. Running conversations and tool calls are interrupted; unsent input may be lost.",
      shutdownWarn: "You will need to start the app again; the window will not stay in the background.",
      shutdownConfirm: "Quit now",
      restarting: "Restarting the dsh service…",
      closing: "Quitting…",
      restartFailed: "Restart failed: ",
      closeFailed: "Quit failed: ",
      noBridge: "Desktop bridge not detected (open this page inside the desktop app)"
    };

    // ---------------------------------------------------------------------
    // 桌面桥（唯一外部依赖）。所有调用都做「存在性检查 + 明确失败」：
    // 桥缺失 / 旧壳裁剪时给出可读错误，不留半截 Promise。
    // ---------------------------------------------------------------------
    function desktopBridge() {
      if (typeof window === "undefined") return null;
      var d = window.dshDesktop;
      return d && typeof d === "object" ? d : null;
    }

    function hasBridge() {
      var d = desktopBridge();
      if (!d) return false;
      var canRestart = !!(d.boot && typeof d.boot.restart === "function") || typeof d._call === "function";
      var canQuit = typeof d._call === "function" || !!(d.windowControls && typeof d.windowControls.close === "function");
      return canRestart && canQuit;
    }

    function restartDsh() {
      var d = desktopBridge();
      if (!d) return Promise.reject(new Error("no-bridge"));
      if (d.boot && typeof d.boot.restart === "function") return Promise.resolve(d.boot.restart());
      if (typeof d._call === "function") return Promise.resolve(d._call("boot.restart", {}));
      return Promise.reject(new Error("no-bridge"));
    }

    // 关闭：优先 win.close-force（壳层 app.exit(0) → ExitRequested 优雅退出链，
    // 真正退出）；旧壳无 _call 时回退 windowControls.close（尊重用户 exitAction）。
    function shutdownDsh() {
      var d = desktopBridge();
      if (!d) return Promise.reject(new Error("no-bridge"));
      if (typeof d._call === "function") return Promise.resolve(d._call("win.close-force", {}));
      if (d.windowControls && typeof d.windowControls.close === "function") return Promise.resolve(d.windowControls.close());
      return Promise.reject(new Error("no-bridge"));
    }

    // ---------------------------------------------------------------------
    // 图标（内联 SVG，跟随 currentColor）
    // ---------------------------------------------------------------------
    function PowerIcon() {
      return h("svg", { viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true" },
        h("path", { d: "M8 1.9v5.4", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }),
        h("path", { d: "M4.6 4.2a4.6 4.6 0 1 0 6.8 0", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round" }));
    }

    function RestartIcon() {
      return h("svg", { viewBox: "0 0 16 16", fill: "none", className: "__pbx_modeIcon", "aria-hidden": "true" },
        h("path", { d: "M13 8a5 5 0 1 1-1.6-3.7", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
        h("path", { d: "M13.2 2.2v3.1h-3.1", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }));
    }

    function QuitIcon() {
      return h("svg", { viewBox: "0 0 16 16", fill: "none", className: "__pbx_modeIcon", "aria-hidden": "true" },
        h("path", { d: "M6 2.6H3.6a1 1 0 0 0-1 1v8.8a1 1 0 0 0 1 1H6", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round" }),
        h("path", { d: "M10.2 5.2 13 8l-2.8 2.8M13 8H6.2", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", strokeLinejoin: "round" }));
    }

    // ---------------------------------------------------------------------
    // 主组件
    // ---------------------------------------------------------------------
    function PowerActions(props) {
      var t = props.t;
      var bridgeReady = hasBridge();

      // phase: idle | mode | confirm-restart | confirm-shutdown |
      //        busy-restart | busy-shutdown | error-restart | error-shutdown
      var phaseState = react.useState("idle");
      var phase = phaseState[0];
      var setPhase = phaseState[1];
      var errState = react.useState("");
      var errorText = errState[0];
      var setErrorText = errState[1];

      var cardRef = react.useRef(null);
      var triggerRef = react.useRef(null);
      var restoreFocusRef = react.useRef(null);
      // 重入闸：确认按钮虽已禁用，但程序化派发/极端时序仍可能二次进入，
      // 这里用同步 ref 兜底，保证每个操作最多发一次桥调用。
      var inFlightRef = react.useRef(false);
      var busy = phase === "busy-restart" || phase === "busy-shutdown";
      var open = phase !== "idle";

      var close = react.useCallback(function () {
        setPhase("idle");
        setErrorText("");
      }, []);

      // 打开时记住来源焦点，关闭后归还（键盘用户不丢位置）。
      var openWith = react.useCallback(function (next) {
        if (!restoreFocusRef.current && typeof document !== "undefined") {
          restoreFocusRef.current = document.activeElement;
        }
        setErrorText("");
        setPhase(next);
      }, []);

      // 关闭后归还焦点：优先回到触发按钮本身（弹层可能因重渲染重建 DOM，
      // 记录下来的来源节点未必还连着），再退回到打开前的活动元素。
      react.useEffect(function () {
        if (open) return;
        var candidates = [triggerRef.current, restoreFocusRef.current];
        restoreFocusRef.current = null;
        for (var i = 0; i < candidates.length; i += 1) {
          var node = candidates[i];
          if (node && typeof node.focus === "function" && node.isConnected !== false) {
            try { node.focus(); } catch (e) { /* 已卸载则尝试下一个 */ }
            return;
          }
        }
      }, [open]);

      // Esc / Cmd-Ctrl+W 关闭，Tab 焦点循环：捕获态，先于内核快捷键仲裁。
      react.useEffect(function () {
        if (!open || typeof document === "undefined") return undefined;
        var onKeyDown = function (ev) {
          if (!ev || typeof ev.key !== "string") return;
          if (ev.key === "Escape" || (ev.key === "w" && (ev.metaKey || ev.ctrlKey))) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!busy) close();
            return;
          }
          if (ev.key === "Tab") {
            var card = cardRef.current;
            if (!card) return;
            var nodes = card.querySelectorAll("button:not([disabled]), [tabindex]:not([tabindex='-1'])");
            if (!nodes.length) return;
            var first = nodes[0];
            var last = nodes[nodes.length - 1];
            if (ev.shiftKey && document.activeElement === first) {
              ev.preventDefault();
              last.focus();
            } else if (!ev.shiftKey && document.activeElement === last) {
              ev.preventDefault();
              first.focus();
            }
          }
        };
        document.addEventListener("keydown", onKeyDown, true);
        return function () { document.removeEventListener("keydown", onKeyDown, true); };
      }, [open, busy, close]);

      // 每个阶段把焦点送进弹层首个可操作控件（优先 data-autofocus）。
      react.useEffect(function () {
        if (!open) return;
        var card = cardRef.current;
        if (!card) return;
        var target = card.querySelector("[data-autofocus='true']") || card.querySelector("button");
        if (target && typeof target.focus === "function") {
          try { target.focus(); } catch (e) { /* 忽略 */ }
        }
      }, [open, phase]);

      var runRestart = function () {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setErrorText("");
        setPhase("busy-restart");
        restartDsh().then(function (r) {
          if (r && r.ok === false) {
            inFlightRef.current = false;
            setErrorText(String(r.error || "failed"));
            setPhase("error-restart");
          }
          // ok：sidecar 已重编 web 服务，壳会导航新实例；保持 busy 文案即可。
        }, function (e) {
          inFlightRef.current = false;
          setErrorText(String((e && e.message) || e));
          setPhase("error-restart");
        });
      };

      var runShutdown = function () {
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        setErrorText("");
        setPhase("busy-shutdown");
        shutdownDsh().then(function (r) {
          if (r && r.ok === false) {
            inFlightRef.current = false;
            setErrorText(String(r.error || "failed"));
            setPhase("error-shutdown");
          }
          // ok：进程即将退出，无需收尾。
        }, function (e) {
          inFlightRef.current = false;
          setErrorText(String((e && e.message) || e));
          setPhase("error-shutdown");
        });
      };

      var trigger = h("button", {
        ref: triggerRef,
        type: "button",
        className: "__pbx_trigger",
        "data-control-name": "powerbox.trigger",
        "data-state": busy ? "busy" : "idle",
        title: bridgeReady ? t("trigger") : t("triggerDisabled"),
        "aria-label": bridgeReady ? t("trigger") : t("triggerDisabled"),
        "aria-haspopup": "dialog",
        "aria-expanded": open ? "true" : "false",
        disabled: !bridgeReady,
        onClick: function () { if (bridgeReady && !open) openWith("mode"); }
      }, h(PowerIcon, null));

      if (!open) return trigger;

      var title;
      var body;
      var footer;
      var danger = phase === "confirm-shutdown" || phase === "busy-shutdown" || phase === "error-shutdown";

      if (phase === "mode") {
        title = t("modeTitle");
        body = h("p", { className: "__pbx_body" }, t("modeBody"));
        footer = h("div", { className: "__pbx_footer" },
          h("button", {
            type: "button",
            className: "__pbx_btn",
            "data-control-name": "powerbox.mode-cancel",
            onClick: close
          }, t("cancel")));
      } else if (phase === "confirm-restart" || phase === "busy-restart" || phase === "error-restart") {
        title = t("restartTitle");
        body = h("div", null,
          h("p", { className: "__pbx_body" }, t("restartBody")),
          h("p", { className: "__pbx_warn" }, t("restartWarn")),
          phase === "error-restart" ? h("p", { className: "__pbx_err" }, t("restartFailed") + errorText) : null);
        footer = h("div", { className: "__pbx_footer" },
          h("button", {
            type: "button",
            className: "__pbx_btn",
            "data-control-name": "powerbox.confirm-back",
            disabled: busy,
            onClick: function () { openWith("mode"); }
          }, t("back")),
          h("button", {
            type: "button",
            className: "__pbx_btn __pbx_btnPrimary",
            "data-control-name": "powerbox.confirm-restart",
            "data-autofocus": "true",
            disabled: busy,
            onClick: runRestart
          }, phase === "busy-restart" ? t("restarting") : t("restartConfirm")));
      } else {
        title = t("shutdownTitle");
        body = h("div", null,
          h("p", { className: "__pbx_body" }, t("shutdownBody")),
          h("p", { className: "__pbx_warn" }, t("shutdownWarn")),
          phase === "error-shutdown" ? h("p", { className: "__pbx_err" }, t("closeFailed") + errorText) : null);
        footer = h("div", { className: "__pbx_footer" },
          h("button", {
            type: "button",
            className: "__pbx_btn",
            "data-control-name": "powerbox.confirm-back",
            disabled: busy,
            onClick: function () { openWith("mode"); }
          }, t("back")),
          h("button", {
            type: "button",
            className: "__pbx_btn __pbx_btnDanger",
            "data-control-name": "powerbox.confirm-shutdown",
            "data-autofocus": "true",
            disabled: busy,
            onClick: runShutdown
          }, phase === "busy-shutdown" ? t("closing") : t("shutdownConfirm")));
      }

      var modes = phase === "mode" ? h("div", { className: "__pbx_modes" },
        h("button", {
          type: "button",
          className: "__pbx_mode",
          "data-control-name": "powerbox.mode-restart",
          "data-autofocus": "true",
          onClick: function () { openWith("confirm-restart"); }
        },
          h(RestartIcon, null),
          h("span", { className: "__pbx_modeText" },
            h("span", { className: "__pbx_modeName" }, t("modeRestart")),
            h("span", { className: "__pbx_modeHint" }, t("modeRestartHint")))),
        h("button", {
          type: "button",
          className: "__pbx_mode",
          "data-control-name": "powerbox.mode-shutdown",
          "data-state": "dangerous",
          onClick: function () { openWith("confirm-shutdown"); }
        },
          h(QuitIcon, null),
          h("span", { className: "__pbx_modeText" },
            h("span", { className: "__pbx_modeName" }, t("modeShutdown")),
            h("span", { className: "__pbx_modeHint" }, t("modeShutdownHint"))))) : null;

      var card = h("div", {
        ref: cardRef,
        className: "__pbx_card",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": title,
        "data-control-name": "powerbox.dialog",
        "data-state": danger ? "dangerous" : "idle",
        "data-phase": phase,
        onClick: function (ev) { ev.stopPropagation(); }
      },
        h("p", { className: "__pbx_title" }, title),
        body,
        modes,
        footer);

      return h(react.Fragment, null,
        trigger,
        h("div", {
          className: "__pbx_backdrop",
          "data-control-name": "powerbox.backdrop",
          onClick: function () { if (!busy) close(); }
        }, card));
    }

    // ---------------------------------------------------------------------
    // 插件装配
    // ---------------------------------------------------------------------
    var inject = ["slots", "locale"];

    function apply(ctx) {
      var t = ctx.locale.bind(NS);
      ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "dsh-powerbox: dictionaries");
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register({
          name: "conversation.session.header.utilities",
          id: "powerbox",
          order: 100,
          locale: NS
        }, function (props) {
          return h(PowerActions, { t: t, sessionId: props && props.sessionId });
        });
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.__internals = {
      NS: NS,
      zh: zh,
      en: en,
      CSS: CSS,
      hasBridge: hasBridge,
      desktopBridge: desktopBridge,
      restartDsh: restartDsh,
      shutdownDsh: shutdownDsh,
      PowerActions: PowerActions
    };
    return module.exports;
  }
});

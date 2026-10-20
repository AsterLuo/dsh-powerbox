# dsh-powerbox

A power button for the [DeepSeek Harness](https://github.com/deepseek-ai) Web UI: one click in the conversation header opens a small dialog offering **Restart DSH** or **Quit DSH** — and each of those asks for confirmation again before anything happens.

![screenshot](docs/screenshot.png)

> Screenshot placeholder — drop a PNG at `docs/screenshot.png` and this renders.

---

## Why

Restarting or quitting DSH normally means reaching for the tray icon / title bar and hunting through menus. That is awkward when the window is in the foreground and you are mid-session. This plugin puts both actions where you already are looking: the top-right of the conversation header.

Because both actions are destructive — restarting kills in-flight tool calls, quitting closes the app — the flow is deliberately two-step:

```
[⏻]  →  Choose an action  →  Restart DSH / Quit DSH
                            ↓
                         Confirm  →  act
```

`Cancel`, `Esc` and clicking the backdrop all exit without touching anything.

## Requirements

- DSH with the Web UI (`dsh --profile <name>`), version 0.2 or newer.
- A desktop shell that exposes `window.dshDesktop` for the power actions. In a plain browser the button renders **disabled** with an explanatory tooltip instead of half-working.
  - Restart calls `dshDesktop.boot.restart()`.
  - Quit calls `dshDesktop._call('win.close-force', {})`.

## Install

```bash
dsh plugin --profile <your-profile> add github:AsterLuo/dsh-powerbox
```

The package declares `dsh.bundle.patch`, so the official CLI appends `dsh-powerbox` to `dsh.profile.bundles` on its own. **You do not need to edit `cordis.patch.yml` or `package.json` by hand.** Restart DSH (or reload the Web UI) and the button appears in the conversation header.

Using an older CLI that does not reconcile bundles? Then add the row manually to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: powerbox
      name: 'dsh-powerbox'
```

## Uninstall

```bash
dsh plugin --profile <your-profile> remove dsh-powerbox
```

If you added the patch row by hand, delete it as well. Restart DSH afterwards.

## How it works

| Piece | Role |
| --- | --- |
| `cordis.patch.yml` | Inserts the plugin row into the composed profile (this is what makes it load). |
| `lib/index.js` | Host half. Intentionally a no-op — it only exists so the package is a valid bundle (the loader requires `name` + `apply`). |
| `lib/client.js` | Everything else: the header button, the mode dialog, both confirmation dialogs, and the bridge calls. |

The client half registers one entry in the `conversation.session.header.utilities` slot (a `list` slot, session scope — the same one the official *Open in app* action uses), which is what places the button at the right end of the conversation header.

- No build step. It is a hand-written `window.__ModuleLoader__.load({ id, factory })` bundle, exactly like the built-in plugins.
- No runtime dependencies. `react` is provided by the host through the module loader.
- Styling uses only `--dsw-alias-*` theme tokens, so it follows light and dark themes.

### Safety details

- The confirm button disables itself while the request is in flight, and a synchronous re-entry guard makes a second call impossible even if the click is dispatched programmatically.
- `Esc` closes the dialog — except while an action is running, so you cannot hide a restart you already triggered.
- Focus returns to the power button when the dialog closes.
- Failures are reported in the dialog with a retry path, never swallowed.

## Development

```bash
npm install
npm test        # node --test, jsdom-backed
npm run check   # syntax check both halves
```

The tests drive the real plugin bundle in a jsdom window with a recording `window.dshDesktop` stub. `react` is replaced by a small hook-compatible stub (see `test/harness.mjs`), because the real one is supplied by the host at runtime and is not a dependency of this package. Covered: slot registration contract, the full click-through of both flows, "no bridge call before the second confirmation", exactly-one-call, in-flight disabling, `Esc`, backdrop, focus restore, missing-bridge degradation, error surfacing, and the package/patch metadata that the installer relies on.

## License

MIT © AsterLuo

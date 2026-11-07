window.__ModuleLoader__.load({
	id: "dsh-pierce",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		// ---- styles -------------------------------------------------------
		// 视觉语言照 bingbing 那套 cold-tiger 粗野主义（暗底、粗边框、等宽、扫描线），
		// 换成本项目的标识：准星代替眼球 —— pierce 是"穿透/标定"，不是"注视"。
		const CSS = `
.pr-dock { display: inline-flex; align-items: center; }
.pr-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px;
  border: 2px solid #5a5442; background: #141310; color: #d8d1b8;
  font: 700 10px/1 "Courier New", ui-monospace, monospace; letter-spacing: 1.2px;
  text-transform: uppercase; cursor: pointer; box-shadow: 2px 2px 0 #000;
  transition: transform .09s steps(2), box-shadow .09s steps(2), border-color .12s, color .12s, background .12s;
}
.pr-btn:hover { border-color: rgb(198,181,113); color: #fff; background: #241f16; }
.pr-btn:active { transform: translate(2px,2px); box-shadow: 0 0 0 #000; }
.pr-dot { width: 7px; height: 7px; background: #8fe39b; flex: none; }
.pr-dot.off { background: #ff6b5e; }
.pr-dot.pending { background: #e8b45c; }

.pr-panel {
  position: fixed; right: 16px; bottom: 92px; width: 400px; z-index: 9999;
  background: #1c1a16; color: #e8e2cf;
  border: 6px solid rgb(161,156,116); box-shadow: 6px 8px 0 #000;
  overflow: hidden; isolation: isolate;
  font: 12px/1.6 "Courier New", ui-monospace, Consolas, monospace;
}
.pr-scan {
  position: absolute; inset: 0; z-index: 7; pointer-events: none; opacity: .24;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,.05) 0 1px, transparent 1px 2px);
  animation: pr-static .2s infinite linear alternate;
}
@keyframes pr-static { 0% { opacity: .24 } 100% { opacity: .11 } }
.pr-sweep {
  position: absolute; left: 0; right: 0; height: 4px; z-index: 8; pointer-events: none;
  background: rgba(75,68,68,.5); animation: pr-scanmove 3.2s linear infinite;
}
@keyframes pr-scanmove { 0% { top: 0 } 100% { top: 100% } }
/* 准星：贴右下角出血，只露一角；代表"标定/穿透"，与表格数据不重叠。 */
.pr-reticle { position: absolute; right: -58px; bottom: -46px; width: 180px; height: 180px; z-index: 1; pointer-events: none; opacity: .34; }
.pr-ring {
  position: absolute; inset: 22px; border: 2px solid rgba(143,227,155,.45); border-radius: 50%;
  animation: pr-pulse 3s infinite ease-in-out;
}
.pr-ring::after { content: ""; position: absolute; inset: 12px; border: 1px dashed rgba(143,227,155,.35); border-radius: 50%; }
@keyframes pr-pulse { 0%,100% { transform: scale(1) } 50% { transform: scale(1.06) } }
.pr-cross { position: absolute; left: 50%; top: 0; width: 2px; height: 100%; margin-left: -1px; background: rgba(143,227,155,.30); }
.pr-cross.h { left: 0; top: 50%; width: 100%; height: 2px; margin: -1px 0 0 0; }
.pr-core { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; background: #8fe39b; }
.pr-spin { position: absolute; inset: 0; animation: pr-rot 14s linear infinite; }
@keyframes pr-rot { 0% { transform: rotate(0) } 100% { transform: rotate(360deg) } }

.pr-inner { position: relative; z-index: 5; padding: 12px; max-height: 70vh; overflow: auto; }
.pr-head { display: flex; align-items: center; gap: 8px; margin-bottom: 11px; }
.pr-title {
  position: relative; display: inline-block; font-weight: 700; font-size: 12px;
  letter-spacing: 2.2px; text-transform: uppercase; color: #fff; text-shadow: 2px 2px #000;
}
.pr-title::before, .pr-title::after { content: attr(data-text); position: absolute; left: 0; top: 0; width: 100%; height: 100%; }
.pr-title::before { left: 1.5px; text-shadow: -1px 0 red; animation: pr-g1 2s infinite linear alternate-reverse; }
.pr-title::after { left: -1.5px; text-shadow: -1px 0 #0ff; animation: pr-g2 3s infinite linear alternate-reverse; }
@keyframes pr-g1 { 0% { clip: rect(6px,9999px,10px,0) } 100% { clip: rect(12px,9999px,15px,0) } }
@keyframes pr-g2 { 0% { clip: rect(3px,9999px,7px,0) } 100% { clip: rect(10px,9999px,2px,0) } }
.pr-pill {
  font: 700 9.5px/1 "Courier New", ui-monospace, monospace; letter-spacing: 1.3px; text-transform: uppercase;
  padding: 4px 7px; border: 1px solid #5a5442; color: #a9a288; background: #141310; white-space: nowrap;
}
.pr-pill.ok { color: #8fe39b; border-color: rgba(143,227,155,.5); background: rgba(10,26,14,.8); }
.pr-pill.bad { color: #ff6b5e; border-color: rgba(255,107,94,.45); background: rgba(28,10,9,.8); }
.pr-pill.warn { color: #e8b45c; border-color: rgba(232,180,92,.45); background: rgba(28,20,6,.8); }
.pr-x { margin-left: auto; background: none; border: 0; color: #a9a288; cursor: pointer; font: 700 15px/1 "Courier New", monospace; padding: 2px 5px; }
.pr-x:hover { color: #fff; }

/* 总开关：一行，状态字和动作分开，避免"看的是开关、点的是别处" */
.pr-master {
  display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 9px;
  border: 2px solid #5a5442; background: #17150f; padding: 6px 8px; text-align: left; cursor: pointer;
  font: 11px/1.4 "Courier New", ui-monospace, monospace; color: #d8d1b8;
  box-shadow: 3px 3px 0 #000; transition: transform .09s steps(2), box-shadow .09s steps(2), border-color .12s;
}
.pr-master:hover { border-color: rgb(198,181,113); }
.pr-master:active { transform: translate(3px,3px); box-shadow: 0 0 0 #000; }
.pr-master b { font-size: 11.5px; letter-spacing: 1.2px; text-transform: uppercase; }
.pr-master .pr-v { margin-left: auto; font-size: 9.5px; letter-spacing: 1.1px; text-transform: uppercase; padding: 3px 6px; border: 1px solid currentColor; }
.pr-master.on b { color: #8fe39b; }
.pr-master.on .pr-v { color: #8fe39b; }
.pr-master.off b { color: #ff6b5e; }
.pr-master.off .pr-v { color: #ff6b5e; }

.pr-presets { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-bottom: 11px; }
.pr-preset {
  position: relative; text-align: left; padding: 7px 9px; cursor: pointer;
  border: 2px solid #5a5442; background: #141310; color: #d8d1b8;
  font: 11px/1.35 "Courier New", ui-monospace, monospace; box-shadow: 3px 3px 0 #000;
  transition: transform .09s steps(2), box-shadow .09s steps(2), border-color .12s, background .12s, color .12s;
}
.pr-preset:hover { border-color: rgb(198,181,113); color: #fff; background: #241f16; }
.pr-preset:active { transform: translate(3px,3px); box-shadow: 0 0 0 #000; }
.pr-preset.sel { border-color: rgb(198,181,113); background: rgb(198,181,113); color: #14130f; }
.pr-preset b { display: block; font-size: 11.5px; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 2px; }
.pr-preset span { color: #6b6656; font-size: 10px; letter-spacing: .3px; }
.pr-preset.sel span { color: #3a3528; }

/* 自由开关 */
.pr-switches { margin-bottom: 11px; border: 2px solid #43402f; background: #17150f; padding: 7px 8px 8px; }
.pr-switches-head { display: flex; align-items: center; gap: 7px; margin-bottom: 6px; }
.pr-switches-head b { font-size: 10.5px; letter-spacing: 1.1px; text-transform: uppercase; color: #d8d1b8; }
.pr-switches-head span { margin-left: auto; font-size: 9px; color: #6b6656; letter-spacing: .4px; }
.pr-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
.pr-tgl {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 6px; cursor: pointer;
  border: 2px solid #5a5442; background: #141310; color: #8f8873;
  font: 10.5px/1.2 "Courier New", ui-monospace, monospace; text-align: left;
  transition: color .12s, border-color .12s, background .12s;
}
.pr-tgl:hover { border-color: rgb(198,181,113); color: #d8d1b8; }
.pr-tgl.on { color: #e8e2cf; border-color: rgba(143,227,155,.55); background: rgba(10,26,14,.55); }
.pr-tglbox { width: 10px; height: 10px; flex: none; border: 1px solid currentColor; display: inline-flex; align-items: center; justify-content: center; font-size: 8px; line-height: 1; }
.pr-tgl.on .pr-tglbox { background: #8fe39b; color: #141310; border-color: #8fe39b; }
.pr-seg { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 10px; color: #6b6656; }
.pr-seg > span { letter-spacing: .6px; }
.pr-segbtns { margin-left: auto; display: inline-flex; gap: 4px; }
.pr-segbtn {
  padding: 3px 7px; cursor: pointer; border: 1px solid #5a5442; background: #141310; color: #8f8873;
  font: 10px/1.2 "Courier New", ui-monospace, monospace;
}
.pr-segbtn:hover { color: #d8d1b8; border-color: rgb(198,181,113); }
.pr-segbtn.on { background: rgb(198,181,113); color: #14130f; border-color: rgb(198,181,113); }

/* 版本区：与预设同一条视觉语言，但更矮，避免把证据表挤出屏幕 */
.pr-vers { margin: 2px 0 11px; border: 2px solid #43402f; background: #17150f; padding: 7px 8px 8px; }
.pr-vers-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pr-vers-head b { font-size: 10.5px; letter-spacing: 1.1px; text-transform: uppercase; color: #d8d1b8; }
.pr-vers-row { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 10px; color: #8f8873; }
.pr-vers-row .pr-mono { margin-left: auto; }
.pr-cmd {
  display: block; margin-top: 6px; padding: 6px 7px; font: 9.5px/1.5 "Courier New", ui-monospace, monospace;
  color: #b9b294; background: #0f0e0b; border: 1px dashed #43402f; word-break: break-all; user-select: all;
}

.pr-table { width: 100%; border-collapse: collapse; margin-top: 4px; table-layout: fixed; }
.pr-table th {
  text-align: left; font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase; color: #6b6656;
  padding: 4px 3px; border-bottom: 2px solid #5a5442;
}
.pr-table td { padding: 5px 3px; border-bottom: 1px dashed rgba(115,112,92,.45); font-size: 10.5px; vertical-align: top; color: #ddd6c0; }
.pr-table th:nth-child(1), .pr-table td:nth-child(1) { width: 74px; }
.pr-table th:nth-child(4), .pr-table td:nth-child(4) { width: 18px; text-align: right; }
.pr-mono { font-family: "Courier New", ui-monospace, monospace; font-size: 10px; color: #b9b294; }
.pr-ok { color: #8fe39b; font-weight: 700; }
.pr-bad { color: #ff6b5e; font-weight: 700; }
.pr-warn { color: #e8b45c; font-weight: 700; }
.pr-note { margin-top: 9px; padding: 8px 9px; font-size: 10px; line-height: 1.6; letter-spacing: .2px; }
.pr-note.warn { border: 1px dashed rgba(232,180,92,.5); background: rgba(28,20,6,.75); color: #e8b45c; }
.pr-note.bad { border: 1px dashed rgba(255,107,94,.45); background: rgba(28,10,9,.75); color: #ffb4ae; }
.pr-note.ok { border: 1px dashed rgba(143,227,155,.45); background: rgba(10,26,14,.75); color: #8fe39b; }
.pr-note.plain { border: 1px dashed #43402f; background: #17150f; color: #8f8873; }
.pr-warns { margin-top: 8px; }
.pr-warns div { font-size: 9.5px; line-height: 1.6; color: #e8b45c; }
.pr-warns div::before { content: "! "; font-weight: 700; }
.pr-audit { display: flex; align-items: center; gap: 7px; margin-top: 9px; }
.pr-audit .pr-mono { margin-left: auto; }
.pr-leak { margin-top: 6px; padding: 6px 7px; font-size: 9.5px; line-height: 1.5; color: #ffb4ae; border: 1px dashed rgba(255,107,94,.4); background: rgba(28,10,9,.6); word-break: break-all; }
.pr-foot { margin-top: 9px; display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }
.pr-ghost {
  background: #141310; color: #a9a288; border: 2px solid #5a5442; padding: 4px 9px; cursor: pointer;
  font: 700 9.5px/1 "Courier New", ui-monospace, monospace; letter-spacing: 1.2px; text-transform: uppercase;
  box-shadow: 2px 2px 0 #000; transition: transform .09s steps(2), box-shadow .09s steps(2), border-color .12s, color .12s;
}
.pr-ghost:hover { border-color: rgb(198,181,113); color: #fff; }
.pr-ghost:active { transform: translate(2px,2px); box-shadow: 0 0 0 #000; }
.pr-ghost.acc { border-color: rgb(198,181,113); color: #14130f; background: rgb(198,181,113); }
.pr-ghost.acc:hover { color: #14130f; background: #d8c98a; }
.pr-ghost:disabled, .pr-preset:disabled, .pr-tgl:disabled, .pr-master:disabled { opacity: .45; cursor: default; }
.pr-dim { color: #6b6656; font-size: 9px; letter-spacing: .2px; word-break: break-all; }
.pr-legal { margin-top: 8px; font-size: 9px; line-height: 1.6; color: #5f5a4b; letter-spacing: .3px; }

@media (prefers-reduced-motion: reduce) {
  .pr-scan, .pr-sweep, .pr-title::before, .pr-title::after, .pr-ring, .pr-spin { animation: none !important; }
  .pr-btn, .pr-preset, .pr-ghost, .pr-master { transition: none !important; }
}
`;

		let styleInstalled = false;
		const ensureStyle = () => {
			if (styleInstalled || typeof document === "undefined") return;
			styleInstalled = true;
			const el = document.createElement("style");
			el.setAttribute("data-pierce", "");
			el.textContent = CSS;
			document.head.appendChild(el);
		};

		// ---- api ----------------------------------------------------------
		// 主路径是同源：宿主 webServer 把 /pierce/api 注册进 GUI 所在 origin，
		// 相对路径调用没有跨域。跨端口只作兜底（webServer 注册失败时）。
		const SAME_ORIGIN = "/pierce/api";
		const PORT_BASE = 7314;
		const PORT_TRIES = 8;
		let apiBase = null;

		const probeOnce = async (base) => {
			try {
				const response = await fetch(`${base}/ping`, { cache: "no-store" });
				if (!response.ok) return null;
				const body = await response.json();
				return body && body.service === "pierce-panel" ? base : null;
			} catch {
				return null;
			}
		};

		const resolveBase = async () => {
			if (apiBase) return apiBase;
			const same = await probeOnce(SAME_ORIGIN);
			if (same) {
				apiBase = same;
				return apiBase;
			}
			for (let index = 0; index < PORT_TRIES; index += 1) {
				const hit = await probeOnce(`http://127.0.0.1:${PORT_BASE + index}`);
				if (hit) {
					apiBase = hit;
					return apiBase;
				}
			}
			throw new Error(
				"面板服务没响应：宿主没注册 /pierce/api，自带端口 7314-7321 也没探测到（看 $DSH_HOME/state/pierce/status.json 的 panel 字段）",
			);
		};

		const call = async (path, init) => {
			const once = async () => fetch(`${await resolveBase()}${path}`, init);
			let response;
			try {
				response = await once();
			} catch {
				apiBase = null; // 端口变了：重探一次
				response = await once();
			}
			const text = await response.text();
			let body;
			try {
				body = JSON.parse(text);
			} catch {
				body = { error: text.slice(0, 200) };
			}
			if (!response.ok) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`);
			return body;
		};

		const post = (path, payload) =>
			call(path, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload || {}),
			});

		const h = react.createElement;

		const MARK = { true: "✓", false: "✗", null: "·" };
		const markClass = (ok) => (ok === true ? "pr-ok" : ok === false ? "pr-bad" : "pr-warn");
		const short = (value, len = 26) => {
			const text = String(value ?? "");
			return text.length > len ? `${text.slice(0, len)}…` : text;
		};

		function PierceBar() {
			const [open, setOpen] = react.useState(false);
			const [state, setState] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState(null);

			const load = react.useCallback(async () => {
				try {
					setState(await call("/state"));
					setError(null);
				} catch (cause) {
					setError(String(cause && cause.message ? cause.message : cause));
				}
			}, []);

			react.useEffect(() => {
				ensureStyle();
				load();
			}, [load]);

			react.useEffect(() => {
				if (!open) return undefined;
				load();
				const timer = setInterval(load, 5000);
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => {
					clearInterval(timer);
					window.removeEventListener("keydown", onKey);
				};
			}, [open, load]);

			/** 统一动作壳：置忙 → 调接口 → 用返回的 state 刷新 → 收尾。 */
			const act = async (fn, fallbackMessage) => {
				if (busy) return;
				setBusy(true);
				try {
					const result = await fn();
					if (result && result.state) setState(result.state);
					else await load();
					if (fallbackMessage) setNotice(typeof fallbackMessage === "function" ? fallbackMessage(result) : fallbackMessage);
					setError(null);
				} catch (cause) {
					setError(String(cause && cause.message ? cause.message : cause));
				} finally {
					setBusy(false);
				}
			};

			const send = (patch) =>
				act(
					() => post("/prefs", patch),
					(result) => (result && result.applied && result.applied.noop ? "已经是这个状态，没有变化" : null),
				);
			const reset = () => act(() => post("/reset", {}), (result) => (result && result.applied && result.applied.noop ? "当前就是默认配置" : "已复位到默认"));
			const runAudit = () => act(() => post("/audit", { all: false }), (result) => (result && result.audit ? (result.audit.error ? `审计失败：${result.audit.error}` : `审计完成：${result.audit.findingsTotal} 漏`) : null));
			const checkUpdate = () =>
				act(() => post("/update/check", {}), (result) => {
					const update = result && result.update;
					if (!update) return "检查完成";
					if (update.ok === false) return `检查失败：${update.error || "未知原因"}`;
					if (!update.latest) return "仓库里还没有正式 release";
					if (update.behind) return `仓库最新 v${update.latest}，比本地 v${update.local} 旧`;
					return update.updateAvailable ? `有新版 v${update.latest}（本地 v${update.local}）` : `已是最新（v${update.latest}）`;
				});
			const doUpdate = () =>
				act(() => post("/update/apply", {}), (result) => {
					const body = result && result.result;
					if (!body) return "更新请求已发出";
					if (body.ok) return "已更新：重启宿主后生效";
					return body.mode === "manual" ? "开发挂载无法 pull：按面板里的命令手动更新" : `更新失败：${body.error || "未知原因"}`;
				});
			const makeRestart = () => act(() => post("/restart", {}), (result) => (result && result.restart && result.restart.path ? `已生成重启脚本：${result.restart.path}` : "生成重启脚本失败"));

			const prefs = state && state.prefs ? state.prefs : null;
			const eff = prefs ? prefs.effective : null;
			const evidence = state && state.evidence ? state.evidence : null;
			const badge = evidence ? evidence.badge : { text: "读取中", tone: "" };
			const rows = (state && state.rows) || [];
			const presets = (prefs && prefs.presets) || [];
			const warnings = (state && state.warnings) || [];
			const version = state && state.version ? state.version : null;
			const audit = state && state.audit ? state.audit : null;
			const ledger = state && state.ledger ? state.ledger : null;
			const runtime = state && state.runtime ? state.runtime : null;

			const dotClass = !eff || !eff.enabled ? "pr-dot off" : evidence && !evidence.matched ? "pr-dot pending" : "pr-dot";
			const dockLabel = evidence && evidence.dock ? evidence.dock : "破甲";
			const tone = evidence && evidence.badge ? evidence.badge.tone : "";

			const toggle = (key, group, value, label, title) =>
				h(
					"button",
					{
						key,
						type: "button",
						disabled: busy,
						className: `pr-tgl${value ? " on" : ""}`,
						title: title || label,
						onClick: () => send(group ? { [group]: { [key]: !value } } : { [key]: !value }),
					},
					h("i", { className: "pr-tglbox" }, value ? "■" : ""),
					label,
				);

			const seg = (label, options, value, onPick) =>
				h(
					"div",
					{ className: "pr-seg" },
					h("span", null, label),
					h(
						"div",
						{ className: "pr-segbtns" },
						options.map((option) =>
							h(
								"button",
								{
									key: option.value,
									type: "button",
									disabled: busy,
									className: `pr-segbtn${option.value === value ? " on" : ""}`,
									title: option.title || option.label,
									onClick: () => onPick(option.value),
								},
								option.label,
							),
						),
					),
				);

			return h(
				"span",
				{ className: "pr-dock" },
				h(
					"button",
					{ type: "button", className: "pr-btn", title: "pierce 穿透台：版本 / 开关 / 证据 / 审计", onClick: () => setOpen(!open) },
					h("span", { className: dotClass }),
					dockLabel,
				),
				open
					? h(
							"div",
							{ className: "pr-panel", role: "dialog", "aria-label": "pierce 穿透台" },
							h(
								"span",
								{ className: "pr-reticle", "aria-hidden": "true" },
								h("i", { className: "pr-spin" }, h("i", { className: "pr-ring" })),
								h("i", { className: "pr-cross" }),
								h("i", { className: "pr-cross h" }),
								h("i", { className: "pr-core" }),
							),
							h("span", { className: "pr-sweep", "aria-hidden": "true" }),
							h("span", { className: "pr-scan", "aria-hidden": "true" }),
							h(
								"div",
								{ className: "pr-inner" },
								h(
									"div",
									{ className: "pr-head" },
									h("span", { className: "pr-title", "data-text": "pierce 穿透台" }, "pierce 穿透台"),
									h("span", { className: `pr-pill ${tone}` }, badge.text),
									h("button", { type: "button", className: "pr-x", onClick: () => setOpen(false), title: "关闭 (Esc)" }, "×"),
								),
								error ? h("div", { className: "pr-note bad" }, error) : null,
								eff
									? h(
											"button",
											{
												type: "button",
												disabled: busy,
												className: `pr-master${eff.enabled ? " on" : " off"}`,
												title: eff.enabled ? "点一下停用（三段清空、两层改写放行）" : "点一下启用",
												onClick: () => send({ enabled: !eff.enabled }),
											},
											h("b", null, eff.enabled ? "破甲已启用" : "破甲已停用"),
											h("span", { className: "pr-v" }, eff.enabled ? "点此停用" : "点此启用"),
										)
									: null,
								h(
									"div",
									{ className: "pr-presets" },
									presets.map((preset) =>
										h(
											"button",
											{
												key: preset.id,
												type: "button",
												disabled: busy,
												className: `pr-preset${preset.active ? " sel" : ""}`,
												onClick: () => send({ preset: preset.id }),
											},
											h("b", null, preset.label),
											h("span", null, preset.hint),
										),
									),
								),
								eff
									? h(
											"div",
											{ className: "pr-switches" },
											h(
												"div",
												{ className: "pr-switches-head" },
												h("b", null, "自由开关"),
												h("span", null, "下一轮组装生效"),
											),
											h(
												"div",
												{ className: "pr-grid" },
												toggle("core", "sections", eff.sections.core, "正文", "core.md：框架正文（授权 / 交付形状 / 边界词 / 创作）"),
												toggle("post", "sections", eff.sections.post, "尾段", "post.md：最后 7 条收口"),
												toggle("assemble", "layers", eff.layers.assemble, "装配层", "system-prompt/assemble waterfall：系统提示词里那份"),
												toggle("refresh", "layers", eff.layers.refresh, "消息层", "包装 refreshContext：用户消息里那份 runtime-context"),
												toggle("ledger", null, eff.ledger, "账本", "关闭后审计无法对账，会把权限句判成漏点"),
											),
											seg(
												"处置",
												[
													{ value: "rewrite", label: "改写", title: "替换为中性文案，保留段名与结构" },
													{ value: "drop", label: "删除", title: "整段删掉（会留下结构性缺口）" },
												],
												eff.policy.mode,
												(value) => send({ policy: { mode: value } }),
											),
											seg(
												"判据",
												[
													{ value: "aggressive", label: "激进", title: "段名像或文本像就处理" },
													{ value: "structural", label: "结构", title: "只认三特征同现（第二人称 + 情态 + 权限语义）" },
												],
												eff.policy.criteria,
												(value) => send({ policy: { criteria: value } }),
											),
										)
									: null,
								version
									? h(
											"div",
											{ className: "pr-vers" },
											h(
												"div",
												{ className: "pr-vers-head" },
												h("b", null, `版本 ${version.local}`),
												h("span", { className: "pr-mono" }, version.install && version.install.kind === "git" ? "clone" : "开发挂载"),
												h("button", { type: "button", className: "pr-ghost", onClick: checkUpdate, disabled: busy }, "检查更新"),
												version.updateAvailable
													? h("button", { type: "button", className: "pr-ghost acc", onClick: doUpdate, disabled: busy }, `更新到 ${version.latest}`)
													: null,
												h("button", { type: "button", className: "pr-ghost", onClick: makeRestart, disabled: busy, title: "生成 restart.cmd：双击即重启宿主" }, "重启"),
											),
											h(
												"div",
												{ className: "pr-vers-row" },
												h("span", { className: "pr-mono" }, `仓库 ${version.repo.replace("https://github.com/", "")}`),
												version.latest
													? h(
															"span",
															{ className: version.updateAvailable ? "pr-ok" : "" },
															version.behind ? `最新 v${version.latest}（比本地旧）` : `最新 v${version.latest}`,
														)
													: h("span", null, version.checkedAt ? "仓库无正式 release" : "未检查"),
												h("span", { className: "pr-mono" }, version.checkedAt ? new Date(version.checkedAt).toLocaleTimeString() : ""),
											),
											version.error ? h("div", { className: "pr-note bad" }, `检查失败：${version.error}`) : null,
											version.install && !version.install.pullable
												? h("code", { className: "pr-cmd" }, version.install.command)
												: null,
											notice ? h("div", { className: "pr-note plain" }, notice) : null,
										)
									: null,
								h(
									"table",
									{ className: "pr-table" },
									h("thead", null, h("tr", null, h("th", null, "检查项"), h("th", null, "期望"), h("th", null, "实际"), h("th", null, ""))),
									h(
										"tbody",
										null,
										rows.map((row) =>
											h(
												"tr",
												{ key: row.part },
												h("td", null, row.label),
												h("td", { className: "pr-mono" }, short(row.expectedText)),
												h("td", { className: "pr-mono" }, short(row.actualText)),
												h("td", { className: markClass(row.ok) }, MARK[String(row.ok)]),
											),
										),
									),
								),
								evidence
									? h(
											"div",
											{ className: `pr-note ${evidence.matched ? "ok" : evidence.pending ? "warn" : "bad"}` },
											evidence.summary,
											runtime ? ` ｜ 本次启动组装 ${runtime.counters.assemble} 次 / 改写 ${runtime.counters.rewrites} 条` : "",
										)
									: null,
								warnings.length
									? h(
											"div",
											{ className: "pr-warns" },
											warnings.map((text, index) => h("div", { key: index }, text)),
										)
									: null,
								h(
									"div",
									{ className: "pr-audit" },
									h("button", { type: "button", className: "pr-ghost", onClick: runAudit, disabled: busy }, "运行审计"),
									h(
										"span",
										{ className: "pr-mono" },
										audit && !audit.error
											? `上次 ${new Date(audit.at).toLocaleTimeString()} · ${audit.findingsTotal} 漏 · 检查 ${audit.checked} 段${audit.refusals && audit.refusals.total ? ` · 拒答 ${audit.refusals.total}` : ""}`
											: audit && audit.error
												? "上次失败"
												: "未运行",
									),
								),
								audit && audit.findings && audit.findings.length
									? audit.findings
											.slice(0, 3)
											.map((finding, index) =>
												h("div", { key: index, className: "pr-leak" }, `[${finding.type} seq=${finding.seq}] ${short(finding.fragment, 120)}`),
											)
									: null,
								audit && audit.refusals && audit.refusals.items && audit.refusals.items.length
									? audit.refusals.items
											.slice(0, 2)
											.map((item, index) =>
												h("div", { key: `r${index}`, className: "pr-leak" }, `[拒答·${item.kind} seq=${item.seq}] ${short(item.excerpt, 120)}`),
											)
									: null,
								h(
									"div",
									{ className: "pr-foot" },
									h("button", { type: "button", className: "pr-ghost", onClick: load, disabled: busy }, "刷新"),
									h("button", { type: "button", className: "pr-ghost", onClick: reset, disabled: busy }, "复位"),
									ledger && ledger.last && ledger.last.length
										? h("span", { className: "pr-mono", title: ledger.path }, `账本 ${ledger.rows} 条 · 本轮 ${ledger.bootRows}`)
										: h("span", { className: "pr-mono" }, "账本为空"),
								),
								h(
									"div",
									{ className: "pr-legal" },
									"学习与研究用途 · 禁止商用 · 禁止违法用途 · 后果自负",
								),
							),
						)
					: null,
			);
		}

		// ---- registration -------------------------------------------------
		const inject = ["slots"];

		function apply(ctx) {
			ctx.effect(() => {
				ensureStyle();
			}, "pierce: style");
			ctx.slots.inject("conversation.input.activity", () =>
				ctx.slots.register(
					{
						name: "conversation.input.activity",
						key: "pierce",
						order: 50,
					},
					PierceBar,
				),
			);
		}

		exports.PierceBar = PierceBar;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});

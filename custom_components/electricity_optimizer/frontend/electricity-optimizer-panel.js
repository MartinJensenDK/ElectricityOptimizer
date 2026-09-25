/*
 * Electricity Optimizer - Home Assistant sidebar panel.
 * Plain web component (no build step). Reads the EnergiDataService price
 * sensor straight from `hass.states` and renders an overview plus tabs for
 * EV charging and house battery settings.
 */

const PANEL_JS_VERSION = "0.11.1";

// 24-hour time text field (native <input type=time> follows the browser locale and may show AM/PM).
const timeInput = (attrs, value) =>
  `<input type="text" inputmode="numeric" maxlength="5" placeholder="TT:MM" pattern="^([01]?\\d|2[0-3]):[0-5]\\d$" data-time ${attrs} value="${esc(value || "")}">`;

const normalizeTime = (raw) => {
  const digits = String(raw || "").replace(/[^\d]/g, "");
  if (!digits) return null;
  let h, m;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else {
    h = parseInt(digits.slice(0, digits.length - 2), 10);
    m = parseInt(digits.slice(-2), 10);
  }
  if (Number.isNaN(h) || Number.isNaN(m) || h > 23 || m > 59) return null;
  return `${pad2(h)}:${pad2(m)}`;
}; // kept equal to manifest.json (checked by tests), not shown in the UI

const DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"];
const DAY_SHORT = ["man", "tirs", "ons", "tors", "fre", "lør", "søn"];

const TABS = [
  { id: "home", label: "Forsiden", icon: "mdi:view-dashboard" },
  { id: "solar", label: "Solceller", icon: "mdi:solar-power-variant" },
  { id: "ev", label: "Elbiler", icon: "mdi:car-electric" },
  { id: "battery", label: "Hus batteri", icon: "mdi:home-battery" },
];

const STYLE = `
  :host {
    display: block;
    height: 100%;
    overflow: auto;
    background: var(--primary-background-color);
    color: var(--primary-text-color);
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
    -webkit-font-smoothing: antialiased;
  }
  .toolbar {
    display: flex;
    align-items: center;
    height: 56px;
    padding: 0 16px;
    background: var(--app-header-background-color, var(--primary-color));
    color: var(--app-header-text-color, #fff);
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .toolbar ha-menu-button { margin-right: 8px; }
  .toolbar .title { font-size: 20px; font-weight: 400; flex: 1; }
  .toolbar .version { font-size: 12px; opacity: 0.7; }

  .tabs {
    display: flex;
    background: var(--app-header-background-color, var(--primary-color));
    color: var(--app-header-text-color, #fff);
    position: sticky;
    top: 56px;
    z-index: 2;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
  }
  .tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 12px 8px;
    cursor: pointer;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    opacity: 0.75;
    border-bottom: 3px solid transparent;
    transition: opacity 120ms, border-color 120ms;
  }
  .tab:hover { opacity: 1; }
  .tab[aria-selected="true"] { opacity: 1; border-bottom-color: currentColor; }
  .tab ha-icon { --mdc-icon-size: 20px; }
  .content { padding: 16px; max-width: 1200px; margin: 0 auto; box-sizing: border-box; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-bottom: 12px;
  }
  .card {
    background: var(--card-background-color, var(--ha-card-background, #fff));
    border-radius: var(--ha-card-border-radius, 12px);
    box-shadow: var(--ha-card-box-shadow, none);
    border: var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
    padding: 16px;
    box-sizing: border-box;
    margin-bottom: 12px;
  }
  .grid .card { margin-bottom: 0; }
  .card h2 {
    margin: 0 0 12px;
    font-size: 16px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card h2 ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); }
  .kpi { display: flex; flex-direction: column; gap: 4px; }
  .kpi .label { font-size: 13px; color: var(--secondary-text-color); display: flex; align-items: center; gap: 6px; }
  .kpi .label ha-icon { --mdc-icon-size: 18px; }
  .kpi .value { font-size: 28px; font-weight: 500; line-height: 1.1; }
  .kpi .value small { font-size: 13px; font-weight: 400; color: var(--secondary-text-color); margin-left: 4px; }
  .kpi .sub { font-size: 13px; color: var(--secondary-text-color); }
  .kpi.live .value { font-size: 26px; }
  .kpi.live .value.in { color: var(--error-color, #db4437); }
  .kpi.live .value.out { color: var(--success-color, #43a047); }
  .kpi.live .value.sun { color: var(--warning-color, #ffa600); }
  .badge {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
    color: #fff;
  }
  .badge.low { background: var(--success-color, #43a047); }
  .badge.mid { background: var(--warning-color, #ffa600); }
  .badge.high { background: var(--error-color, #db4437); }
  .badge.neutral { background: var(--secondary-text-color, #727272); }
  .chart-wrap { width: 100%; overflow-x: auto; }
  svg.chart { display: block; max-width: 100%; }
  .bar.low { fill: var(--success-color, #43a047); }
  .bar.mid { fill: var(--warning-color, #ffa600); }
  .bar.high { fill: var(--error-color, #db4437); }
  .bar.tomorrow { opacity: 0.55; }
  .bar.now { stroke: var(--primary-text-color); stroke-width: 2; opacity: 1; }
  .axis { stroke: var(--divider-color, #ccc); stroke-width: 1; }
  .mean { stroke: var(--secondary-text-color); stroke-dasharray: 4 3; stroke-width: 1; }
  .tick { font-size: 10px; fill: var(--secondary-text-color); }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--secondary-text-color); margin-top: 8px; }
  .legend span::before {
    content: "";
    display: inline-block;
    width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px;
  }
  .legend .l-low::before { background: var(--success-color, #43a047); }
  .legend .l-mid::before { background: var(--warning-color, #ffa600); }
  .legend .l-high::before { background: var(--error-color, #db4437); }
  .legend .l-tmr::before { background: var(--secondary-text-color); opacity: 0.55; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--secondary-text-color); padding: 6px 4px; border-bottom: 1px solid var(--divider-color); font-size: 12px; text-transform: uppercase; }
  td { padding: 8px 4px; border-bottom: 1px solid var(--divider-color); }
  tr:last-child td { border-bottom: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .status-list { display: flex; flex-direction: column; gap: 10px; }
  .status-row { display: flex; align-items: center; gap: 12px; }
  .status-row ha-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); }
  .status-row .t { flex: 1; }
  .status-row .t .n { font-weight: 500; }
  .status-row .t .d { font-size: 13px; color: var(--secondary-text-color); }
  .empty {
    padding: 32px 16px;
    text-align: center;
    color: var(--secondary-text-color);
  }
  .empty ha-icon { --mdc-icon-size: 48px; display: block; margin: 0 auto 12px; }
  .empty code { background: var(--secondary-background-color); padding: 2px 6px; border-radius: 4px; }
  .planned { list-style: none; margin: 0; padding: 0; }
  .planned li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid var(--divider-color); }
  .planned li:last-child { border-bottom: 0; }
  .planned ha-icon { --mdc-icon-size: 20px; color: var(--secondary-text-color); margin-top: 1px; }
  .planned .n { font-weight: 500; }
  .planned .d { font-size: 13px; color: var(--secondary-text-color); }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12px; padding: 3px 10px; border-radius: 999px;
    background: var(--secondary-background-color); color: var(--secondary-text-color);
    margin-left: auto; font-weight: 400; text-transform: none; letter-spacing: 0;
  }
  .area { fill: var(--warning-color, #ffa600); opacity: 0.25; }
  .line { fill: none; stroke: var(--warning-color, #ffa600); stroke-width: 2; }
  .now-line { stroke: var(--primary-text-color); stroke-width: 1; stroke-dasharray: 3 3; }
  .progress { height: 8px; border-radius: 4px; background: var(--secondary-background-color); overflow: hidden; margin-top: 6px; }
  .progress > div { height: 100%; background: var(--warning-color, #ffa600); border-radius: 4px; transition: width 300ms; }
  .setup-link { color: var(--primary-color); text-decoration: none; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .row.between { justify-content: space-between; }
  button.btn {
    font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; cursor: pointer;
    border: 1px solid var(--divider-color); background: var(--card-background-color); color: var(--primary-text-color);
  }
  button.btn.primary { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  button.btn.danger { color: var(--error-color, #db4437); }
  button.btn.active { background: var(--warning-color, #ffa600); border-color: var(--warning-color, #ffa600); color: #fff; }
  button.btn:disabled { opacity: 0.5; cursor: default; }
  .field { display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; font-size: 13px; color: var(--secondary-text-color); height: 100%; }
  .field input, .field select {
    font: inherit; font-size: 14px; color: var(--primary-text-color); background: var(--card-background-color);
    border: 1px solid var(--divider-color); border-radius: 8px; padding: 8px 10px; box-sizing: border-box; width: 100%;
  }
  .field input:focus { outline: 2px solid var(--primary-color); outline-offset: -1px; }
  .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
  .picker { position: relative; }
  .picker-list {
    position: absolute; left: 0; right: 0; top: 100%; z-index: 5; max-height: 220px; overflow: auto;
    background: var(--card-background-color); border: 1px solid var(--divider-color); border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .picker-list div { padding: 8px 10px; cursor: pointer; font-size: 13px; color: var(--primary-text-color); }
  .picker-list div small { display: block; color: var(--secondary-text-color); font-size: 11px; }
  .picker-list div:hover { background: var(--secondary-background-color); }
  .soc-bar { position: relative; height: 10px; border-radius: 5px; background: var(--secondary-background-color); margin: 8px 0 4px; overflow: visible; }
  .soc-bar .fill { height: 100%; border-radius: 5px; background: var(--primary-color); }
  .soc-bar .target { position: absolute; top: -3px; width: 2px; height: 16px; background: var(--primary-text-color); }
  .soc-bar .fill.charging { background: var(--success-color, #43a047); }
  .car-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; }
  .car-grid .card { margin-bottom: 0; }
  .car-meta { font-size: 13px; color: var(--secondary-text-color); display: flex; flex-direction: column; gap: 3px; margin: 8px 0; }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 10px; align-items: end; }
  .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--secondary-text-color); cursor: pointer; min-height: 36px; }
  .toggle input { width: auto; }
  .plan-strip { width: 100%; height: 34px; display: block; margin-top: 8px; }
  .slot { fill: var(--secondary-background-color); }
  .slot.chosen { fill: var(--success-color, #43a047); }
  .slot.est { opacity: 0.55; }
  .slot.now { stroke: var(--primary-text-color); stroke-width: 1.5; }
  .err { color: var(--error-color, #db4437); font-size: 13px; margin-top: 6px; }
  .slot.hold { fill: var(--info-color, #039be5); }
  .slot.charge { fill: var(--success-color, #43a047); }
  .slot.normal { fill: var(--secondary-background-color); }
  .legend .l-hold::before { background: var(--info-color, #039be5); }
  .legend .l-charge::before { background: var(--success-color, #43a047); }
  .legend .l-normal::before { background: var(--secondary-background-color); border: 1px solid var(--divider-color); }
  .badge.info { background: var(--info-color, #039be5); }
  .seg { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; border-right: 1px solid var(--divider-color); border-radius: 0; }
  .seg button:last-child { border-right: 0; }
  .seg button.active { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .cmd { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; align-items: end; }
  .flow { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
  .flow .item { display: flex; gap: 10px; align-items: center; }
  .flow .item ha-icon { --mdc-icon-size: 28px; color: var(--secondary-text-color); }
  .flow .item .v { font-size: 20px; font-weight: 500; line-height: 1.1; }
  .flow .item .l { font-size: 12px; color: var(--secondary-text-color); }
  .flow .item.in .v { color: var(--error-color, #db4437); }
  .flow .item.out .v { color: var(--success-color, #43a047); }
  h3 { font-size: 14px; font-weight: 500; margin: 14px 0 6px; color: var(--secondary-text-color); }
  table.sched { margin-top: 8px; }
  table.sched td, table.sched th { padding: 4px 4px; }
  table.sched select { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); max-width: 170px; }
  table.sched input[data-time], table.sched input[type=number] { font: inherit; font-size: 13px; padding: 4px 6px; border: 1px solid var(--divider-color); border-radius: 6px; background: var(--card-background-color); color: var(--primary-text-color); width: 100%; max-width: 110px; box-sizing: border-box; }
  table.sched th:first-child, table.sched td:first-child { width: 30%; }
  table.sched tr.off td:not(:first-child) { opacity: 0.45; }
  table.sched tr.all td { border-bottom: 2px solid var(--divider-color); }
  table.sched tr.today td:first-child { font-weight: 600; color: var(--primary-color); }
  .sched-wrap h3 { margin-top: 12px; }
  .hint { font-size: 12px; color: var(--secondary-text-color); }
  @media (max-width: 600px) {
    .content { padding: 12px; }
    .tab { font-size: 12px; padding: 10px 4px; }
    .tab span { display: none; }
    .kpi .value { font-size: 24px; }
  }
`;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtNum = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "–"
    : Number(v).toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

class ElectricityOptimizerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "home";
    this._lastKey = null;
    this._cars = null;
    this._carsStamp = 0;
    this._battery = undefined; // undefined = not loaded, null = not configured
    this._batteryRuntime = {};
    this._batteryStamp = 0;
    this._editingBattery = false;
    this._batteryError = null;
    this._rules = null;
    this._rulesStamp = 0;
    this._editingRulesSensor = false;
    this._rulesError = null;
    this._editing = null; // null | {} (new) | car object being edited
    this._formError = null;
    this._built = false;
    try {
      const saved = localStorage.getItem("electricity_optimizer_tab");
      if (saved && TABS.some((t) => t.id === saved)) this._tab = saved;
    } catch (_) {
      /* ignore */
    }
  }

  set hass(hass) {
    this._hass = hass;
    this._maybeRender();
  }
  get hass() {
    return this._hass;
  }

  set panel(panel) {
    this._panel = panel;
    this._maybeRender(true);
  }

  set narrow(narrow) {
    this._narrow = narrow;
    if (this._menuButton) this._menuButton.narrow = narrow;
  }

  get _config() {
    return (this._panel && this._panel.config) || {};
  }

  get _priceEntityId() {
    return this._config.price_entity || "sensor.energi_data_service";
  }

  get _liveEntityIds() {
    const ids = [];
    for (const c of this._cars || []) {
      if (c.soc_entity) ids.push(c.soc_entity);
      if (c.plugged_entity) ids.push(c.plugged_entity);
      if (c.power_entity) ids.push(c.power_entity);
    }
    if (this._rules && this._rules.grid_power_entity) ids.push(this._rules.grid_power_entity);
    const b = this._battery;
    if (b) {
      for (const k of ["soc_entity", "power_entity", "charge_power_entity", "discharge_power_entity", "grid_power_entity", "house_power_entity"]) {
        if (b[k]) ids.push(b[k]);
      }
    }
    return ids;
  }

  get _solarEntityIds() {
    const c = this._config;
    return [
      c.solar_power_entity,
      c.solar_energy_today_entity,
      c.solar_energy_total_entity,
      c.solar_forecast_today_entity,
      c.solar_forecast_tomorrow_entity,
    ].filter(Boolean);
  }

  connectedCallback() {
    this._maybeRender(true);
    this._timer = setInterval(() => {
      if (this._tab === "ev" || this._tab === "home") this._loadCars();
      if (this._tab === "battery" || this._tab === "home") this._loadBattery();
      this._maybeRender();
    }, 3000);
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        const wrap = this.shadowRoot.querySelector(".chart-wrap");
        if (!wrap) return;
        const w = wrap.clientWidth;
        if (w && Math.abs(w - (this._chartWidth || 0)) > 4) {
          this._chartWidth = w;
          this._maybeRender(true);
        }
      });
      this._ro.observe(this);
    }
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    if (this._ro) this._ro.disconnect();
  }

  _maybeRender(force = false) {
    if (!this._hass) return;
    const st = this._hass.states[this._priceEntityId];
    const now = new Date();
    const solarKey = this._solarEntityIds
      .map((id) => (this._hass.states[id] ? this._hass.states[id].last_updated : "x"))
      .join(",");
    if (this._editing && this._tab === "ev" && !force) return;
    if (this._editingBattery && this._tab === "battery" && !force) return;
    if (!force) {
      const active = this.shadowRoot.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "SELECT")) return;
    }
    const liveKey = this._liveEntityIds
      .map((id) => (this._hass.states[id] ? this._hass.states[id].last_updated : "x"))
      .join(",");
    if (this._editingRulesSensor && this._tab === "home" && !force) return;
    const key = [
      liveKey,
      this._batteryStamp,
      this._rulesStamp,
      this._tab,
      st ? st.last_updated : "missing",
      solarKey,
      this._solarHistoryStamp || 0,
      this._carsStamp,
      now.getHours(),
      Math.floor(now.getMinutes() / 15),
      this._hass.language,
    ].join("|");
    if (!force && key === this._lastKey) return;
    this._lastKey = key;
    this._render();
  }

  _buildShell() {
    const root = this.shadowRoot;
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="toolbar">
        <ha-menu-button></ha-menu-button>
        <div class="title">Electricity Optimizer</div>
        <div class="version"></div>
      </div>
      <div class="tabs" role="tablist"></div>
      <div class="content"></div>
    `;
    this._menuButton = root.querySelector("ha-menu-button");
    this._menuButton.hass = this._hass;
    this._menuButton.narrow = this._narrow;
    this._tabsEl = root.querySelector(".tabs");
    this._contentEl = root.querySelector(".content");
    this._contentEl.addEventListener("click", (ev) => this._onContentClick(ev));
    this._contentEl.addEventListener("change", (ev) => this._onContentChange(ev));
    this._contentEl.addEventListener("input", (ev) => this._onContentInput(ev));
    this._contentEl.addEventListener("focusin", (ev) => this._onContentInput(ev));
    this._contentEl.addEventListener("focusout", (ev) => {
      const list = ev.target.closest && ev.target.closest(".picker") && ev.target.closest(".picker").querySelector(".picker-list");
      if (list) setTimeout(() => (list.hidden = true), 150);
    });
    this._versionEl = root.querySelector(".version");
    this._tabsEl.innerHTML = TABS.map(
      (t) => `
        <button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === this._tab}">
          <ha-icon icon="${t.icon}"></ha-icon><span>${t.label}</span>
        </button>`
    ).join("");
    this._tabsEl.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button.tab");
      if (!btn) return;
      this._tab = btn.dataset.tab;
      try {
        localStorage.setItem("electricity_optimizer_tab", this._tab);
      } catch (_) {
        /* ignore */
      }
      this._maybeRender(true);
    });
    this._built = true;
  }

  _render() {
    if (!this._built) this._buildShell();
    this._menuButton.hass = this._hass;
    this._versionEl.textContent = this._config.version ? `v${this._config.version}` : "";
    for (const b of this._tabsEl.querySelectorAll("button.tab")) {
      b.setAttribute("aria-selected", String(b.dataset.tab === this._tab));
    }
    const data = this._readPrices();
    let html = "";
    if (this._tab === "home") html = this._renderHome(data);
    else if (this._tab === "solar") html = this._renderSolar(this._readSolar());
    else if (this._tab === "ev") html = this._renderEv();
    else if (this._tab === "battery") html = this._renderBattery();
    if (this._tab === "ev" || this._tab === "home") this._loadCars();
    if (this._tab === "battery" || this._tab === "home") this._loadBattery();
    this._loadRules();
    if (this._tab === "solar") {
      this._loadCars();
      this._loadBattery();
    }
    this._contentEl.innerHTML = html;
  }

  /* ---------- data ---------- */

  _readPrices() {
    const st = this._hass.states[this._priceEntityId];
    if (!st) return { missing: true };
    const a = st.attributes || {};
    const parse = (list, day) =>
      Array.isArray(list)
        ? list
            .map((p) => ({ time: new Date(p.hour), price: Number(p.price), day }))
            .filter((p) => !Number.isNaN(p.time.getTime()) && !Number.isNaN(p.price))
        : [];
    const today = parse(a.raw_today, "today");
    const tomorrow = a.tomorrow_valid ? parse(a.raw_tomorrow, "tomorrow") : [];
    const all = today.concat(tomorrow);
    const now = new Date();
    let current = null;
    for (let i = 0; i < all.length; i++) {
      const next = all[i + 1];
      if (all[i].time <= now && (!next || next.time > now)) {
        current = all[i];
        break;
      }
    }
    const currentPrice =
      st.state !== "unknown" && st.state !== "unavailable" ? Number(st.state) : current ? current.price : null;
    const unit = `${a.currency || "DKK"}/${a.unit || "kWh"}`;
    return {
      missing: false,
      state: st,
      today,
      tomorrow,
      all,
      current,
      currentPrice,
      unit,
      currency: a.currency || "DKK",
      todayMin: a.today_min,
      todayMax: a.today_max,
      todayMean: a.today_mean,
      tomorrowMin: a.tomorrow_min,
      tomorrowMax: a.tomorrow_max,
      tomorrowMean: a.tomorrow_mean,
      tomorrowValid: !!a.tomorrow_valid,
      nextUpdate: a.next_data_update,
      attribution: a.attribution,
    };
  }

  static _level(price, sorted) {
    if (!sorted.length) return "neutral";
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    if (price <= q(0.33)) return "low";
    if (price >= q(0.67)) return "high";
    return "mid";
  }

  static _hourly(points) {
    const map = new Map();
    for (const p of points) {
      const h = new Date(p.time);
      h.setMinutes(0, 0, 0);
      const k = h.getTime();
      const e = map.get(k) || { time: h, sum: 0, n: 0 };
      e.sum += p.price;
      e.n += 1;
      map.set(k, e);
    }
    return [...map.values()].map((e) => ({ time: e.time, price: e.sum / e.n })).sort((x, y) => x.time - y.time);
  }

  /* ---------- views ---------- */

  _renderMissing() {
    return `
      <div class="card">
        <div class="empty">
          <ha-icon icon="mdi:database-off-outline"></ha-icon>
          <div>Prissensoren <code>${esc(this._priceEntityId)}</code> blev ikke fundet.</div>
          <div style="margin-top:8px">Installer og opsæt
            <a href="https://github.com/MTrab/energidataservice" target="_blank" rel="noopener">EnergiDataService</a>,
            eller vælg en anden sensor under Indstillinger → Enheder og tjenester → Electricity Optimizer.</div>
        </div>
      </div>`;
  }

  _renderHome(d) {
    if (d.missing) return this._renderMissing();
    if (!d.today.length) {
      return `<div class="card"><div class="empty"><ha-icon icon="mdi:timer-sand"></ha-icon>Venter på prisdata fra ${esc(
        this._priceEntityId
      )}…</div></div>`;
    }
    const sortedToday = d.today.map((p) => p.price).sort((a, b) => a - b);
    const nowLevel = d.currentPrice !== null ? ElectricityOptimizerPanel._level(d.currentPrice, sortedToday) : "neutral";
    const levelText = { low: "Billig", mid: "Normal", high: "Dyr", neutral: "Ukendt" }[nowLevel];
    const mean = typeof d.todayMean === "number" ? d.todayMean : sortedToday.reduce((a, b) => a + b, 0) / sortedToday.length;
    const diffPct = d.currentPrice !== null && mean ? Math.round(((d.currentPrice - mean) / Math.abs(mean)) * 100) : null;
    const diffText =
      diffPct === null ? "" : diffPct === 0 ? "På niveau med dagens gennemsnit" : `${Math.abs(diffPct)} % ${diffPct < 0 ? "under" : "over"} dagens gennemsnit`;

    const minH = d.todayMin && d.todayMin.hour ? fmtTime(new Date(d.todayMin.hour)) : null;
    const maxH = d.todayMax && d.todayMax.hour ? fmtTime(new Date(d.todayMax.hour)) : null;

    // Cheapest hours: rest of today + tomorrow if available
    const now = new Date();
    const hourly = ElectricityOptimizerPanel._hourly(d.all).filter((h) => h.time.getTime() + 3600000 > now.getTime());
    const cheapest = [...hourly].sort((a, b) => a.price - b.price).slice(0, 6).sort((a, b) => a.time - b.time);
    const expensive = [...hourly].sort((a, b) => b.price - a.price).slice(0, 3).sort((a, b) => a.time - b.time);
    const dayLabel = (t) => (t.getDate() === now.getDate() ? "I dag" : "I morgen");

    return `
      ${this._renderLiveRow()}
      <div class="grid">
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:flash"></ha-icon>Pris lige nu</div>
          <div class="value">${fmtNum(d.currentPrice)}<small>${esc(d.unit)}</small></div>
          <div class="sub"><span class="badge ${nowLevel}">${levelText}</span> ${esc(diffText)}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:arrow-down-bold-circle-outline"></ha-icon>Laveste i dag</div>
          <div class="value">${fmtNum(d.todayMin && d.todayMin.price)}<small>${esc(d.unit)}</small></div>
          <div class="sub">${minH ? `kl. ${minH}` : ""}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:arrow-up-bold-circle-outline"></ha-icon>Højeste i dag</div>
          <div class="value">${fmtNum(d.todayMax && d.todayMax.price)}<small>${esc(d.unit)}</small></div>
          <div class="sub">${maxH ? `kl. ${maxH}` : ""}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:chart-line"></ha-icon>Gennemsnit i dag</div>
          <div class="value">${fmtNum(mean)}<small>${esc(d.unit)}</small></div>
          <div class="sub">${
            d.tomorrowValid ? `I morgen: ${fmtNum(d.tomorrowMean)} (${fmtNum(d.tomorrowMin && d.tomorrowMin.price)} – ${fmtNum(d.tomorrowMax && d.tomorrowMax.price)})` : "Morgendagens priser kommer ca. kl. 13"
          }</div>
        </div>
      </div>

      <div class="card">
        <h2><ha-icon icon="mdi:chart-bar"></ha-icon>Elpris ${d.tomorrowValid ? "i dag og i morgen" : "i dag"}</h2>
        <div class="chart-wrap">${this._renderChart(d)}</div>
        <div class="legend">
          <span class="l-low">Billig</span><span class="l-mid">Normal</span><span class="l-high">Dyr</span>
          ${d.tomorrowValid ? '<span class="l-tmr">I morgen (nedtonet)</span>' : ""}
          <span style="margin-left:auto">Stiplet linje = dagens gennemsnit</span>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2><ha-icon icon="mdi:cash-check"></ha-icon>Billigste timer fremover</h2>
          <table>
            <thead><tr><th>Dag</th><th>Tidsrum</th><th style="text-align:right">${esc(d.unit)}</th></tr></thead>
            <tbody>
              ${cheapest
                .map(
                  (h) =>
                    `<tr><td>${dayLabel(h.time)}</td><td>${fmtTime(h.time)} – ${fmtTime(new Date(h.time.getTime() + 3600000))}</td><td class="num">${fmtNum(h.price)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <div class="card">
          <h2><ha-icon icon="mdi:cash-remove"></ha-icon>Dyreste timer fremover</h2>
          <table>
            <thead><tr><th>Dag</th><th>Tidsrum</th><th style="text-align:right">${esc(d.unit)}</th></tr></thead>
            <tbody>
              ${expensive
                .map(
                  (h) =>
                    `<tr><td>${dayLabel(h.time)}</td><td>${fmtTime(h.time)} – ${fmtTime(new Date(h.time.getTime() + 3600000))}</td><td class="num">${fmtNum(h.price)}</td></tr>`
                )
                .join("")}
            </tbody>
          </table>
          <div class="sub" style="font-size:13px;color:var(--secondary-text-color);margin-top:10px">Her bør husbatteriet levere strøm i stedet for nettet.</div>
        </div>
        <div class="card">
          <h2><ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon>Status</h2>
          <div class="status-list">
            ${this._renderSolarStatusRow()}
            ${this._renderBatteryStatusRow()}
            ${this._renderEvStatusRow()}
            <div class="status-row"><ha-icon icon="mdi:database-clock-outline"></ha-icon><div class="t"><div class="n">Prisdata</div><div class="d">${esc(d.attribution || "EnergiDataService")}${
              d.nextUpdate ? ` · næste opdatering ${fmtTime(new Date(d.nextUpdate))}` : ""
            }</div></div><span class="badge low">OK</span></div>
          </div>
        </div>
      </div>
      ${this._renderRulesCard()}`;
  }

  _gridLiveW() {
    // battery's grid sensor first, then the rules' house-level sensor
    const live = this._battery ? this._readBatteryLive() : { gridW: null, houseW: null };
    if (live.gridW !== null) return live.gridW;
    const r = this._rules;
    if (r && r.grid_power_entity) {
      const g = this._numState(r.grid_power_entity);
      const kw = ElectricityOptimizerPanel._toKw(g.value, g.unit);
      if (kw !== null) return kw * 1000 * (r.grid_sign === "export_positive" ? -1 : 1);
    }
    return null;
  }

  _renderLiveRow() {
    const solar = this._readSolar();
    const bat = this._battery ? this._readBatteryLive() : { soc: null, batW: null, gridW: null, houseW: null };
    const gridW = this._gridLiveW();
    const solarW = solar.powerKw === null ? null : Math.round(solar.powerKw * 1000);
    const w = (v) => (v === null ? "–" : `${fmtNum(Math.abs(v), 0)}<small>W</small>`);
    return `
      <div class="grid">
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:solar-power-variant"></ha-icon>Solceller lige nu</div>
          <div class="value ${solarW ? "sun" : ""}">${w(solarW)}</div>
          <div class="sub">${solar.configured ? (solar.todayKwh !== null ? `${fmtNum(solar.todayKwh, 1)} kWh i dag` : "") : "Ingen sensor – se Konfigurer"}</div>
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:home-lightning-bolt"></ha-icon>Husforbrug</div>
          <div class="value">${w(bat.houseW)}</div>
          <div class="sub">${this._battery && this._battery.house_power_entity ? "lige nu" : "Ingen sensor – vælg under Hus batteri"}</div>
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:transmission-tower"></ha-icon>Elnet</div>
          <div class="value ${gridW > 0 ? "in" : gridW < 0 ? "out" : ""}">${w(gridW)}</div>
          <div class="sub">${gridW === null ? "Ingen net-sensor" : gridW > 0 ? "køber fra nettet" : gridW < 0 ? "sælger til nettet" : "i balance"}</div>
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:battery-charging"></ha-icon>Batteri effekt</div>
          <div class="value ${bat.batW > 0 ? "out" : bat.batW < 0 ? "in" : ""}">${w(bat.batW)}</div>
          <div class="sub">${bat.batW === null ? (this._battery ? "Ingen effekt-sensor" : "Ikke sat op") : bat.batW > 0 ? "lader" : bat.batW < 0 ? "aflader" : "hviler"}</div>
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:home-battery"></ha-icon>Hus batteri</div>
          <div class="value">${bat.soc === null ? "–" : `${fmtNum(bat.soc, 0)}<small>%</small>`}</div>
          <div class="sub">${this._battery ? `${fmtNum(this._battery.capacity_kwh, 1)} kWh · reserve ${this._battery.min_soc} %` : "Ikke sat op"}</div>
        </div>
      </div>`;
  }

  _renderSolarStatusRow() {
    const s = this._readSolar();
    if (!s.configured) {
      return `<div class="status-row"><ha-icon icon="mdi:solar-power-variant"></ha-icon><div class="t"><div class="n">Solceller</div><div class="d">Ingen sensorer valgt – se fanen Solceller</div></div><span class="badge neutral">Ikke sat op</span></div>`;
    }
    const parts = [];
    if (s.powerKw !== null) parts.push(`${fmtNum(Math.round(s.powerKw * 1000), 0)} W lige nu`);
    if (s.todayKwh !== null) parts.push(`${fmtNum(s.todayKwh, 1)} kWh i dag`);
    const producing = s.powerKw !== null && s.powerKw > 0.05;
    return `<div class="status-row"><ha-icon icon="mdi:solar-power-variant"></ha-icon><div class="t"><div class="n">Solceller</div><div class="d">${esc(parts.join(" · ") || "Ingen data")}</div></div><span class="badge ${producing ? "low" : "neutral"}">${producing ? "Producerer" : "Inaktiv"}</span></div>`;
  }

  _renderChart(d) {
    const points = d.all;
    if (!points.length) return "";
    const W = Math.max(320, Math.floor(this._chartWidth || (this._contentEl && this._contentEl.clientWidth - 34) || 640));
    const H = 240;
    const padL = 44, padR = 8, padT = 10, padB = 28;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const prices = points.map((p) => p.price);
    const maxP = Math.max(...prices, 0);
    const minP = Math.min(...prices, 0);
    const range = maxP - minP || 1;
    const y = (v) => padT + innerH - ((v - minP) / range) * innerH;
    const zeroY = y(0);
    const bw = innerW / points.length;
    const sortedToday = d.today.map((p) => p.price).sort((a, b) => a - b);
    const mean = typeof d.todayMean === "number" ? d.todayMean : null;

    const bars = points
      .map((p, i) => {
        const lvl = ElectricityOptimizerPanel._level(p.price, sortedToday);
        const isNow = d.current && p.time.getTime() === d.current.time.getTime();
        const x = padL + i * bw;
        const top = Math.min(y(p.price), zeroY);
        const h = Math.max(1, Math.abs(y(p.price) - zeroY));
        const cls = `bar ${lvl}${p.day === "tomorrow" ? " tomorrow" : ""}${isNow ? " now" : ""}`;
        const label = `${p.day === "today" ? "I dag" : "I morgen"} ${fmtTime(p.time)}: ${fmtNum(p.price)} ${d.unit}`;
        return `<rect class="${cls}" x="${(x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1.5"><title>${esc(label)}</title></rect>`;
      })
      .join("");

    // x ticks: every 3 hours, plus day boundary
    const ticks = [];
    points.forEach((p, i) => {
      const hr = p.time.getHours();
      const mn = p.time.getMinutes();
      if (mn === 0 && hr % 3 === 0) {
        const x = padL + i * bw + bw / 2;
        ticks.push(`<text class="tick" x="${x.toFixed(1)}" y="${H - 10}" text-anchor="middle">${pad2(hr)}</text>`);
      }
      if (i > 0 && p.day === "tomorrow" && points[i - 1].day === "today") {
        const x = padL + i * bw;
        ticks.push(`<line class="axis" x1="${x}" x2="${x}" y1="${padT}" y2="${padT + innerH}" stroke-dasharray="2 2"/>`);
        ticks.push(`<text class="tick" x="${x + 4}" y="${padT + 10}">I morgen</text>`);
      }
    });

    // y ticks
    const yTicks = [];
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const v = minP + (range * s) / steps;
      yTicks.push(`<line class="axis" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" opacity="0.5"/>`);
      yTicks.push(`<text class="tick" x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmtNum(v, 2)}</text>`);
    }

    const meanLine =
      mean !== null ? `<line class="mean" x1="${padL}" x2="${W - padR}" y1="${y(mean).toFixed(1)}" y2="${y(mean).toFixed(1)}"/>` : "";

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${yTicks.join("")}
      <line class="axis" x1="${padL}" x2="${W - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"/>
      ${bars}
      ${meanLine}
      ${ticks.join("")}
    </svg>`;
  }

  /* ---------- solar ---------- */

  _numState(entityId) {
    if (!entityId) return { value: null, unit: null, state: null };
    const st = this._hass.states[entityId];
    if (!st || st.state === "unknown" || st.state === "unavailable") return { value: null, unit: null, state: st || null };
    const v = Number(st.state);
    return { value: Number.isNaN(v) ? null : v, unit: st.attributes.unit_of_measurement || null, state: st };
  }

  static _toKw(value, unit) {
    if (value === null) return null;
    const u = (unit || "").toLowerCase();
    if (u === "w") return value / 1000;
    if (u === "mw") return value * 1000;
    return value; // assume kW
  }

  static _toKwh(value, unit) {
    if (value === null) return null;
    const u = (unit || "").toLowerCase();
    if (u === "wh") return value / 1000;
    if (u === "mwh") return value * 1000;
    return value; // assume kWh
  }

  _readSolar() {
    const c = this._config;
    const configured = !!(c.solar_power_entity || c.solar_energy_today_entity);
    const power = this._numState(c.solar_power_entity);
    const today = this._numState(c.solar_energy_today_entity);
    const total = this._numState(c.solar_energy_total_entity);
    const fcToday = this._numState(c.solar_forecast_today_entity);
    const fcTomorrow = this._numState(c.solar_forecast_tomorrow_entity);
    const sun = this._hass.states["sun.sun"];
    const sunAttr = (sun && sun.attributes) || {};
    return {
      configured,
      powerKw: ElectricityOptimizerPanel._toKw(power.value, power.unit),
      powerEntity: c.solar_power_entity,
      todayKwh: ElectricityOptimizerPanel._toKwh(today.value, today.unit),
      totalKwh: ElectricityOptimizerPanel._toKwh(total.value, total.unit),
      fcTodayKwh: ElectricityOptimizerPanel._toKwh(fcToday.value, fcToday.unit),
      fcTomorrowKwh: ElectricityOptimizerPanel._toKwh(fcTomorrow.value, fcTomorrow.unit),
      peakKw: typeof c.solar_peak_kw === "number" ? c.solar_peak_kw : null,
      sunUp: sun ? sun.state === "above_horizon" : null,
      elevation: typeof sunAttr.elevation === "number" ? sunAttr.elevation : null,
      azimuth: typeof sunAttr.azimuth === "number" ? sunAttr.azimuth : null,
      nextRising: sunAttr.next_rising ? new Date(sunAttr.next_rising) : null,
      nextSetting: sunAttr.next_setting ? new Date(sunAttr.next_setting) : null,
      history: this._solarHistory || null,
    };
  }

  async _loadSolarHistory() {
    const entityId = this._config.solar_power_entity;
    if (!entityId || !this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (this._solarHistoryLoading || (this._solarHistoryAt && now - this._solarHistoryAt < 5 * 60000)) return;
    this._solarHistoryLoading = true;
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: new Date().toISOString(),
        entity_ids: [entityId],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const rows = (res && res[entityId]) || [];
      const unit = (this._hass.states[entityId] || { attributes: {} }).attributes.unit_of_measurement;
      const points = rows
        .map((r) => ({ t: Number(r.lu) * 1000, v: ElectricityOptimizerPanel._toKw(Number(r.s), unit) }))
        .filter((r) => !Number.isNaN(r.v) && r.v !== null);
      // 10-minute buckets over the whole day, last-known value carried forward
      const buckets = [];
      let idx = 0;
      let last = 0;
      for (let m = 0; m < 24 * 60; m += 10) {
        const bt = start.getTime() + m * 60000;
        if (bt > now) break;
        while (idx < points.length && points[idx].t <= bt + 10 * 60000) {
          last = points[idx].v;
          idx++;
        }
        buckets.push({ t: bt, v: Math.max(0, last) });
      }
      this._solarHistory = { start: start.getTime(), buckets };
      this._solarHistoryAt = now;
      this._solarHistoryStamp = now;
      this._maybeRender();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("electricity-optimizer: history fetch failed", err);
    } finally {
      this._solarHistoryLoading = false;
    }
  }

  _renderSolar(s) {
    if (!s.configured) {
      return `
        <div class="card">
          <div class="empty">
            <ha-icon icon="mdi:solar-power-variant-outline"></ha-icon>
            <div>Der er ikke valgt nogen solcelle-sensorer endnu.</div>
            <div style="margin-top:8px">Gå til <a class="setup-link" href="/config/integrations/integration/electricity_optimizer">Indstillinger → Enheder og tjenester → Electricity Optimizer → Konfigurer</a>
              og vælg som minimum sensoren for produktion lige nu (W/kW) og produktion i dag (kWh).</div>
          </div>
        </div>`;
    }
    this._loadSolarHistory();

    const pct = s.peakKw && s.powerKw !== null ? Math.min(100, Math.round((s.powerKw / s.peakKw) * 100)) : null;
    const fcPct = s.fcTodayKwh && s.todayKwh !== null ? Math.min(100, Math.round((s.todayKwh / s.fcTodayKwh) * 100)) : null;
    const sunBadge = s.sunUp === null ? "" : s.sunUp ? '<span class="badge low">Solen er oppe</span>' : '<span class="badge neutral">Solen er nede</span>';
    const rise = s.nextRising ? fmtTime(s.nextRising) : "–";
    const set = s.nextSetting ? fmtTime(s.nextSetting) : "–";
    const sunTimes = s.sunUp ? `Solnedgang kl. ${set} · Solopgang i morgen kl. ${rise}` : `Solopgang kl. ${rise} · Solnedgang kl. ${set}`;

    const producedKwh = s.history ? s.history.buckets.reduce((acc, b) => acc + b.v * (10 / 60), 0) : null;

    return `
      <div class="grid">
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:solar-power"></ha-icon>Produktion lige nu</div>
          <div class="value">${fmtNum(s.powerKw === null ? null : Math.round(s.powerKw * 1000), 0)}<small>W</small></div>
          ${
            pct !== null
              ? `<div class="sub">${pct} % af ${fmtNum(s.peakKw, 1)} kWp</div><div class="progress"><div style="width:${pct}%"></div></div>`
              : `<div class="sub">${s.peakKw ? "" : "Angiv installeret effekt for at se udnyttelse"}</div>`
          }
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:counter"></ha-icon>Produceret i dag</div>
          <div class="value">${fmtNum(s.todayKwh, 1)}<small>kWh</small></div>
          ${
            s.fcTodayKwh
              ? `<div class="sub">${fcPct} % af prognosen på ${fmtNum(s.fcTodayKwh, 1)} kWh</div><div class="progress"><div style="width:${fcPct}%"></div></div>`
              : `<div class="sub">${producedKwh !== null && s.todayKwh === null ? `ca. ${fmtNum(producedKwh, 1)} kWh ud fra effektkurven` : ""}</div>`
          }
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:weather-sunny"></ha-icon>Prognose</div>
          <div class="value">${fmtNum(s.fcTodayKwh, 1)}<small>kWh i dag</small></div>
          <div class="sub">${s.fcTomorrowKwh !== null ? `I morgen: ${fmtNum(s.fcTomorrowKwh, 1)} kWh` : "Ingen prognose-sensor valgt"}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Solen</div>
          <div class="value">${s.elevation !== null ? `${fmtNum(s.elevation, 0)}°` : "–"}<small>over horisonten</small></div>
          <div class="sub">${sunBadge} ${esc(sunTimes)}</div>
        </div>
      </div>

      <div class="card">
        <h2><ha-icon icon="mdi:chart-areaspline"></ha-icon>Produktion i dag</h2>
        <div class="chart-wrap">${this._renderSolarChart(s)}</div>
        <div class="legend">
          <span class="l-mid">Effekt (kW)</span>
          ${s.peakKw ? `<span style="margin-left:auto">Toppunkt for anlægget: ${fmtNum(s.peakKw, 1)} kWp</span>` : ""}
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2><ha-icon icon="mdi:information-outline"></ha-icon>Anlæg</h2>
          <table>
            <tbody>
              <tr><td>Installeret effekt</td><td class="num">${s.peakKw ? `${fmtNum(s.peakKw, 1)} kWp` : "–"}</td></tr>
              <tr><td>Produceret i alt</td><td class="num">${s.totalKwh !== null ? `${fmtNum(s.totalKwh, 0)} kWh` : "–"}</td></tr>
              <tr><td>Solens retning</td><td class="num">${s.azimuth !== null ? `${fmtNum(s.azimuth, 0)}°` : "–"}</td></tr>
              <tr><td>Effekt-sensor</td><td class="num" style="font-size:12px;color:var(--secondary-text-color)">${esc(s.powerEntity || "–")}</td></tr>
            </tbody>
          </table>
        </div>
        ${this._renderSolarUsageCard()}
      </div>`;
  }

  _renderSolarUsageCard() {
    const rules = this._rules;
    const cars = this._cars || [];
    const todayIdx = (new Date().getDay() + 6) % 7;
    const srcToday = (c) => (Array.isArray(c.schedule) && c.schedule[todayIdx] && c.schedule[todayIdx].source) || c.source;
    const solarCars = cars.filter((c) => srcToday(c) === "solar" || srcToday(c) === "solar_plan");
    const battery = this._battery;
    const carText = solarCars.length
      ? `${solarCars.map((c) => c.name).join(", ")} lader på overskud i dag (${solarCars.length > 1 ? "i den rækkefølge" : "kilde: " + (ElectricityOptimizerPanel.SOURCE_TEXT[srcToday(solarCars[0])] || "")})`
      : cars.length
        ? "Ingen biler bruger sol i dag (kilde pr. dag i ugeplanen under Elbiler)"
        : "Ingen elbiler tilføjet";
    let rows;
    if (!rules) {
      rows = `<div class="status-row"><ha-icon icon="mdi:timer-sand"></ha-icon><div class="t"><div class="d">Henter regler…</div></div></div>`;
    } else if (rules.solar_priority === "battery") {
      rows = `
        <div class="status-row"><span class="badge info">1</span><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri først</div><div class="d">${battery ? `Batteriet lader fra sol, indtil det er over ${rules.battery_min_soc_for_ev_solar} %.` : "Intet husbatteri sat op – reglen har ingen effekt."}</div></div></div>
        <div class="status-row"><span class="badge info">2</span><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbil</div><div class="d">Får kun ren eksport, og først når batteriet er over grænsen. ${esc(carText)}.</div></div></div>`;
    } else {
      rows = `
        <div class="status-row"><span class="badge info">1</span><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbil først</div><div class="d">Bilen får eksporten plus det, batteriet lader med. ${esc(carText)}.</div></div></div>
        <div class="status-row"><span class="badge info">2</span><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">${battery ? "Får det overskud, bilen ikke bruger, og bruges i de dyre timer." : "Intet husbatteri sat op."}</div></div></div>`;
    }
    const ctx = this._context || {};
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon>Sådan bruges solstrømmen <a class="setup-link hint" href="#" data-goto="home" style="margin-left:auto">Regler</a></h2>
        <div class="status-list">${rows}</div>
        ${rules ? `<div class="hint" style="margin-top:8px">Sol starter efter ${rules.solar_start_minutes} min overskud og stopper efter ${rules.solar_stop_minutes} min underskud.${ctx.surplus_w !== undefined && ctx.surplus_w !== null ? ` Overskud ved sidste beregning: ${fmtNum(ctx.surplus_w, 0)} W.` : ""}</div>` : ""}
      </div>`;
  }

  _renderSolarChart(s) {
    const W = Math.max(320, Math.floor(this._chartWidth || (this._contentEl && this._contentEl.clientWidth - 34) || 640));
    const H = 220;
    const padL = 40, padR = 8, padT = 10, padB = 26;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    const dayMs = 24 * 3600000;
    const x = (t, start) => padL + ((t - start) / dayMs) * innerW;

    if (!s.history) {
      return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><text class="tick" x="${W / 2}" y="${H / 2}" text-anchor="middle">${
        s.powerEntity ? "Henter dagens produktionskurve…" : "Vælg en effekt-sensor for at se kurven"
      }</text></svg>`;
    }
    const { start, buckets } = s.history;
    const maxV = Math.max(s.peakKw || 0, ...buckets.map((b) => b.v), 0.1);
    const y = (v) => padT + innerH - (v / maxV) * innerH;
    const pts = buckets.map((b) => `${x(b.t, start).toFixed(1)},${y(b.v).toFixed(1)}`);
    const lastT = buckets.length ? buckets[buckets.length - 1].t : start;
    const area = pts.length
      ? `<path class="area" d="M${x(buckets[0].t, start).toFixed(1)},${y(0).toFixed(1)} L${pts.join(" L")} L${x(lastT, start).toFixed(1)},${y(0).toFixed(1)} Z"/>`
      : "";
    const line = pts.length ? `<polyline class="line" points="${pts.join(" ")}"/>` : "";

    const xt = [];
    for (let h = 0; h <= 24; h += 3) {
      const xx = padL + (h / 24) * innerW;
      xt.push(`<line class="axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${padT}" y2="${padT + innerH}" opacity="0.5"/>`);
      if (h < 24) xt.push(`<text class="tick" x="${xx.toFixed(1)}" y="${H - 8}" text-anchor="middle">${pad2(h)}</text>`);
    }
    const yt = [];
    for (let i = 0; i <= 4; i++) {
      const v = (maxV * i) / 4;
      yt.push(`<line class="axis" x1="${padL}" x2="${W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" opacity="0.5"/>`);
      yt.push(`<text class="tick" x="${padL - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${fmtNum(v, 1)}</text>`);
    }
    const nowX = x(Date.now(), start);
    const sunLines = [];
    for (const [d, label] of [[s.nextRising, "op"], [s.nextSetting, "ned"]]) {
      if (!d) continue;
      let t = d.getTime();
      // sun.sun exposes the *next* event; if that is tomorrow, shift back one day (≈ today's time)
      if (t > start + dayMs) t -= dayMs;
      if (t < start || t > start + dayMs) continue;
      const xx = x(t, start);
      sunLines.push(`<line class="axis" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${padT}" y2="${padT + innerH}" stroke-dasharray="4 3"/>`);
      sunLines.push(`<text class="tick" x="${(xx + 3).toFixed(1)}" y="${padT + 10}">Sol ${label}</text>`);
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${yt.join("")}${xt.join("")}
      ${area}${line}
      <line class="now-line" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${padT}" y2="${padT + innerH}"/>
      ${sunLines.join("")}
    </svg>`;
  }

  /* ---------- EV ---------- */

  async _loadCars(force = false) {
    if (!this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (!force && this._carsLoadedAt && now - this._carsLoadedAt < 2500) return;
    if (this._carsLoading) return;
    this._carsLoading = true;
    try {
      const res = await this._hass.callWS({ type: "electricity_optimizer/cars/list" });
      const cars = res.cars || [];
      const json = JSON.stringify(cars);
      this._carsLoadedAt = Date.now();
      if (json !== this._carsJson) {
        this._cars = cars;
        this._carsJson = json;
        this._carsStamp = Date.now();
        this._maybeRender();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("electricity-optimizer: cars/list failed", err);
      this._cars = this._cars || [];
      this._carsError = err && err.message ? err.message : String(err);
    } finally {
      this._carsLoading = false;
    }
  }

  async _saveCar(car) {
    const res = await this._hass.callWS({ type: "electricity_optimizer/cars/save", car });
    await this._loadCars(true);
    return res.car;
  }

  static STATUS_TEXT = {
    no_soc: ["SoC ukendt", "neutral"],
    no_prices: ["Ingen priser", "neutral"],
    disabled: ["Smart opladning fra", "neutral"],
    done: ["Klar", "low"],
    not_plugged: ["Ikke tilsluttet", "neutral"],
    charge_now: ["Lader nu (manuelt)", "mid"],
    below_limit: ["Lader – under prisgrænse", "low"],
    charging: ["Lader – planlagt", "low"],
    waiting: ["Venter på billig strøm", "mid"],
    solar: ["Lader fra sol", "low"],
    solar_wait: ["Venter på sol-overskud", "mid"],
    battery_first: ["Venter – husbatteri først", "mid"],
    fuse_wait: ["Venter – hovedsikring", "mid"],
    no_grid_sensor: ["Mangler net-sensor til sol", "neutral"],
    no_deadline: ["Ingen planlagt dag", "neutral"],
  };

  static SOURCE_TEXT = { solar: "Kun sol", solar_plan: "Sol + billige timer", plan: "Kun billige timer" };

  async _loadRules(force = false) {
    if (!this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (!force && this._rulesLoadedAt && now - this._rulesLoadedAt < 10000) return;
    if (this._rulesLoading) return;
    this._rulesLoading = true;
    try {
      const res = await this._hass.callWS({ type: "electricity_optimizer/rules/get" });
      this._rulesLoadedAt = Date.now();
      this._applyRules(res);
    } catch (err) {
      this._rulesError = err && err.message ? err.message : String(err);
    } finally {
      this._rulesLoading = false;
    }
  }

  _applyRules(res) {
    const json = JSON.stringify(res.rules || null);
    this._context = res.context || this._context;
    if (json === this._rulesJson) return;
    this._rules = res.rules || null;
    this._rulesJson = json;
    this._rulesStamp = Date.now();
    this._maybeRender();
  }

  async _saveRules(patch) {
    const res = await this._hass.callWS({ type: "electricity_optimizer/rules/save", rules: patch });
    this._rulesLoadedAt = Date.now();
    this._applyRules(res);
    return res;
  }

  _renderRulesCard() {
    const r = this._rules;
    if (!r) return "";
    const ctx = this._context || {};
    const gridLive = r.grid_power_entity ? this._numState(r.grid_power_entity) : { value: null };
    const sel = (key, opts) =>
      `<select data-rfield="${key}">${opts.map(([v, l]) => `<option value="${v}" ${r[key] === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const sensorForm = this._editingRulesSensor
      ? `<form class="rules-form" style="margin-top:10px">
           <div class="fields">
             <label class="field">Net import/eksport (W)<div class="picker"><input name="grid_power_entity" data-domains="sensor" value="${esc(r.grid_power_entity)}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
             <label class="field">Fortegn<select name="grid_sign"><option value="import_positive" ${r.grid_sign === "import_positive" ? "selected" : ""}>Positiv = køber</option><option value="export_positive" ${r.grid_sign === "export_positive" ? "selected" : ""}>Positiv = sælger</option></select></label>
           </div>
           <div class="row" style="margin-top:10px"><button class="btn primary" type="submit" data-raction="save-sensor">Gem</button><button class="btn" type="button" data-raction="cancel-sensor">Annuller</button></div>
         </form>`
      : `<div class="hint" style="margin-top:8px">Net-sensor til sol-overskud: ${
          r.grid_power_entity ? `<code>${esc(r.grid_power_entity)}</code>${gridLive.value !== null ? ` (${fmtNum(gridLive.value, 0)} W)` : ""}` : "bruger husbatteriets net-sensor"
        } <button class="btn" style="padding:4px 10px;font-size:12px;margin-left:6px" data-raction="edit-sensor">Vælg sensor</button></div>`;
    return `
      <div class="card" data-rules>
        <h2><ha-icon icon="mdi:scale-balance"></ha-icon>Regler for opladning</h2>
        <div class="controls">
          <label class="field">Solstrøm først til${sel("solar_priority", [["ev", "Elbil"], ["battery", "Husbatteri"]])}</label>
          <label class="field">Elbil får sol når batteri ≥ (%)<input type="number" min="0" max="100" data-rfield="battery_min_soc_for_ev_solar" value="${r.battery_min_soc_for_ev_solar}" ${r.solar_priority === "battery" ? "" : "disabled"}></label>
          <label class="field">Netopladning først til${sel("grid_priority", [["ev", "Elbil"], ["battery", "Husbatteri"]])}</label>
          <label class="field">Hovedsikring (A pr. fase)<input type="number" min="0" step="1" data-rfield="max_total_amps" value="${r.max_total_amps === null ? "" : r.max_total_amps}" placeholder="ingen grænse"></label>
          <label class="toggle"><input type="checkbox" data-rfield="hold_battery_while_ev_grid_charging" ${r.hold_battery_while_ev_grid_charging ? "checked" : ""}> Hold husbatteri mens elbil lader fra nettet</label>
          <label class="field">Sol: start efter (min)<input type="number" min="0" step="0.5" data-rfield="solar_start_minutes" value="${r.solar_start_minutes}"></label>
          <label class="field">Sol: stop efter (min)<input type="number" min="0" step="0.5" data-rfield="solar_stop_minutes" value="${r.solar_stop_minutes}"></label>
        </div>
        ${sensorForm}
        <div class="hint" style="margin-top:8px">Elbil først: bilen får eksporten plus det, batteriet lader med. Husbatteri først: bilen får kun eksporten, og først når batteriet er over grænsen. Flere biler får sol i den rækkefølge, de står i under Elbiler.${
          ctx.surplus_w !== undefined && ctx.surplus_w !== null ? ` Overskud ved sidste beregning: ${fmtNum(ctx.surplus_w, 0)} W.` : ""
        }</div>
        ${this._rulesError ? `<div class="err">${esc(this._rulesError)}</div>` : ""}
      </div>`;
  }

  async _onRulesClick(btn, ev) {
    const action = btn.dataset.raction;
    try {
      if (action === "edit-sensor") {
        this._editingRulesSensor = true;
      } else if (action === "cancel-sensor") {
        this._editingRulesSensor = false;
      } else if (action === "save-sensor") {
        ev.preventDefault();
        const form = btn.closest("form");
        const data = {};
        for (const el of form.querySelectorAll("input[name],select[name]")) data[el.name] = el.value;
        await this._saveRules(data);
        this._editingRulesSensor = false;
      }
      this._rulesError = null;
    } catch (err) {
      this._rulesError = err && err.message ? err.message : String(err);
    }
    this._maybeRender(true);
  }

  _renderEvStatusRow() {
    const cars = this._cars;
    if (!cars || !cars.length) {
      return `<div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbiler</div><div class="d">Ingen biler tilføjet – se fanen Elbiler</div></div><span class="badge neutral">Ikke sat op</span></div>`;
    }
    const charging = cars.filter((c) => c.runtime && c.runtime.charging).length;
    const desc = cars
      .map((c) => {
        const v = this._numState(c.soc_entity).value;
        return `${c.name}: ${v !== null ? fmtNum(v, 0) + " %" : "–"}`;
      })
      .join(" · ");
    return `<div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbiler</div><div class="d">${esc(desc)}</div></div><span class="badge ${charging ? "low" : "neutral"}">${charging ? `${charging} lader` : "Ingen lader"}</span></div>`;
  }

  _renderEv() {
    if (this._editing) return this._renderCarForm(this._editing);
    const cars = this._cars;
    let body;
    if (cars === null) {
      body = `<div class="card"><div class="empty"><ha-icon icon="mdi:timer-sand"></ha-icon>Henter biler…</div></div>`;
    } else if (!cars.length) {
      body = `<div class="card"><div class="empty"><ha-icon icon="mdi:car-electric-outline"></ha-icon>
        <div>Ingen elbiler er tilføjet endnu.</div>
        <div style="margin-top:12px"><button class="btn primary" data-action="add-car">Tilføj bil</button></div></div></div>`;
    } else {
      body = `<div class="car-grid">${cars.map((c, i) => this._renderCarCard(c, i, cars.length)).join("")}</div>`;
    }
    return `
      <div class="row between" style="margin-bottom:12px">
        <div class="hint">Bilerne lades i de billigste tidsrum inden deadline. Kommandoer sendes til de valgte start/stop-entiteter.</div>
        ${cars && cars.length ? '<button class="btn primary" data-action="add-car"><ha-icon icon="mdi:plus" style="--mdc-icon-size:18px"></ha-icon> Tilføj bil</button>' : ""}
      </div>
      ${this._carsError ? `<div class="err">${esc(this._carsError)}</div>` : ""}
      ${body}`;
  }

  _renderCarCard(car, index = 0, total = 1) {
    const rt = car.runtime || {};
    const [statusText, statusCls] = ElectricityOptimizerPanel.STATUS_TEXT[rt.status] || ["Ukendt", "neutral"];
    const liveSoc = this._numState(car.soc_entity).value;
    const soc = liveSoc !== null ? liveSoc : rt.soc !== null && rt.soc !== undefined ? Number(rt.soc) : null;
    const plan = rt.plan || null;
    const now = new Date();
    const dayLabel = (d) => (d.getDate() === now.getDate() ? "i dag" : "i morgen");
    const meta = [];
    if (plan) {
      if (plan.need_kwh > 0) meta.push(`Mangler ${fmtNum(plan.need_kwh, 1)} kWh · ca. ${fmtNum(plan.need_hours, 1)} t ved ${fmtNum(car.max_amps, 0)} A (${fmtNum(car.charge_power_kw, 1)} kW)`);
      if (plan.deadline) {
        const dl = new Date(plan.deadline);
        const dayName = (dl.getTime() - now.getTime()) > 36 * 3600000 ? DAY_NAMES[(dl.getDay() + 6) % 7].toLowerCase() : dayLabel(dl);
        meta.push(`Klar senest ${dayName} kl. ${fmtTime(dl)} til ${plan.target_soc} %${plan.enough_time ? "" : " – ikke nok tid, lader hele vejen"}`);
      } else {
        meta.push("Ingen aktiv dag i ugeplanen – lader kun fra sol, prisgrænse eller Lad nu");
      }
      if (rt.charging) meta.push("Lader lige nu");
      else if (plan.next_start) {
        const ns = new Date(plan.next_start);
        meta.push(`Næste planlagte ladning ${dayLabel(ns)} kl. ${fmtTime(ns)}`);
      }
    }
    if (rt.plugged === false) meta.push("Bilen er ikke tilsluttet");
    if (rt.source_today) meta.push(`Kilde i dag: ${ElectricityOptimizerPanel.SOURCE_TEXT[rt.source_today] || rt.source_today}`);
    const liveW = car.power_entity ? (() => { const p = this._numState(car.power_entity); const kw = ElectricityOptimizerPanel._toKw(p.value, p.unit); return kw === null ? null : kw * 1000; })() : null;
    if (rt.charging) {
      const parts = [];
      if (rt.amps) parts.push(`${rt.amps} A`);
      if (liveW !== null) parts.push(`${fmtNum(liveW, 0)} W`);
      meta.push(`${rt.mode === "solar" ? "Lader fra sol" : "Lader"}${parts.length ? " med " + parts.join(" · ") : ""}`);
    } else if (liveW !== null && liveW > 50) {
      meta.push(`Bilen trækker ${fmtNum(liveW, 0)} W`);
    }
    if (rt.status === "solar_wait" && rt.surplus_w !== undefined) meta.push(`Sol-overskud lige nu ${fmtNum(rt.surplus_w, 0)} W – kræver ${car.min_amps * 230 * car.phases} W`);
    if (rt.last_action) {
      const la = rt.last_action;
      meta.push(`Sidste kommando: ${la.action === "start" ? "start" : "stop"} kl. ${fmtTime(new Date(la.at))}${la.ok ? "" : ` – fejlede: ${la.error || ""}`}`);
    }
    const socPct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
    return `
      <div class="card" data-car="${car.id}">
        <h2><ha-icon icon="mdi:car-electric"></ha-icon>${esc(car.name)} <span class="hint" style="font-weight:400">#${index + 1}</span> <span class="badge ${statusCls}" style="margin-left:auto">${statusText}</span></h2>
        <div class="kpi">
          <div class="value">${soc === null ? "–" : fmtNum(soc, 0) + " %"}<small>mål ${plan && plan.target_soc ? plan.target_soc : car.target_soc} %</small></div>
        </div>
        <div class="soc-bar"><div class="fill ${rt.charging ? "charging" : ""}" style="width:${socPct}%"></div><div class="target" style="left:${car.target_soc}%"></div></div>
        <div class="car-meta">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>
        ${plan ? this._renderPlanStrip(plan) : ""}
        <div class="controls">
          <label class="toggle"><input type="checkbox" data-field="enabled" ${car.enabled ? "checked" : ""}> Smart opladning</label>
          <label class="field">Prisgrænse (kr/kWh)<input type="number" step="0.01" data-field="price_limit" value="${car.price_limit === null || car.price_limit === undefined ? "" : car.price_limit}" placeholder="fra"></label>
          <label class="field">Min. ladestrøm (A)<input type="number" min="1" max="64" step="1" data-field="min_amps" value="${car.min_amps}"></label>
          <label class="field">Maks. ladestrøm (A)<input type="number" min="1" max="64" step="1" data-field="max_amps" value="${car.max_amps}"></label>
        </div>
        ${this._renderSchedule(car)}
        <div class="row" style="margin-top:12px">
          <button class="btn ${car.charge_now ? "active" : ""}" data-action="charge-now">${car.charge_now ? "Stop 'Lad nu'" : "Lad nu"}</button>
          <button class="btn" data-action="edit-car">Rediger</button>
          <button class="btn danger" data-action="delete-car">Slet</button>
          ${total > 1 ? `<span class="seg" style="margin-left:auto"><button class="btn" data-action="move-up" ${index === 0 ? "disabled" : ""} title="Højere prioritet">▲</button><button class="btn" data-action="move-down" ${index === total - 1 ? "disabled" : ""} title="Lavere prioritet">▼</button></span>` : ""}
        </div>
      </div>`;
  }

  _renderSchedule(car) {
    const sched = Array.isArray(car.schedule) && car.schedule.length === 7 ? car.schedule : DAY_NAMES.map(() => ({ enabled: true, source: car.source, ready_by: car.ready_by, target_soc: car.target_soc }));
    const today = (new Date().getDay() + 6) % 7;
    const sourceSel = (value) => `<select data-sched="source">${Object.entries(ElectricityOptimizerPanel.SOURCE_TEXT).map(([v, l]) => `<option value="${v}" ${(value || car.source) === v ? "selected" : ""}>${l}</option>`).join("")}</select>`;
    const row = (label, cls, day, e) => `
      <tr class="${cls}${e.enabled || cls === "all" ? "" : " off"}" data-day="${day}">
        <td>${label}</td>
        <td><input type="checkbox" data-sched="enabled" ${e.enabled ? "checked" : ""} title="Skal bilen være klar denne dag?"></td>
        <td>${sourceSel(e.source)}</td>
        <td>${timeInput('data-sched="ready_by"', e.ready_by)}</td>
        <td><input type="number" min="1" max="100" step="1" data-sched="target_soc" value="${e.target_soc}"></td>
      </tr>`;
    return `
      <div class="sched-wrap">
        <h3>Ugeplan</h3>
        <table class="sched">
          <thead><tr><th>Dag</th><th>Til</th><th>Kilde</th><th>Klar senest</th><th>Mål-SoC %</th></tr></thead>
          <tbody>
            ${row("Alle dage", "all", "all", { enabled: sched.every((e) => e.enabled), source: sched[0].source, ready_by: sched[0].ready_by, target_soc: sched[0].target_soc })}
            ${sched.map((e, i) => row(DAY_NAMES[i], i === today ? "today" : "", i, e)).join("")}
          </tbody>
        </table>
        <div class="hint">Slå en dag fra, hvis bilen ikke skal være klar den morgen – så planlægges der frem mod næste aktive dag. Kilde: "Kun sol" lader kun på overskud den dag, "Kun billige timer" bruger kun planen, "Sol + billige timer" begge. "Alle dage" sætter alle syv.</div>
      </div>`;
  }

  _readScheduleFromCard(card) {
    const rows = [...card.querySelectorAll("table.sched tbody tr[data-day]")].filter((r) => r.dataset.day !== "all");
    return rows.map((r) => ({
      enabled: r.querySelector('[data-sched="enabled"]').checked,
      source: r.querySelector('[data-sched="source"]').value,
      ready_by: normalizeTime(r.querySelector('[data-sched="ready_by"]').value) || "07:00",
      target_soc: Number(r.querySelector('[data-sched="target_soc"]').value) || 80,
    }));
  }

  _renderPlanStrip(plan) {
    const slots = plan.plan || [];
    if (!slots.length) return "";
    const t0 = Math.min(Date.now(), new Date(slots[0].start).getTime());
    const t1 = new Date(slots[slots.length - 1].end).getTime();
    const W = 600, H = 34, barH = 18;
    const x = (t) => ((t - t0) / (t1 - t0)) * W;
    const now = Date.now();
    const rects = slots
      .map((s) => {
        const a = new Date(s.start).getTime(), b = new Date(s.end).getTime();
        const isNow = a <= now && now < b;
        return `<rect class="slot ${s.chosen ? "chosen" : ""} ${s.estimated ? "est" : ""} ${isNow ? "now" : ""}" x="${x(a).toFixed(1)}" y="0" width="${Math.max(0.5, x(b) - x(a) - 0.5).toFixed(1)}" height="${barH}" rx="2"><title>${fmtTime(new Date(a))} ${fmtNum(s.price)}${s.estimated ? " (estimat)" : ""}</title></rect>`;
      })
      .join("");
    const labels = [];
    for (const s of slots) {
      const d = new Date(s.start);
      if (d.getMinutes() === 0 && d.getHours() % 6 === 0) {
        labels.push(`<text class="tick" x="${x(d.getTime()).toFixed(1)}" y="${H - 2}">${pad2(d.getHours())}</text>`);
      }
    }
    return `<svg class="plan-strip" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}${labels.join("")}</svg>
      <div class="hint">Grøn = planlagt ladning · nedtonet = pris endnu ukendt (estimat)</div>`;
  }

  _renderCarForm(car) {
    const v = (k, d = "") => esc(car[k] === undefined || car[k] === null ? d : car[k]);
    const isNew = !car.id;
    const errText = {
      name_required: "Navn mangler.",
      soc_required: "Vælg en SoC-sensor.",
      start_stop_required: "Vælg både start- og stop-entitet.",
      capacity_power_positive: "Kapacitet og ladestrøm skal være større end 0.",
      current_entity_number: "Strømgrænse-entiteten skal være en number- eller input_number-entitet.",
      ready_by_invalid: "Ugyldigt klokkeslæt.",
    };
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:car-electric"></ha-icon>${isNew ? "Tilføj bil" : `Rediger ${esc(car.name)}`}</h2>
        <form class="car-form" data-id="${v("id")}">
          <div class="fields">
            <label class="field">Navn<input name="name" value="${v("name")}" placeholder="fx Tesla" required></label>
            ${isNew ? `<label class="field">Klar senest (alle dage, kan ændres pr. dag bagefter)${timeInput('name="ready_by"', car.ready_by || "07:00")}</label>
            <label class="field">Mål-SoC % (alle dage)<input name="target_soc" type="number" min="1" max="100" value="${v("target_soc", 80)}"></label>` : ""}
            <label class="field">SoC-sensor (%)<div class="picker"><input name="soc_entity" data-domains="sensor" value="${v("soc_entity")}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            ${this._cmdFields("Start opladning", "start_entity", "start_value", v)}
            ${this._cmdFields("Stop opladning", "stop_entity", "stop_value", v)}
            <label class="field">Tilsluttet-sensor (valgfri)<div class="picker"><input name="plugged_entity" data-domains="binary_sensor" value="${v("plugged_entity")}" placeholder="binary_sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Batterikapacitet (kWh)<input name="capacity_kwh" type="number" step="0.1" min="1" value="${v("capacity_kwh", 60)}"></label>
            <label class="field">Min. ladestrøm (A)<input name="min_amps" type="number" step="1" min="1" max="64" value="${v("min_amps", 6)}"></label>
            <label class="field">Maks. ladestrøm (A)<input name="max_amps" type="number" step="1" min="1" max="64" value="${v("max_amps", 16)}"></label>
            <label class="field">Kilde (alle dage, kan ændres pr. dag bagefter)<select name="source">${Object.entries(ElectricityOptimizerPanel.SOURCE_TEXT).map(([val, l]) => `<option value="${val}" ${(car.source || "solar_plan") === val ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            <label class="field">Ladeeffekt-sensor (W, valgfri)<div class="picker"><input name="power_entity" data-domains="sensor" value="${v("power_entity")}" placeholder="sensor.… bilens/laderens effekt" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Faser<select name="phases">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(car.phases || 3) === n ? "selected" : ""}>${n} fase${n > 1 ? "r" : ""}</option>`).join("")}</select></label>
            <label class="field">Laderens strøm-entitet (number, valgfri) – ladestrømmen i A sendes hertil<div class="picker"><input name="current_entity" data-domains="number,input_number" value="${v("current_entity")}" placeholder="number.… fx laderens 'charger current limit'" autocomplete="off"><div class="picker-list" hidden></div></div></label>
          </div>
          <div class="hint" style="margin-top:10px">${ElectricityOptimizerPanel.CMD_HINT} Maks. ladestrøm × 230 V × faser er effekten, planen regner med. Ved solopladning justeres strømgrænse-entiteten løbende mellem min. og maks. efter overskuddet; uden strømgrænse-entitet startes solopladning kun, når overskuddet dækker maks. ladestrøm. Ladeeffekt-sensoren bruges til at vise og regne med bilens faktiske forbrug.</div>
          ${this._formError ? `<div class="err">${esc(errText[this._formError] || this._formError)}</div>` : ""}
          <div class="row" style="margin-top:14px">
            <button class="btn primary" type="submit" data-action="save-car">Gem</button>
            <button class="btn" type="button" data-action="cancel-car">Annuller</button>
          </div>
        </form>
      </div>`;
  }

  _entityMatches(domains, query) {
    const q = (query || "").toLowerCase();
    const doms = domains.split(",");
    const out = [];
    for (const id of Object.keys(this._hass.states)) {
      const dom = id.split(".")[0];
      if (!doms.includes(dom)) continue;
      const name = (this._hass.states[id].attributes.friendly_name || "").toLowerCase();
      if (q && !id.toLowerCase().includes(q) && !name.includes(q)) continue;
      out.push(id);
      if (out.length >= 40) break;
    }
    return out.sort();
  }

  _onContentInput(ev) {
    const input = ev.target;
    if (!input.matches || !input.matches("input[data-domains]")) return;
    const list = input.parentElement.querySelector(".picker-list");
    const ids = this._entityMatches(input.dataset.domains, input.value);
    list.innerHTML = ids
      .map((id) => `<div data-pick="${esc(id)}">${esc(id)}<small>${esc(this._hass.states[id].attributes.friendly_name || "")}</small></div>`)
      .join("");
    list.hidden = ids.length === 0;
  }

  async _onContentChange(ev) {
    const input = ev.target;
    if (input.dataset && input.dataset.time !== undefined) {
      const t = normalizeTime(input.value);
      input.value = t || input.defaultValue; // invalid -> keep the previous value
    }
    if (input.dataset && input.dataset.bsched) {
      const card = input.closest("[data-battery]");
      const tr = input.closest("tr");
      if (tr.dataset.bday === "all") {
        for (const r of card.querySelectorAll("table.sched tbody tr[data-bday]")) {
          if (r.dataset.bday === "all") continue;
          const target = r.querySelector(`[data-bsched="${input.dataset.bsched}"]`);
          if (input.type === "checkbox") target.checked = input.checked;
          else target.value = input.value;
        }
      }
      try {
        await this._saveBattery({ schedule: this._readBatterySchedule(card) });
        this._batteryError = null;
      } catch (err) {
        this._batteryError = err && err.message ? err.message : String(err);
      }
      this._maybeRender(true);
      return;
    }
    if (input.dataset && input.dataset.rfield) {
      const field = input.dataset.rfield;
      const value = input.type === "checkbox" ? input.checked : input.value;
      try {
        await this._saveRules({ [field]: value });
        this._rulesError = null;
      } catch (err) {
        this._rulesError = err && err.message ? err.message : String(err);
      }
      this._maybeRender(true);
      return;
    }
    if (input.dataset && input.dataset.bfield) {
      const field = input.dataset.bfield;
      const value = input.type === "checkbox" ? input.checked : input.value;
      try {
        await this._saveBattery({ [field]: value });
        this._batteryError = null;
      } catch (err) {
        this._batteryError = err && err.message ? err.message : String(err);
      }
      this._maybeRender(true);
      return;
    }
    const card = input.closest && input.closest("[data-car]");
    if (card && input.dataset.sched) {
      const tr = input.closest("tr");
      if (tr.dataset.day === "all") {
        for (const r of card.querySelectorAll("table.sched tbody tr[data-day]")) {
          if (r.dataset.day === "all") continue;
          const target = r.querySelector(`[data-sched="${input.dataset.sched}"]`);
          if (input.type === "checkbox") target.checked = input.checked;
          else target.value = input.value;
        }
      }
      const schedule = this._readScheduleFromCard(card);
      try {
        await this._saveCar({ id: card.dataset.car, schedule });
      } catch (err) {
        this._carsError = err && err.message ? err.message : String(err);
        this._maybeRender(true);
      }
      return;
    }
    if (!card || !input.dataset.field) return;
    const field = input.dataset.field;
    let value;
    if (input.type === "checkbox") value = input.checked;
    else if (field === "price_limit") value = input.value === "" ? null : Number(input.value);
    else if (field === "target_soc" || field === "min_amps" || field === "max_amps") value = Number(input.value);
    else value = input.value;
    try {
      await this._saveCar({ id: card.dataset.car, [field]: value });
    } catch (err) {
      this._carsError = err && err.message ? err.message : String(err);
      this._maybeRender(true);
    }
  }

  async _onContentClick(ev) {
    const goto = ev.target.closest && ev.target.closest("[data-goto]");
    if (goto) {
      ev.preventDefault();
      this._tab = goto.dataset.goto;
      try {
        localStorage.setItem("electricity_optimizer_tab", this._tab);
      } catch (_) {
        /* ignore */
      }
      this._maybeRender(true);
      return;
    }
    const pick = ev.target.closest && ev.target.closest("[data-pick]");
    if (pick) {
      const input = pick.closest(".picker").querySelector("input");
      input.value = pick.dataset.pick;
      pick.parentElement.hidden = true;
      return;
    }
    const bbtn = ev.target.closest && ev.target.closest("[data-baction]");
    if (bbtn) {
      await this._onBatteryClick(bbtn, ev);
      return;
    }
    const rbtn = ev.target.closest && ev.target.closest("[data-raction]");
    if (rbtn) {
      await this._onRulesClick(rbtn, ev);
      return;
    }
    const btn = ev.target.closest && ev.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const card = btn.closest("[data-car]");
    const carId = card ? card.dataset.car : null;
    const car = carId && this._cars ? this._cars.find((c) => c.id === carId) : null;
    try {
      if (action === "add-car") {
        this._editing = {};
        this._formError = null;
        this._maybeRender(true);
      } else if (action === "edit-car" && car) {
        this._editing = { ...car };
        this._formError = null;
        this._maybeRender(true);
      } else if (action === "cancel-car") {
        this._editing = null;
        this._formError = null;
        this._maybeRender(true);
      } else if (action === "save-car") {
        ev.preventDefault();
        const form = btn.closest("form");
        const data = {};
        for (const el of form.querySelectorAll("input[name],select[name]")) data[el.name] = el.value;
        if (data.ready_by !== undefined) data.ready_by = normalizeTime(data.ready_by) || "07:00";
        if (form.dataset.id) data.id = form.dataset.id;
        try {
          await this._saveCar(data);
          this._editing = null;
          this._formError = null;
        } catch (err) {
          this._formError = (err && (err.message || err.code)) || String(err);
          // keep the typed values
          this._editing = { ...this._editing, ...data };
        }
        this._maybeRender(true);
      } else if (action === "delete-car" && car) {
        if (!window.confirm(`Slet ${car.name}?`)) return;
        await this._hass.callWS({ type: "electricity_optimizer/cars/delete", car_id: car.id });
        await this._loadCars(true);
        this._maybeRender(true);
      } else if (action === "charge-now" && car) {
        await this._saveCar({ id: car.id, charge_now: !car.charge_now });
        this._maybeRender(true);
      } else if ((action === "move-up" || action === "move-down") && car) {
        await this._hass.callWS({ type: "electricity_optimizer/cars/move", car_id: car.id, direction: action === "move-up" ? "up" : "down" });
        await this._loadCars(true);
        this._maybeRender(true);
      }
    } catch (err) {
      this._carsError = err && err.message ? err.message : String(err);
      this._maybeRender(true);
    }
  }

  static CMD_HINT =
    "Start: switch/input_boolean tændes, button trykkes, script/automation køres, select får valgt værdien, number sættes til værdien. " +
    "Stop: er det samme switch som start, slukkes den – ellers udføres stop-kommandoen på samme måde. Brug samme entitet begge steder, hvis der kun er én switch.";

  static CMD_DOMAINS = "switch,button,script,input_boolean,automation,select,input_select,number,input_number";

  _cmdFields(label, entityKey, valueKey, v) {
    return `
      <div class="field">${label}
        <div class="cmd">
          <div class="picker"><input name="${entityKey}" data-domains="${ElectricityOptimizerPanel.CMD_DOMAINS}" value="${v(entityKey)}" placeholder="entitet" autocomplete="off"><div class="picker-list" hidden></div></div>
          <input name="${valueKey}" value="${v(valueKey)}" placeholder="værdi (select/number)">
        </div>
      </div>`;
  }

  /* ---------- battery ---------- */

  async _loadBattery(force = false) {
    if (!this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (!force && this._batteryLoadedAt && now - this._batteryLoadedAt < 2500) return;
    if (this._batteryLoading) return;
    this._batteryLoading = true;
    try {
      const res = await this._hass.callWS({ type: "electricity_optimizer/battery/get" });
      this._batteryLoadedAt = Date.now();
      this._batteryError = null;
      this._applyBattery(res);
    } catch (err) {
      this._batteryError = err && err.message ? err.message : String(err);
      if (this._battery === undefined) this._battery = null;
    } finally {
      this._batteryLoading = false;
    }
  }

  _applyBattery(res) {
    const battery = res.battery || null;
    const runtime = res.runtime || {};
    const json = JSON.stringify([battery, runtime]);
    if (json === this._batteryJson) return;
    this._battery = battery;
    this._batteryRuntime = runtime;
    this._batteryJson = json;
    this._batteryStamp = Date.now();
    this._maybeRender();
  }

  async _saveBattery(patch) {
    const res = await this._hass.callWS({ type: "electricity_optimizer/battery/save", battery: patch });
    this._batteryLoadedAt = Date.now();
    this._applyBattery(res);
    return res;
  }

  _readBatteryLive() {
    const b = this._battery || {};
    const soc = this._numState(b.soc_entity).value;
    let batW = null;
    if (b.power_entity) {
      const p = this._numState(b.power_entity);
      batW = ElectricityOptimizerPanel._toKw(p.value, p.unit);
      if (batW !== null) batW = batW * 1000 * (b.power_sign === "discharge_positive" ? -1 : 1);
    } else if (b.charge_power_entity || b.discharge_power_entity) {
      const c = this._numState(b.charge_power_entity), d = this._numState(b.discharge_power_entity);
      const ck = ElectricityOptimizerPanel._toKw(c.value, c.unit), dk = ElectricityOptimizerPanel._toKw(d.value, d.unit);
      if (ck !== null || dk !== null) batW = ((ck || 0) - (dk || 0)) * 1000;
    }
    let gridW = null;
    if (b.grid_power_entity) {
      const g = this._numState(b.grid_power_entity);
      gridW = ElectricityOptimizerPanel._toKw(g.value, g.unit);
      if (gridW !== null) gridW = gridW * 1000 * (b.grid_sign === "export_positive" ? -1 : 1);
    }
    let houseW = null;
    if (b.house_power_entity) {
      const h = this._numState(b.house_power_entity);
      houseW = ElectricityOptimizerPanel._toKw(h.value, h.unit);
      if (houseW !== null) houseW *= 1000;
    }
    return { soc, batW, gridW, houseW };
  }

  static MODE_TEXT = {
    normal: ["Normal", "neutral", "Batteriet lader fra sol og forsyner huset"],
    hold: ["Hold", "info", "Batteriet spares til dyrere timer senere"],
    charge: ["Lader fra nettet", "low", "Strømmen er billig nu i forhold til senere"],
  };

  _renderBatteryStatusRow() {
    const b = this._battery;
    if (!b) {
      return `<div class="status-row"><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">Ikke sat op – se fanen Hus batteri</div></div><span class="badge neutral">Ikke sat op</span></div>`;
    }
    const live = this._readBatteryLive();
    const rt = this._batteryRuntime || {};
    const [modeText, modeCls] = ElectricityOptimizerPanel.MODE_TEXT[rt.mode] || ["–", "neutral"];
    const parts = [];
    if (live.soc !== null) parts.push(`${fmtNum(live.soc, 0)} %`);
    if (live.batW !== null) parts.push(live.batW >= 0 ? `lader ${fmtNum(live.batW, 0)} W` : `aflader ${fmtNum(-live.batW, 0)} W`);
    let grid = "";
    if (live.gridW !== null) {
      grid = `<div class="status-row"><ha-icon icon="mdi:transmission-tower"></ha-icon><div class="t"><div class="n">Elnet</div><div class="d">${
        live.gridW >= 0 ? `Køber ${fmtNum(live.gridW, 0)} W` : `Sælger ${fmtNum(-live.gridW, 0)} W`
      }${live.houseW !== null ? ` · huset bruger ${fmtNum(live.houseW, 0)} W` : ""}</div></div><span class="badge ${live.gridW > 0 ? "mid" : "low"}">${live.gridW > 0 ? "Import" : "Eksport"}</span></div>`;
    }
    return `<div class="status-row"><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">${esc(parts.join(" · ") || "Ingen data")}</div></div><span class="badge ${modeCls}">${modeText}</span></div>${grid}`;
  }

  _renderBattery() {
    if (this._battery === undefined) {
      return `<div class="card"><div class="empty"><ha-icon icon="mdi:timer-sand"></ha-icon>Henter batteri…</div></div>`;
    }
    if (this._battery === null) this._editingBattery = true;
    if (this._editingBattery) return this._renderBatteryForm(this._battery || this._pendingBatteryForm || {});
    const b = this._battery;
    const rt = this._batteryRuntime || {};
    const live = this._readBatteryLive();
    const plan = rt.plan || null;
    const mode = rt.mode || "normal";
    const [modeText, modeCls, modeWhy] = ElectricityOptimizerPanel.MODE_TEXT[mode] || ["–", "neutral", ""];
    const statusNote = {
      no_soc: "SoC-sensoren har ingen værdi",
      no_prices: "Ingen priser fra EnergiDataService",
      disabled: "Smart styring er slået fra",
      override: "Manuel styring – tryk Auto for at følge planen",
      full: "Batteriet er fyldt til maks-SoC",
      ev_hold: "Holdes, fordi en elbil lader fra nettet (regel)",
      day_off: "Slået fra i ugeplanen i dag – batteriet kører selv",
      fuse_wait: "Venter – hovedsikringen er optaget af elbil (regel)",
      auto: modeWhy,
    }[rt.status] || "";
    const cmds = rt.commands_configured || {};
    const socPct = live.soc === null ? 0 : Math.max(0, Math.min(100, live.soc));
    const why = plan
      ? [
          plan.current_price !== null ? `Pris nu ${fmtNum(plan.current_price)}` : "",
          plan.day_mean !== null && plan.day_mean !== undefined ? `dagens gennemsnit ${fmtNum(plan.day_mean)}` : "",
          plan.later_max !== null && plan.later_max !== undefined ? `dyreste senere ${fmtNum(plan.later_max)}` : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    const la = rt.last_action;
    const laText = la
      ? `Sidste kommando kl. ${fmtTime(new Date(la.at))}: ${la.ok ? (la.sent && la.sent.length ? la.sent.join(", ") : "ingen entiteter at sende til") : `fejlede – ${la.error || ""}`}`
      : "";

    return `
      <div class="grid">
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:home-battery"></ha-icon>Batteri</div>
          <div class="value">${live.soc === null ? "–" : fmtNum(live.soc, 0) + " %"}<small>${fmtNum(b.capacity_kwh, 1)} kWh · reserve ${b.min_soc} %</small></div>
          <div class="soc-bar"><div class="fill ${live.batW > 0 ? "charging" : ""}" style="width:${socPct}%"></div><div class="target" style="left:${b.min_soc}%"></div></div>
          <div class="sub">${live.batW === null ? "Ingen effekt-sensor" : live.batW >= 0 ? `Lader med ${fmtNum(live.batW, 0)} W` : `Aflader med ${fmtNum(-live.batW, 0)} W`}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:state-machine"></ha-icon>Modus lige nu</div>
          <div class="value"><span class="badge ${modeCls}" style="font-size:16px;padding:4px 14px">${modeText}</span></div>
          <div class="sub">${esc(statusNote)}</div>
          <div class="sub">${esc(why)}</div>
        </div>
        <div class="card">
          <h2><ha-icon icon="mdi:swap-vertical"></ha-icon>Energiflow</h2>
          <div class="flow">
            <div class="item ${live.gridW > 0 ? "in" : "out"}"><ha-icon icon="mdi:transmission-tower"></ha-icon><div><div class="v">${live.gridW === null ? "–" : fmtNum(Math.abs(live.gridW), 0) + " W"}</div><div class="l">${live.gridW === null ? "Elnet" : live.gridW > 0 ? "Køber fra nettet" : "Sælger til nettet"}</div></div></div>
            <div class="item"><ha-icon icon="mdi:home-lightning-bolt"></ha-icon><div><div class="v">${live.houseW === null ? "–" : fmtNum(live.houseW, 0) + " W"}</div><div class="l">Husforbrug</div></div></div>
            <div class="item ${live.batW > 0 ? "out" : live.batW < 0 ? "in" : ""}"><ha-icon icon="mdi:battery-charging"></ha-icon><div><div class="v">${live.batW === null ? "–" : fmtNum(Math.abs(live.batW), 0) + " W"}</div><div class="l">${live.batW === null ? "Batteri" : live.batW >= 0 ? "Batteri lader" : "Batteri aflader"}</div></div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2><ha-icon icon="mdi:chart-timeline"></ha-icon>Plan</h2>
        ${plan ? this._renderBatteryPlanStrip(plan) : '<div class="hint">Ingen plan endnu.</div>'}
        <div class="legend"><span class="l-normal">Normal</span><span class="l-hold">Hold</span><span class="l-charge">Lad fra nettet</span></div>
        <div class="row" style="margin-top:12px">
          <span class="hint">Manuel:</span>
          <span class="seg">
            <button class="btn ${b.override === "auto" ? "active" : ""}" data-baction="override" data-value="auto">Auto</button>
            <button class="btn ${b.override === "normal" ? "active" : ""}" data-baction="override" data-value="normal">Normal</button>
            <button class="btn ${b.override === "hold" ? "active" : ""}" data-baction="override" data-value="hold" ${cmds.hold ? "" : "disabled"}>Hold nu</button>
            <button class="btn ${b.override === "charge" ? "active" : ""}" data-baction="override" data-value="charge" ${cmds.charge ? "" : "disabled"}>Lad fra net nu</button>
          </span>
        </div>
        ${!cmds.hold && !cmds.charge ? '<div class="hint" style="margin-top:8px">Ingen styringskommandoer er sat op – planen vises kun. Tryk Rediger for at tilføje.</div>' : ""}
        ${laText ? `<div class="hint" style="margin-top:8px">${esc(laText)}</div>` : ""}
      </div>

      <div class="card" data-battery>
        <h2><ha-icon icon="mdi:tune"></ha-icon>Indstillinger <button class="btn" style="margin-left:auto" data-baction="edit">Rediger sensorer og kommandoer</button></h2>
        <div class="controls">
          <label class="toggle"><input type="checkbox" data-bfield="enabled" ${b.enabled ? "checked" : ""}> Smart styring</label>
          <label class="field">Prisforskel (kr/kWh)<input type="number" step="0.05" min="0" data-bfield="spread_threshold" value="${b.spread_threshold}"></label>
          <label class="field">Reserve-SoC (%)<input type="number" min="0" max="100" data-bfield="min_soc" value="${b.min_soc}"></label>
          <label class="field">Maks-SoC ved netopladning (%)<input type="number" min="0" max="100" data-bfield="max_soc" value="${b.max_soc}"></label>
          <label class="field">Virkningsgrad (0–1)<input type="number" step="0.01" min="0.5" max="1" data-bfield="efficiency" value="${b.efficiency}"></label>
          <label class="field">Lad kun fra net hvis solprognose &lt; (kWh)<input type="number" step="0.5" min="0" data-bfield="grid_charge_max_forecast_kwh" value="${b.grid_charge_max_forecast_kwh === null || b.grid_charge_max_forecast_kwh === undefined ? "" : b.grid_charge_max_forecast_kwh}" placeholder="fra"></label>
        </div>
        ${this._renderForecastRuleHint(plan)}
        <div class="hint" style="margin-top:8px">Hold: prisen er under dagens gennemsnit, og en senere time er mindst prisforskellen dyrere. Lad fra nettet: kun på dage hvor det er tilladt, og kun når de dyreste timer bagefter (ganget med virkningsgraden) er mindst prisforskellen dyrere end nu – eller når ugeplanens mål-SoC skal nås inden klokkeslættet.</div>
        ${this._renderBatterySchedule(b, plan)}
        ${this._batteryError ? `<div class="err">${esc(this._batteryError)}</div>` : ""}
      </div>`;
  }

  _renderForecastRuleHint(plan) {
    const fc = plan && plan.forecast;
    if (!fc || fc.limit === null || fc.limit === undefined) return "";
    const hasEntity = !!(this._config.solar_forecast_today_entity || this._config.solar_forecast_tomorrow_entity);
    if (!hasEntity) {
      return `<div class="hint" style="margin-top:6px">Prognose-reglen er sat, men der er ikke valgt nogen solprognose-sensor under Indstillinger → Enheder og tjenester → Electricity Optimizer → Konfigurer. Reglen har derfor ingen effekt.</div>`;
    }
    const part = (label, v, blocked) => (v === null || v === undefined ? `${label}: ingen prognose` : `${label}: ${fmtNum(v, 1)} kWh → ${blocked ? "ingen netopladning" : "netopladning tilladt"}`);
    return `<div class="hint" style="margin-top:6px">Solprognose-regel (grænse ${fmtNum(fc.limit, 1)} kWh): ${part("i dag", fc.today, fc.blocked_today)} · ${part("i morgen", fc.tomorrow, fc.blocked_tomorrow)}.</div>`;
  }

  _renderBatterySchedule(b, plan) {
    const sched = Array.isArray(b.schedule) && b.schedule.length === 7 ? b.schedule : DAY_NAMES.map(() => ({ enabled: true, grid_charge: !!b.grid_charge_enabled, ready_by: "17:00", target_soc: null }));
    const today = (new Date().getDay() + 6) % 7;
    const row = (label, cls, day, e) => `
      <tr class="${cls}${e.enabled || cls === "all" ? "" : " off"}" data-bday="${day}">
        <td>${label}</td>
        <td><input type="checkbox" data-bsched="enabled" ${e.enabled ? "checked" : ""} title="Smart styring denne dag"></td>
        <td><select data-bsched="grid_charge" title="Kilde denne dag"><option value="solar" ${e.grid_charge ? "" : "selected"}>Kun sol</option><option value="solar_grid" ${e.grid_charge ? "selected" : ""}>Sol + billige timer</option></select></td>
        <td>${timeInput('data-bsched="ready_by"', e.ready_by)}</td>
        <td><input type="number" min="1" max="100" step="1" data-bsched="target_soc" value="${e.target_soc === null || e.target_soc === undefined ? "" : e.target_soc}" placeholder="–"></td>
      </tr>`;
    const dl = plan && plan.deadline ? new Date(plan.deadline) : null;
    const next = dl
      ? `Næste mål: ${plan.target_soc} % senest ${DAY_NAMES[(dl.getDay() + 6) % 7].toLowerCase()} kl. ${fmtTime(dl)}${plan.target_hours ? ` (ca. ${fmtNum(plan.target_hours, 1)} t netopladning)` : ""}`
      : "Intet mål-SoC sat – kun prisforskel-reglen lader fra nettet";
    return `
      <div class="sched-wrap">
        <h3>Ugeplan</h3>
        <table class="sched">
          <thead><tr><th>Dag</th><th>Til</th><th>Kilde</th><th>Fuldt senest</th><th>Mål-SoC %</th></tr></thead>
          <tbody>
            ${row("Alle dage", "all", "all", { enabled: sched.every((e) => e.enabled), grid_charge: sched.every((e) => e.grid_charge), ready_by: sched[0].ready_by, target_soc: sched[0].target_soc })}
            ${sched.map((e, i) => row(DAY_NAMES[i], i === today ? "today" : "", i, e)).join("")}
          </tbody>
        </table>
        <div class="hint">Til: smart styring den dag. Kilde: "Kun sol" lader aldrig fra nettet den dag; "Sol + billige timer" må lade fra nettet efter prisforskel-reglen og mål-SoC. Mål-SoC (valgfrit): batteriet fyldes til dette niveau i de billigste timer inden klokkeslættet – fx 100 % senest kl. 17 før aftenens dyre timer. ${esc(next)}</div>
      </div>`;
  }

  _readBatterySchedule(card) {
    const rows = [...card.querySelectorAll("table.sched tbody tr[data-bday]")].filter((r) => r.dataset.bday !== "all");
    return rows.map((r) => ({
      enabled: r.querySelector('[data-bsched="enabled"]').checked,
      grid_charge: r.querySelector('[data-bsched="grid_charge"]').value === "solar_grid",
      ready_by: normalizeTime(r.querySelector('[data-bsched="ready_by"]').value) || "17:00",
      target_soc: r.querySelector('[data-bsched="target_soc"]').value === "" ? null : Number(r.querySelector('[data-bsched="target_soc"]').value),
    }));
  }

  _renderBatteryPlanStrip(plan) {
    const slots = plan.plan || [];
    if (!slots.length) return "";
    const t0 = Math.min(Date.now(), new Date(slots[0].start).getTime());
    const t1 = new Date(slots[slots.length - 1].end).getTime();
    const W = 600, H = 34, barH = 18;
    const x = (t) => ((t - t0) / (t1 - t0)) * W;
    const now = Date.now();
    const rects = slots
      .map((s) => {
        const a = new Date(s.start).getTime(), b = new Date(s.end).getTime();
        const isNow = a <= now && now < b;
        const label = { normal: "Normal", hold: "Hold", charge: "Lad fra nettet" }[s.mode] || s.mode;
        return `<rect class="slot ${s.mode} ${isNow ? "now" : ""}" x="${x(a).toFixed(1)}" y="0" width="${Math.max(0.5, x(b) - x(a) - 0.5).toFixed(1)}" height="${barH}" rx="2"><title>${fmtTime(new Date(a))} ${fmtNum(s.price)} – ${label}</title></rect>`;
      })
      .join("");
    const labels = [];
    for (const s of slots) {
      const d = new Date(s.start);
      if (d.getMinutes() === 0 && d.getHours() % 6 === 0) labels.push(`<text class="tick" x="${x(d.getTime()).toFixed(1)}" y="${H - 2}">${pad2(d.getHours())}</text>`);
    }
    return `<svg class="plan-strip" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}${labels.join("")}</svg>`;
  }

  _renderBatteryForm(b) {
    const v = (k, d = "") => esc(b[k] === undefined || b[k] === null ? d : b[k]);
    const sel = (k, opts, d) => `<select name="${k}">${opts.map(([val, lab]) => `<option value="${val}" ${(b[k] || d) === val ? "selected" : ""}>${lab}</option>`).join("")}</select>`;
    const errText = {
      soc_required: "Vælg en SoC-sensor.",
      capacity_power_positive: "Kapacitet og effekter skal være større end 0.",
      charge_start_stop_both: "Angiv både start og stop for 'Lad fra nettet' (eller ingen af dem).",
      hold_start_stop_both: "Angiv både start og stop for 'Hold' (eller ingen af dem).",
    };
    const isNew = !this._battery;
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:home-battery"></ha-icon>${isNew ? "Sæt husbatteri op" : "Rediger husbatteri"}</h2>
        <form class="battery-form">
          <h3>Sensorer</h3>
          <div class="fields">
            <label class="field">Batteri-SoC (%)<div class="picker"><input name="soc_entity" data-domains="sensor" value="${v("soc_entity")}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Batteri-effekt (W, fortegn)<div class="picker"><input name="power_entity" data-domains="sensor" value="${v("power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Fortegn for batteri-effekt${sel("power_sign", [["charge_positive", "Positiv = lader"], ["discharge_positive", "Positiv = aflader"]], "charge_positive")}</label>
            <label class="field">…eller ladeeffekt (W)<div class="picker"><input name="charge_power_entity" data-domains="sensor" value="${v("charge_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">…og afladeeffekt (W)<div class="picker"><input name="discharge_power_entity" data-domains="sensor" value="${v("discharge_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Net import/eksport (W)<div class="picker"><input name="grid_power_entity" data-domains="sensor" value="${v("grid_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field">Fortegn for net${sel("grid_sign", [["import_positive", "Positiv = køber"], ["export_positive", "Positiv = sælger"]], "import_positive")}</label>
            <label class="field">Husforbrug (W)<div class="picker"><input name="house_power_entity" data-domains="sensor" value="${v("house_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
          </div>
          <h3>Batteri</h3>
          <div class="fields">
            <label class="field">Kapacitet (kWh)<input name="capacity_kwh" type="number" step="0.1" min="0.1" value="${v("capacity_kwh", 10)}"></label>
            <label class="field">Maks. ladeeffekt (kW)<input name="max_charge_kw" type="number" step="0.1" min="0.1" value="${v("max_charge_kw", 5)}"></label>
            <label class="field">Maks. afladeeffekt (kW)<input name="max_discharge_kw" type="number" step="0.1" min="0.1" value="${v("max_discharge_kw", 5)}"></label>
          </div>
          <h3>Lad fra nettet (valgfri)</h3>
          <div class="fields">
            ${this._cmdFields("Start", "charge_start_entity", "charge_start_value", v)}
            ${this._cmdFields("Stop", "charge_stop_entity", "charge_stop_value", v)}
          </div>
          <h3>Hold batteriet – ingen afladning (valgfri)</h3>
          <div class="fields">
            ${this._cmdFields("Start", "hold_start_entity", "hold_start_value", v)}
            ${this._cmdFields("Stop", "hold_stop_entity", "hold_stop_value", v)}
          </div>
          <div class="hint" style="margin-top:10px">${ElectricityOptimizerPanel.CMD_HINT} Eksempel med select: start = select.inverter_mode / "Charge", stop = select.inverter_mode / "Self-use".</div>
          ${this._batteryFormError ? `<div class="err">${esc(errText[this._batteryFormError] || this._batteryFormError)}</div>` : ""}
          <div class="row" style="margin-top:14px">
            <button class="btn primary" type="submit" data-baction="save">Gem</button>
            ${isNew ? "" : '<button class="btn" type="button" data-baction="cancel">Annuller</button>'}
            ${isNew ? "" : '<button class="btn danger" type="button" data-baction="delete">Fjern batteri</button>'}
          </div>
        </form>
      </div>`;
  }

  async _onBatteryClick(btn, ev) {
    const action = btn.dataset.baction;
    try {
      if (action === "edit") {
        this._editingBattery = true;
        this._batteryFormError = null;
        this._maybeRender(true);
      } else if (action === "cancel") {
        this._editingBattery = false;
        this._batteryFormError = null;
        this._maybeRender(true);
      } else if (action === "save") {
        ev.preventDefault();
        const form = btn.closest("form");
        const data = {};
        for (const el of form.querySelectorAll("input[name],select[name]")) data[el.name] = el.value;
        try {
          await this._saveBattery(data);
          this._editingBattery = false;
          this._batteryFormError = null;
          this._pendingBatteryForm = null;
        } catch (err) {
          this._batteryFormError = (err && (err.message || err.code)) || String(err);
          if (this._battery) this._battery = { ...this._battery, ...data };
          else this._pendingBatteryForm = data;
        }
        this._maybeRender(true);
      } else if (action === "delete") {
        if (!window.confirm("Fjern husbatteriet fra Electricity Optimizer?")) return;
        const res = await this._hass.callWS({ type: "electricity_optimizer/battery/delete" });
        this._applyBattery(res);
        this._editingBattery = true;
        this._pendingBatteryForm = null;
        this._maybeRender(true);
      } else if (action === "override") {
        await this._saveBattery({ override: btn.dataset.value });
        this._maybeRender(true);
      }
    } catch (err) {
      this._batteryError = err && err.message ? err.message : String(err);
      this._maybeRender(true);
    }
  }

}

if (!customElements.get("electricity-optimizer-panel")) {
  customElements.define("electricity-optimizer-panel", ElectricityOptimizerPanel);
}

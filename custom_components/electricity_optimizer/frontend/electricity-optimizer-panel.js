/*
 * Electricity Optimizer - Home Assistant sidebar panel.
 * Plain web component (no build step). Reads the EnergiDataService price
 * sensor straight from `hass.states` and renders an overview plus tabs for
 * EV charging and house battery settings.
 */

const PANEL_JS_VERSION = "0.30.8";

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
  { id: "history", label: "Historik", icon: "mdi:history" },
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
  .statusbar {
    display: flex; flex-wrap: wrap; gap: 8px; margin: -4px 0 12px;
  }
  .sb-item {
    display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 6px 12px 6px 10px; border-radius: 999px; cursor: pointer;
    background: var(--card-background-color, #fff);
    border: 1px solid var(--ha-card-border-color, var(--divider-color, #e0e0e0));
    font-size: 13px; color: var(--primary-text-color);
  }
  .sb-item ha-icon { --mdc-icon-size: 18px; color: var(--secondary-text-color); }
  .sb-item .sb-name { font-weight: 500; }
  .sb-item .sb-detail { color: var(--secondary-text-color); }
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
  .top { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 360px); gap: 12px; margin-bottom: 12px; align-items: stretch; }
  .top .card { margin-bottom: 0; }
  .gauges { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  @media (max-width: 1100px) {
    .top { grid-template-columns: 1fr; }
    .gauges { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
  }
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
  .gauge { display: block; width: 100%; max-width: 230px; margin: 0 auto; }
  .gauge .track { fill: none; stroke: var(--secondary-background-color, #eee); stroke-width: 13; stroke-linecap: round; }
  .gauge .arc { fill: none; stroke-width: 13; stroke-linecap: round; transition: d 300ms; }
  .gauge .dot { stroke: var(--card-background-color, #fff); stroke-width: 2.5; }
  .gauge .zero { stroke: var(--secondary-text-color); stroke-width: 1.5; opacity: 0.6; }
  .gauge .gv { font-size: 26px; font-weight: 500; fill: var(--primary-text-color); }
  .gauge .gu { font-size: 12px; font-weight: 400; fill: var(--secondary-text-color); }
  .gauge .gs { font-size: 12px; fill: var(--secondary-text-color); }
  .gauge .gt { font-size: 9px; fill: var(--secondary-text-color); }
  .batt .body { fill: var(--secondary-background-color, #eee); stroke: var(--secondary-text-color); stroke-width: 2; }
  .batt .nub { fill: var(--secondary-text-color); }
  .batt .fill { transition: width 400ms; }
  .batt .reserve { stroke: var(--secondary-text-color); stroke-width: 1.5; stroke-dasharray: 3 3; opacity: 0.8; }
  .batt .bv { font-size: 26px; font-weight: 500; fill: var(--primary-text-color); paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-width: 4px; stroke-linejoin: round; }
  .batt .bu { font-size: 12px; font-weight: 400; }
  .cars-batt { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
  .cb-row { display: flex; flex-direction: column; gap: 2px; }
  .cb-row .cb-name { min-width: 0; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; justify-content: space-between; gap: 8px; }
  .cb-row .cb-name small { font-size: 11px; color: var(--secondary-text-color); overflow: hidden; text-overflow: ellipsis; }
  .cb-row .batt { width: 100%; max-width: none; margin: 0; }
  .cb-row .batt .bv { font-size: 14px; stroke-width: 3px; }
  .cb-row .batt .bu { font-size: 9px; }
  .batt .bolt { fill: var(--primary-text-color); paint-order: stroke; stroke: var(--card-background-color, #fff); stroke-width: 2px; }
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
  .legend .l-car::before { background: var(--c); }
  .session { fill: #64b5f6; opacity: 0.28; }
  .session-edge { stroke: #1e88e5; stroke-width: 1.5; }
  .session-edge.est { stroke-dasharray: 4 3; }
  .session-label { font-size: 10px; font-weight: 500; fill: #1565c0; }
  .legend .l-session::before { background: #64b5f6; border: 1px solid #1e88e5; box-sizing: border-box; }
  .form-section { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); margin: 16px 0 6px; display: flex; align-items: center; }
  .form-section:first-of-type { margin-top: 4px; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 10px 16px; align-items: end; }
  .form-grid .field { height: auto; }
  .form-grid .fl { white-space: normal; line-height: 1.25; min-height: 2.5em; align-items: flex-end; display: flex; }
  .form-grid input, .form-grid select { height: 38px; box-sizing: border-box; }
  .form-grid .cmd-field { grid-column: span 2; }
  .form-grid .cmd .btn { height: 38px; }
  .rules-section { font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--secondary-text-color); margin: 24px 0 2px; }
  .rules-section:first-of-type { margin-top: 4px; }
  .rules-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px 16px; align-items: end; }
  .rules-grid .field { height: auto; }
  .rules-grid .fl { white-space: normal; line-height: 1.25; min-height: 2.5em; align-items: flex-end; display: flex; }
  .rules-grid input, .rules-grid select { height: 38px; box-sizing: border-box; }
  .prio-field { grid-column: span 2; }
  .prio-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: row; gap: 8px; }
  .prio-list li {
    flex: 1; height: 38px; box-sizing: border-box;
    display: flex; align-items: center; gap: 8px; padding: 0 8px; border-radius: 8px; cursor: grab;
    border: 1px solid var(--divider-color); background: var(--card-background-color, #fff); font-size: 14px; color: var(--primary-text-color);
  }
  .prio-list li:first-child { border-color: var(--primary-color); }
  .prio-list li.dragging { opacity: 0.5; }
  .prio-list li.over { outline: 2px dashed var(--primary-color); outline-offset: -2px; }
  .prio-list .grip { color: var(--secondary-text-color); letter-spacing: -3px; font-size: 14px; user-select: none; }
  .prio-list .num { font-weight: 600; color: var(--primary-color); }
  .prio-list .swap { margin-left: auto; border: 0; background: transparent; cursor: pointer; color: var(--secondary-text-color); font-size: 14px; padding: 0 4px; }
  .ev-band { opacity: 0.95; }
  .now-mark { stroke: var(--primary-text-color); stroke-width: 1.5; }
  .now-pill { fill: var(--primary-text-color); }
  .now-pill-text { font-size: 11px; font-weight: 600; fill: var(--card-background-color, #fff); }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th { text-align: left; font-weight: 500; color: var(--secondary-text-color); padding: 6px 4px; border-bottom: 1px solid var(--divider-color); font-size: 12px; text-transform: uppercase; }
  td { padding: 8px 4px; border-bottom: 1px solid var(--divider-color); }
  tr:last-child td { border-bottom: 0; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .status-list { display: flex; flex-direction: column; gap: 10px; }
  .status-row { display: flex; align-items: center; gap: 12px; }
  .status-row ha-icon { --mdc-icon-size: 24px; color: var(--secondary-text-color); }
  .status-row .t { flex: 1; }
  .status-row .rank { font-size: 22px; font-weight: 500; line-height: 1; min-width: 28px; text-align: right; color: var(--primary-text-color); }
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
  .car-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; margin-bottom: 12px; }
  .car-grid .card { margin-bottom: 0; }
  .car-meta { font-size: 13px; color: var(--secondary-text-color); display: flex; flex-direction: column; gap: 3px; margin: 8px 0; }
  .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; margin-top: 10px; align-items: end; }
  .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--secondary-text-color); cursor: pointer; min-height: 36px; }
  .toggle input { width: auto; }
  .plan-strip { width: 100%; height: 44px; display: block; margin-top: 8px; }
  .strip-day { stroke: var(--primary-text-color); stroke-width: 1; stroke-dasharray: 2 2; opacity: 0.6; }
  .slot { fill: var(--secondary-background-color); }
  .slot.chosen { fill: var(--success-color, #43a047); }
  .slot.est { opacity: 0.45; }
  .slot.now { stroke: var(--primary-text-color); stroke-width: 1.5; }
  .err { color: var(--error-color, #db4437); font-size: 13px; margin-top: 6px; }
  .slot.hold { fill: var(--info-color, #039be5); }
  .slot.charge { fill: var(--success-color, #43a047); }
  .slot.normal { fill: var(--secondary-background-color); }
  .legend .l-hold::before { background: var(--info-color, #039be5); }
  .legend .l-charge::before { background: var(--success-color, #43a047); }
  .legend .l-normal::before { background: var(--secondary-background-color); border: 1px solid var(--divider-color); }
  .legend .l-est::before { background: var(--success-color, #43a047); opacity: 0.45; }
  .badge.info { background: var(--info-color, #039be5); }
  .seg { display: inline-flex; border: 1px solid var(--divider-color); border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; border-right: 1px solid var(--divider-color); border-radius: 0; }
  .seg button:last-child { border-right: 0; }
  .seg button.active { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .cmd { display: grid; grid-template-columns: 2fr 1fr auto; gap: 8px; align-items: end; }
  .cmd .btn { padding: 8px 10px; }
  .cmd-result { min-height: 0; margin-top: 4px; }
  .cmd-result:empty { display: none; }
  .cmd-result.ok { color: var(--success-color, #43a047); }
  .cmd-result.fail { color: var(--error-color, #db4437); }
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
  table.history { min-width: 720px; }
  table.history tr.running td { background: var(--secondary-background-color); }
  table.cmdlog tr.failed td { background: rgba(219, 68, 55, 0.08); }
  table.cmdlog code { font-size: 12px; }
  .rules-toggles { display: flex; flex-wrap: wrap; gap: 6px 24px; margin-top: 12px; }
  .rules-now { margin-top: 12px; padding: 8px 10px; border-radius: 8px; background: var(--secondary-background-color); font-size: 13px; line-height: 1.4; }
  .rules-now strong { color: var(--primary-text-color); font-weight: 500; }
  .rules-now div + div { margin-top: 2px; }
  .rules-now .rules-now-title { font-weight: 500; color: var(--primary-text-color); margin-bottom: 6px; }
  .fl { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
  th .info, h2 .info, h3 .info, .label .info, .toggle .info { text-transform: none; letter-spacing: 0; font-size: 10px; margin-left: 6px; vertical-align: middle; }
  h3 { display: flex; align-items: center; }
  .info {
    position: relative; display: inline-flex; align-items: center; justify-content: center;
    width: 15px; height: 15px; border-radius: 50%; flex: none;
    border: 1px solid var(--secondary-text-color); color: var(--secondary-text-color);
    font-size: 10px; font-weight: 600; font-style: italic; font-family: Georgia, serif;
    cursor: help; user-select: none; margin-left: 4px;
  }
  .info:hover, .info:focus { color: var(--primary-color); border-color: var(--primary-color); outline: none; }
  .tip {
    position: fixed; z-index: 50; max-width: min(300px, 80vw);
    background: var(--primary-text-color); color: var(--card-background-color, #fff);
    padding: 8px 10px; border-radius: 6px; font-size: 12px; line-height: 1.4;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25); pointer-events: none;
  }
  @media (max-width: 600px) {
    .content { padding: 12px; }
    .tab { font-size: 12px; padding: 10px 4px; }
    .tab span { display: none; }
    .kpi .value { font-size: 24px; }
  }
`;

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** (i) icon with a hover/focus tooltip. */
const I = (tip) => `<span class="info" tabindex="0" data-tip="${esc(tip)}">i</span>`;

const fmtNum = (v, d = 2) =>
  v === null || v === undefined || Number.isNaN(v)
    ? "–"
    : Number(v).toLocaleString("da-DK", { minimumFractionDigits: d, maximumFractionDigits: d });

const pad2 = (n) => String(n).padStart(2, "0");
const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const fmtDate = (d) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;

class ElectricityOptimizerPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._tab = "home";
    this._lastKey = null;
    this._cars = null;
    this._history = null;
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
      c.solar_energy_month_entity,
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
    if (this._editingRulesSensor && (this._tab === "ev" || this._tab === "battery") && !force) return;
    const key = [
      liveKey,
      this._batteryStamp,
      this._rulesStamp,
      this._tab,
      st ? st.last_updated : "missing",
      solarKey,
      this._solarHistoryStamp || 0,
      this._carsStamp,
      this._historyStamp || 0,
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
      <div class="tip" hidden></div>
    `;
    this._tipEl = root.querySelector(".tip");
    const showTip = (ev) => {
      const el = ev.target.closest && ev.target.closest(".info");
      if (!el || !el.dataset.tip) return;
      const tip = this._tipEl;
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let left = r.left + r.width / 2 - tw / 2;
      left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
      let top = r.top - th - 8;
      if (top < 8) top = r.bottom + 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    };
    const hideTip = (ev) => {
      if (ev.target.closest && ev.target.closest(".info")) this._tipEl.hidden = true;
    };
    this._menuButton = root.querySelector("ha-menu-button");
    this._menuButton.hass = this._hass;
    this._menuButton.narrow = this._narrow;
    this._tabsEl = root.querySelector(".tabs");
    this._contentEl = root.querySelector(".content");
    this._contentEl.addEventListener("click", (ev) => this._onContentClick(ev));
    this._contentEl.addEventListener("change", (ev) => this._onContentChange(ev));
    this._contentEl.addEventListener("input", (ev) => this._onContentInput(ev));
    this._contentEl.addEventListener("focusin", (ev) => this._onContentInput(ev));
    this._contentEl.addEventListener("mouseover", showTip);
    this._contentEl.addEventListener("mouseout", hideTip);
    this._contentEl.addEventListener("focusin", showTip);
    this._contentEl.addEventListener("focusout", hideTip);
    this._contentEl.addEventListener("scroll", () => (this._tipEl.hidden = true));
    // drag & drop in the solar priority list (two rows: dropping on the other row swaps them)
    this._contentEl.addEventListener("dragstart", (ev) => {
      const li = ev.target.closest && ev.target.closest("[data-prio-item]");
      if (!li) return;
      this._dragPrio = li.dataset.prioItem;
      li.classList.add("dragging");
      if (ev.dataTransfer) {
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", li.dataset.prioItem);
      }
    });
    this._contentEl.addEventListener("dragend", (ev) => {
      const li = ev.target.closest && ev.target.closest("[data-prio-item]");
      if (li) li.classList.remove("dragging");
      for (const el of this._contentEl.querySelectorAll(".prio-list .over")) el.classList.remove("over");
    });
    this._contentEl.addEventListener("dragover", (ev) => {
      const li = ev.target.closest && ev.target.closest("[data-prio-item]");
      if (!li || !this._dragPrio) return;
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
      if (li.dataset.prioItem !== this._dragPrio) li.classList.add("over");
    });
    this._contentEl.addEventListener("dragleave", (ev) => {
      const li = ev.target.closest && ev.target.closest("[data-prio-item]");
      if (li) li.classList.remove("over");
    });
    this._contentEl.addEventListener("drop", (ev) => {
      const li = ev.target.closest && ev.target.closest("[data-prio-item]");
      if (!li || !this._dragPrio) return;
      ev.preventDefault();
      const dragged = this._dragPrio;
      this._dragPrio = null;
      const list = li.closest(".prio-list");
      const items = [...list.querySelectorAll("[data-prio-item]")].map((el) => el.dataset.prioItem);
      const from = items.indexOf(dragged), to = items.indexOf(li.dataset.prioItem);
      if (from < 0 || to < 0 || from === to) return;
      items.splice(from, 1);
      items.splice(to, 0, dragged);
      this._setSolarPriority(items[0]);
    });
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
    else if (this._tab === "history") html = this._renderHistory();
    if (this._tab === "ev" || this._tab === "home") this._loadCars();
    if (this._tab === "battery" || this._tab === "home") this._loadBattery();
    if (this._tab === "history") this._loadHistory();
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
    // Cheapest hours: rest of today + tomorrow if available
    const now = new Date();
    const hourly = ElectricityOptimizerPanel._hourly(d.all).filter((h) => h.time.getTime() + 3600000 > now.getTime());
    const cheapest = [...hourly].sort((a, b) => a.price - b.price).slice(0, 6).sort((a, b) => a.time - b.time);
    const expensive = [...hourly].sort((a, b) => b.price - a.price).slice(0, 3).sort((a, b) => a.time - b.time);
    const dayLabel = (t) => (t.getDate() === now.getDate() ? "I dag" : "I morgen");

    return `
      ${this._renderStatusBar()}
      ${this._renderLiveRow(this._renderStatusCard(d))}
      <div class="card">
        <h2><ha-icon icon="mdi:chart-bar"></ha-icon>Elpris ${d.tomorrowValid ? "i dag og i morgen" : "i dag"}${I("Elprisen fra EnergiDataService. Farver efter dagens fordeling: billigste tredjedel grøn, dyreste tredjedel rød. Lodret streg = nu med prisen i toppen, stiplet linje = dagens gennemsnit, lyseblå felt med lodrette kanter = ladeperiode for en bil eller husbatteriet fra start til forventet slut (ved solopladning flytter slutningen sig med solproduktion og husforbrug), farvede bjælker i bunden = elbilernes planlagte ladetimer. Morgendagens priser kommer ca. kl. 13.")}</h2>
        <div class="chart-wrap">${this._renderChart(d)}</div>
        <div class="legend">
          <span class="l-low">Billig</span><span class="l-mid">Normal</span><span class="l-high">Dyr</span>
          ${d.tomorrowValid ? '<span class="l-tmr">I morgen (nedtonet)</span>' : ""}
          ${this._evPlanSeries()
            .map((c) => `<span class="l-car" style="--c:${c.color}">Ladeplan: ${esc(c.name)}</span>`)
            .join("")}
          <span class="l-session">Ladeperiode: start → forventet slut</span>
          <span style="margin-left:auto">Lodret streg = nu · stiplet linje = dagens gennemsnit</span>
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2><ha-icon icon="mdi:cash-check"></ha-icon>Billigste timer fremover${I("De seks billigste timer fra nu og frem, i dag og i morgen når morgendagens priser er kendt. Her lægges netopladning af elbiler og husbatteri.")}</h2>
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
          <h2><ha-icon icon="mdi:cash-remove"></ha-icon>Dyreste timer fremover${I("De tre dyreste timer fra nu og frem. Her bør husbatteriet levere strømmen i stedet for nettet.")}</h2>
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
      </div>`;
  }

  _renderStatusCard(d) {
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon>Status${I("Kort overblik over solceller, husbatteri, elnet, elbiler og prisdata lige nu. Detaljer findes på de enkelte faner.")}</h2>
        <div class="status-list">
          ${this._renderSolarStatusRow()}
          ${this._renderBatteryStatusRow()}
          ${this._renderEvStatusRow()}
          <div class="status-row"><ha-icon icon="mdi:database-clock-outline"></ha-icon><div class="t"><div class="n">Prisdata</div><div class="d">${esc(d.attribution || "EnergiDataService")}${
            d.nextUpdate ? ` · næste opdatering ${fmtTime(new Date(d.nextUpdate))}` : ""
          }</div></div><span class="badge low">OK</span></div>
        </div>
      </div>`;
  }

  /**
   * Half-circle gauge. Bipolar (min < 0 < max): zero on top, negative sweeps left, positive right.
   * Unipolar (min >= 0): sweeps from the left end to the right end.
   */
  _renderGauge(o) {
    const cx = 100, cy = 92, r = 74, sw = 13;
    const pt = (deg) => {
      const a = (deg * Math.PI) / 180;
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    };
    const P = (deg) => pt(deg).map((v) => v.toFixed(2)).join(" ");
    const bipolar = o.min < 0;
    const v = o.value;
    let arc = "";
    if (v !== null && v !== undefined && !Number.isNaN(v)) {
      let startDeg, endDeg, sweep;
      if (bipolar) {
        const frac = Math.max(-1, Math.min(1, v / (v >= 0 ? o.max : -o.min)));
        startDeg = 90;
        endDeg = 90 - frac * 90;
        sweep = frac >= 0 ? 1 : 0;
      } else {
        const frac = Math.max(0, Math.min(1, (v - o.min) / (o.max - o.min || 1)));
        startDeg = 180;
        endDeg = 180 - frac * 180;
        sweep = 1;
      }
      if (!bipolar && Array.isArray(o.segments) && o.segments.length) {
        // stacked segments from the left end, e.g. house load + EV charging
        let from = 180;
        let acc = 0;
        const parts = [];
        for (const seg of o.segments) {
          acc += Math.max(0, seg.value || 0);
          const to = 180 - Math.max(0, Math.min(1, (acc - o.min) / (o.max - o.min || 1))) * 180;
          if (from - to > 0.3) parts.push(`<path class="arc" style="stroke:${seg.color}" d="M ${P(from)} A ${r} ${r} 0 0 1 ${P(to)}"/>`);
          from = to;
        }
        if (parts.length) {
          const [ex, ey] = pt(from);
          const last = o.segments[o.segments.length - 1];
          arc = `${parts.join("")}<circle class="dot" style="fill:${last.color}" cx="${ex.toFixed(2)}" cy="${ey.toFixed(2)}" r="${sw / 2 + 2}"/>`;
        }
      } else if (Math.abs(endDeg - startDeg) > 0.3) {
        const [ex, ey] = pt(endDeg);
        arc = `<path class="arc" style="stroke:${o.color}" d="M ${P(startDeg)} A ${r} ${r} 0 0 ${sweep} ${P(endDeg)}"/>
           <circle class="dot" style="fill:${o.color}" cx="${ex.toFixed(2)}" cy="${ey.toFixed(2)}" r="${sw / 2 + 2}"/>`;
      }
    }
    const zero = bipolar ? `<line class="zero" x1="${cx}" x2="${cx}" y1="${cy - r - sw / 2 - 2}" y2="${cy - r + sw / 2 + 2}"/>` : "";
    return `<svg class="gauge" viewBox="0 0 200 128" role="img" aria-label="${esc(o.aria || "")}">
      <path class="track" d="M ${P(180)} A ${r} ${r} 0 0 1 ${P(0)}"/>
      ${zero}
      ${arc}
      <text class="gt" x="${cx - r - sw / 2}" y="${cy + 12}" text-anchor="start">${esc(o.leftLabel || "")}</text>
      <text class="gt" x="${cx + r + sw / 2}" y="${cy + 12}" text-anchor="end">${esc(o.rightLabel || "")}</text>
      <text class="gv" style="fill:${o.color || "var(--primary-text-color)"}" x="${cx}" y="${cy - 2}" text-anchor="middle">${esc(o.valueText)}<tspan class="gu"> ${esc(o.unit || "")}</tspan></text>
      <text class="gs" x="${cx}" y="${cy + 28}" text-anchor="middle">${esc(o.sub || "")}</text>
    </svg>`;
  }

  static COLOR_IN = "var(--error-color, #db4437)";
  static COLOR_OUT = "var(--success-color, #43a047)";
  static COLOR_SUN = "var(--warning-color, #ffa600)";

  static _kwLabel(w) {
    return `${fmtNum(w / 1000, w % 1000 ? 1 : 0)} kW`;
  }

  /** Battery power: discharge (negative, red) sweeps left, charge (positive, green) sweeps right. */
  _renderBatteryGauge(batW) {
    const b = this._battery || {};
    const maxCharge = Math.max(100, (Number(b.max_charge_kw) || 5) * 1000);
    const maxDischarge = Math.max(100, (Number(b.max_discharge_kw) || 5) * 1000);
    const K = ElectricityOptimizerPanel;
    const sub = batW === null ? (this._battery ? "Ingen effekt-sensor" : "Ikke sat op") : batW > 0 ? "lader" : batW < 0 ? "aflader" : "hviler";
    return this._renderGauge({
      value: batW,
      min: -maxDischarge,
      max: maxCharge,
      color: batW > 0 ? K.COLOR_OUT : batW < 0 ? K.COLOR_IN : "var(--primary-text-color)",
      valueText: batW === null ? "–" : `${batW < 0 ? "−" : ""}${fmtNum(Math.abs(batW), 0)}`,
      unit: "W",
      sub,
      leftLabel: `−${K._kwLabel(maxDischarge)}`,
      rightLabel: `+${K._kwLabel(maxCharge)}`,
      aria: `Batteri effekt ${batW === null ? "ukendt" : `${fmtNum(batW, 0)} W`} ${sub}`,
    });
  }

  /** Grid power: buying (red) sweeps left, selling (green) sweeps right. */
  _renderGridGauge(gridW) {
    const K = ElectricityOptimizerPanel;
    const limit = 10000;
    const sub = gridW === null ? "Ingen net-sensor" : gridW > 0 ? "køber fra nettet" : gridW < 0 ? "sælger til nettet" : "i balance";
    return this._renderGauge({
      value: gridW === null ? null : -gridW,
      min: -limit,
      max: limit,
      color: gridW > 0 ? K.COLOR_IN : gridW < 0 ? K.COLOR_OUT : "var(--primary-text-color)",
      valueText: gridW === null ? "–" : `${gridW > 0 ? "−" : ""}${fmtNum(Math.abs(gridW), 0)}`,
      unit: "W",
      sub,
      leftLabel: `Køb ${K._kwLabel(limit)}`,
      rightLabel: `Salg ${K._kwLabel(limit)}`,
      aria: `Elnet ${gridW === null ? "ukendt" : `${fmtNum(gridW, 0)} W`} ${sub}`,
    });
  }

  /** Solar production: 0 → peak, always yellow/orange like the chart. */
  _renderSolarGauge(solar, solarW) {
    const K = ElectricityOptimizerPanel;
    const peak = solar.peakKw ? Math.max(500, solar.peakKw * 1000) : 10000;
    const sub = solar.configured ? (solar.todayKwh !== null ? `${fmtNum(solar.todayKwh, 1)} kWh i dag` : "") : "Ingen sensor – se Konfigurer";
    return this._renderGauge({
      value: solarW,
      min: 0,
      max: peak,
      color: K.COLOR_SUN,
      valueText: solarW === null ? "–" : fmtNum(solarW, 0),
      unit: "W",
      sub,
      leftLabel: "0",
      rightLabel: K._kwLabel(peak),
      aria: `Solceller ${solarW === null ? "ukendt" : `${fmtNum(solarW, 0)} W`}`,
    });
  }

  static COLOR_EV = "#8e24aa";

  /** What the cars are charging with right now (power sensor, else the commanded current). */
  _evChargingW() {
    let total = 0;
    for (const car of this._cars || []) {
      const rt = car.runtime || {};
      if (car.power_entity) {
        const p = this._numState(car.power_entity);
        const kw = ElectricityOptimizerPanel._toKw(p.value, p.unit);
        if (kw !== null && kw > 0.05) total += kw * 1000;
        continue;
      }
      if (rt.charging) total += (rt.amps || car.max_amps || 0) * 230 * (car.phases || 3);
    }
    return Math.round(total);
  }

  /** Consumption 0 → 5 kW: house load in blue, EV charging stacked on top in purple. */
  _renderHouseGauge(totalW) {
    const K = ElectricityOptimizerPanel;
    const limit = 5000;
    const hasSensor = (this._battery && this._battery.house_power_entity) || (this._rules && this._rules.house_power_entity);
    const total = totalW === null ? null : Math.abs(totalW);
    const evW = total === null ? 0 : Math.min(total, this._evChargingW());
    const houseW = total === null ? null : total - evW;
    return this._renderGauge({
      value: total,
      min: 0,
      max: limit,
      color: "var(--primary-color, #03a9f4)",
      segments: total === null ? null : [{ value: houseW, color: "var(--primary-color, #03a9f4)" }, { value: evW, color: K.COLOR_EV }],
      valueText: total === null ? "–" : fmtNum(total, 0),
      unit: "W",
      sub: total === null ? (hasSensor ? "Ingen værdi" : "Ingen sensor – vælg under Hus batteri") : `heraf ${fmtNum(houseW, 0)} W husforbrug${evW > 0 ? ` · ${fmtNum(evW, 0)} W elbil` : ""}`,
      leftLabel: "0",
      rightLabel: K._kwLabel(limit),
      aria: `Forbrug ${total === null ? "ukendt" : `${fmtNum(total, 0)} W, heraf ${fmtNum(houseW, 0)} W husforbrug`}`,
    });
  }

  /** One compact battery per car: fill = SoC, dashed line = target SoC, bolt = charging now. */
  _renderCarBatteries() {
    const K = ElectricityOptimizerPanel;
    const cars = this._cars;
    if (cars === null) return `<div class="sub" style="color:var(--secondary-text-color)">Henter biler…</div>`;
    if (!cars.length) return `<div class="sub" style="color:var(--secondary-text-color)">Ingen biler tilføjet – se fanen Elbiler</div>`;
    const carColor = (soc) => (soc === null ? "var(--secondary-text-color)" : soc <= 20 ? K.COLOR_IN : soc <= 40 ? K.COLOR_SUN : K.COLOR_OUT);
    if (cars.length === 1) {
      const car = cars[0];
      const rt = car.runtime || {};
      const soc = this._numState(car.soc_entity).value;
      const target = Number(rt.plan && rt.plan.target_soc ? rt.plan.target_soc : car.target_soc) || 0;
      const [statusText] = K.STATUS_TEXT[rt.status] || [""];
      return this._renderBigBattery({
        soc,
        color: carColor(soc),
        marker: target > 0 && target < 100 ? target : null,
        sub: car.name,
        sub2: `mål ${target} %${statusText ? ` · ${statusText}` : ""}`,
        aria: car.name,
        charging: !!rt.charging,
      });
    }
    const rows = cars.map((car) => {
      const rt = car.runtime || {};
      const soc = this._numState(car.soc_entity).value;
      const target = Number(rt.plan && rt.plan.target_soc ? rt.plan.target_soc : car.target_soc) || 0;
      const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
      const color = carColor(soc);
      const x = 2, y = 3, w = 186, h = 24, pad = 3;
      const inner = w - 2 * pad;
      const fillW = (inner * pct) / 100;
      const tX = x + pad + (inner * Math.max(0, Math.min(100, target))) / 100;
      const [statusText] = K.STATUS_TEXT[rt.status] || [""];
      return `<div class="cb-row">
        <span class="cb-name" title="${esc(car.name)}"><span>${esc(car.name)}</span><small>mål ${target} %${statusText ? ` · ${esc(statusText)}` : ""}</small></span>
        <svg class="batt" viewBox="0 0 200 30" role="img" aria-label="${esc(car.name)} ${soc === null ? "ukendt" : `${fmtNum(soc, 0)} %`}">
          <rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>
          <rect class="nub" x="${x + w + 1.5}" y="${y + h / 2 - 5}" width="5" height="10" rx="1.5"/>
          ${fillW > 0 ? `<rect class="fill" style="fill:${color}" x="${x + pad}" y="${y + pad}" width="${fillW.toFixed(1)}" height="${h - 2 * pad}" rx="3"/>` : ""}
          ${target > 0 && target < 100 ? `<line class="reserve" x1="${tX.toFixed(1)}" x2="${tX.toFixed(1)}" y1="${y + 1.5}" y2="${y + h - 1.5}"/>` : ""}
          <text class="bv" x="${x + w / 2}" y="${y + h / 2 + 5}" text-anchor="middle">${soc === null ? "–" : fmtNum(soc, 0)}<tspan class="bu"> %</tspan></text>
          ${rt.charging ? `<path class="bolt" transform="translate(${x + 8} ${y + 4}) scale(0.8)" d="M7 0 L0 11 h5 l-1 8 7-11 h-5 z"/>` : ""}
        </svg>
      </div>`;
    });
    return `<div class="cars-batt">${rows.join("")}</div>`;
  }

  /** Battery illustration: a horizontal cell whose fill follows the state of charge, same colours as the SoC gauge. */
  _renderBatteryLevel(soc) {
    const K = ElectricityOptimizerPanel;
    const b = this._battery;
    const minSoc = b ? Number(b.min_soc) || 0 : 0;
    const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
    const color = soc === null ? "var(--secondary-text-color)" : soc <= minSoc ? K.COLOR_IN : soc <= minSoc + 10 ? K.COLOR_SUN : K.COLOR_OUT;
    const kwh = b && soc !== null ? (Number(b.capacity_kwh) * pct) / 100 : null;
    const sub = !b ? "Ikke sat op" : kwh === null ? `${fmtNum(b.capacity_kwh, 1)} kWh · reserve ${b.min_soc} %` : `≈ ${fmtNum(kwh, 1)} af ${fmtNum(b.capacity_kwh, 1)} kWh · reserve ${b.min_soc} %`;
    return this._renderBigBattery({ soc, color, marker: b && minSoc > 0 ? minSoc : null, sub, aria: "Hus batteri" });
  }

  /** Large battery illustration (same size as a gauge): fill = SoC, optional dashed marker, optional charging bolt. */
  _renderBigBattery(o) {
    const soc = o.soc;
    const pct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
    const x = 22, y = 30, w = 150, h = 64, pad = 5;
    const inner = w - 2 * pad;
    const fillW = (inner * pct) / 100;
    const mX = o.marker !== null && o.marker !== undefined ? x + pad + (inner * Math.max(0, Math.min(100, o.marker))) / 100 : null;
    return `<svg class="gauge batt" viewBox="0 0 200 128" role="img" aria-label="${esc(o.aria)} ${soc === null ? "ukendt" : `${fmtNum(soc, 0)} %`}">
      <rect class="body" x="${x}" y="${y}" width="${w}" height="${h}" rx="9"/>
      <rect class="nub" x="${x + w + 2}" y="${y + h / 2 - 11}" width="7" height="22" rx="2.5"/>
      ${fillW > 0 ? `<rect class="fill" style="fill:${o.color}" x="${x + pad}" y="${y + pad}" width="${fillW.toFixed(1)}" height="${h - 2 * pad}" rx="5"/>` : ""}
      ${mX !== null ? `<line class="reserve" x1="${mX.toFixed(1)}" x2="${mX.toFixed(1)}" y1="${y + 2}" y2="${y + h - 2}"/>` : ""}
      <text class="bv" x="${x + w / 2}" y="${y + h / 2 + 9}" text-anchor="middle">${soc === null ? "–" : fmtNum(soc, 0)}<tspan class="bu"> %</tspan></text>
      ${o.charging ? `<path class="bolt" transform="translate(${x + 12} ${y + 14}) scale(1.6)" d="M7 0 L0 11 h5 l-1 8 7-11 h-5 z"/>` : ""}
      ${o.sub2 ? `<text class="gs" x="100" y="113" text-anchor="middle">${esc(o.sub || "")}</text><text class="gs" x="100" y="125" text-anchor="middle" style="font-size:11px">${esc(o.sub2)}</text>` : `<text class="gs" x="100" y="120" text-anchor="middle">${esc(o.sub || "")}</text>`}
    </svg>`;
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

  _renderLiveRow(sideCard = "") {
    const solar = this._readSolar();
    const bat = this._battery ? this._readBatteryLive() : { soc: null, batW: null, gridW: null, houseW: null };
    const gridW = this._gridLiveW();
    const solarW = solar.powerKw === null ? null : Math.round(solar.powerKw * 1000);
    return `
      <div class="top">
      <div class="gauges">
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:solar-power-variant"></ha-icon>Solceller lige nu${I("Solcellernes produktion lige nu fra effekt-sensoren under Konfigurer. Skalaen går til anlæggets installerede effekt, eller 10 kW hvis den ikke er angivet.")}</div>
          ${this._renderSolarGauge(solar, solarW)}
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:home-lightning-bolt"></ha-icon>Forbrug${I("Det samlede forbrug lige nu fra husforbrugs-sensoren, inkl. elbil-ladning. Blå = husforbrug, lilla = elbilernes ladning (målt med ladeeffekt-sensor, ellers den satte ladestrøm). Skala 0 til 5 kW.")}</div>
          ${this._renderHouseGauge(bat.houseW)}
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:transmission-tower"></ha-icon>Elnet${I("Effekt til og fra elnettet lige nu. Rød mod venstre = køber, grøn mod højre = sælger (minus foran tallet). Skala ±10 kW.")}</div>
          ${this._renderGridGauge(gridW)}
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:battery-charging"></ha-icon>Batteri effekt${I("Husbatteriets effekt lige nu. Rød mod venstre = aflader (minus foran tallet), grøn mod højre = lader. Skalaen følger batteriets maks. lade- og afladeeffekt.")}</div>
          ${this._renderBatteryGauge(bat.batW)}
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:home-battery"></ha-icon>Hus batteri${I("Husbatteriets ladestand vist som et batteri, der fyldes op: rød ved eller under reserven, orange tæt på reserven, ellers grøn. Den stiplede streg er reserven, og teksten viser de kWh, der cirka er tilbage.")}</div>
          ${this._renderBatteryLevel(bat.soc)}
        </div>
        <div class="card kpi live">
          <div class="label"><ha-icon icon="mdi:car-electric"></ha-icon>Elbiler${I("Hver bils ladestand vist som et batteri: rød under 20 %, orange under 40 %, ellers grøn. Den stiplede streg er dagens mål-SoC, og lynet viser, at bilen lader lige nu.")}</div>
          ${this._renderCarBatteries()}
        </div>
      </div>
      ${sideCard}
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
    return `<div class="status-row"><ha-icon icon="mdi:solar-power-variant"></ha-icon><div class="t"><div class="n">Solceller</div><div class="d">${esc(parts.join(" · ") || "Ingen data")}</div></div><span class="badge ${producing ? "low" : "mid"}">${producing ? "Producerer" : "Venter"}</span></div>`;
  }

  _renderChart(d) {
    const points = d.all;
    if (!points.length) return "";
    const W = Math.max(320, Math.floor(this._chartWidth || (this._contentEl && this._contentEl.clientWidth - 34) || 640));
    const H = 250;
    const padL = 44, padR = 8, padT = 24, padB = 28;
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

    // time → x (points are equidistant in time)
    const t0 = points[0].time.getTime();
    const slotMs = points.length > 1 ? points[1].time.getTime() - t0 : 3600000;
    const tEnd = t0 + points.length * slotMs;
    const xOf = (t) => padL + Math.min(innerW, Math.max(0, ((t - t0) / slotMs) * bw));

    // planned EV charging: a band per car below the bars
    const series = this._evPlanSeries();
    const bandH = 5;
    const evPlan = series
      .map((c, si) => {
        const bandY = padT + innerH - bandH * (si + 1);
        return c.slots
          .filter((sl) => sl.end > t0 && sl.start < tEnd)
          .map((sl) => {
            const x1 = xOf(sl.start), x2 = xOf(sl.end);
            const w = Math.max(1, x2 - x1);
            const label = `${c.name}: planlagt ladning ${fmtTime(new Date(sl.start))} – ${fmtTime(new Date(sl.end))}`;
            return `<rect class="ev-band" x="${x1.toFixed(1)}" y="${bandY}" width="${w.toFixed(1)}" height="${bandH}" fill="${c.color}"><title>${esc(label)}</title></rect>`;
          })
          .join("");
      })
      .join("");

    // charging periods (car or battery): light blue box from start to expected end, with edge lines
    const sessions = this._chargingSessions()
      .filter((se) => se.end > t0 && se.start < tEnd)
      .map((se, i) => {
        const x1 = xOf(se.start), x2 = xOf(se.end);
        const w = Math.max(2, x2 - x1);
        const endTxt = `${se.estimated ? "ca. " : ""}${fmtTime(new Date(se.end))}`;
        const label = `${se.name} ${fmtTime(new Date(se.start))} – ${endTxt}`;
        const title = `${se.name}: ${se.source === "solar" ? "lader fra sol" : "netopladning"} ${fmtTime(new Date(se.start))} – ${endTxt}${
          se.estimated ? " (forventet slut, ændrer sig med solproduktion og forbrug)" : ""
        }`;
        const ly = padT + 12 + i * 12;
        return `<rect class="session" x="${x1.toFixed(1)}" y="${padT}" width="${w.toFixed(1)}" height="${innerH}"><title>${esc(title)}</title></rect>
          <line class="session-edge" x1="${x1.toFixed(1)}" x2="${x1.toFixed(1)}" y1="${padT}" y2="${padT + innerH}"/>
          <line class="session-edge ${se.estimated ? "est" : ""}" x1="${x2.toFixed(1)}" x2="${x2.toFixed(1)}" y1="${padT}" y2="${padT + innerH}"/>
          <text class="session-label" x="${(Math.min(x1, W - padR - 90) + 3).toFixed(1)}" y="${ly}">${esc(label)}</text>`;
      })
      .join("");

    // now marker: vertical line with the current price on top
    let nowMark = "";
    const nowT = Date.now();
    if (nowT >= t0 && nowT <= tEnd) {
      const nx = xOf(nowT);
      const txt = d.currentPrice === null ? "–" : `${fmtNum(d.currentPrice)} ${d.unit}`;
      const pw = txt.length * 6.2 + 12;
      const px = Math.min(W - padR - pw, Math.max(padL, nx - pw / 2));
      nowMark = `<line class="now-mark" x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${padT - 2}" y2="${padT + innerH}"/>
        <rect class="now-pill" x="${px.toFixed(1)}" y="2" width="${pw.toFixed(1)}" height="18" rx="9"/>
        <text class="now-pill-text" x="${(px + pw / 2).toFixed(1)}" y="15" text-anchor="middle">${esc(txt)}</text>`;
    }

    return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
      ${yTicks.join("")}
      <line class="axis" x1="${padL}" x2="${W - padR}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"/>
      ${bars}
      ${sessions}
      ${evPlan}
      ${meanLine}
      ${ticks.join("")}
      ${nowMark}
    </svg>`;
  }

  static EV_COLORS = ["#1e88e5", "#8e24aa", "#00acc1", "#f4511e", "#3949ab"];

  /** Current/next charging periods for cars and the house battery (start → expected end). */
  _chargingSessions() {
    const out = [];
    const push = (name, se) => {
      if (!se || !se.start || !se.end) return;
      const start = new Date(se.start).getTime(), end = new Date(se.end).getTime();
      if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return;
      out.push({ name, start, end, estimated: !!se.estimated, source: se.source || "grid" });
    };
    for (const car of this._cars || []) {
      if (car.enabled === false) continue;
      push(car.name || "Elbil", car.runtime && car.runtime.session);
    }
    if (this._battery && this._batteryRuntime) push("Husbatteri", this._batteryRuntime.session);
    return out;
  }

  /** Planned (chosen) charging slots per enabled car, for the price chart. */
  _evPlanSeries() {
    const out = [];
    for (const car of this._cars || []) {
      const rt = car.runtime || {};
      const plan = rt.plan && Array.isArray(rt.plan.plan) ? rt.plan.plan : null;
      if (!plan || car.enabled === false) continue;
      const slots = [];
      for (const s of plan) {
        if (!s.chosen) continue;
        const start = new Date(s.start).getTime();
        const end = new Date(s.end).getTime();
        if (Number.isNaN(start) || Number.isNaN(end)) continue;
        const last = slots[slots.length - 1];
        if (last && last.end === start) last.end = end;
        else slots.push({ start, end });
      }
      if (!slots.length) continue;
      out.push({ name: car.name || "Elbil", color: ElectricityOptimizerPanel.EV_COLORS[out.length % ElectricityOptimizerPanel.EV_COLORS.length], slots });
    }
    return out;
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
    const month = this._numState(c.solar_energy_month_entity);
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
      monthKwh: ElectricityOptimizerPanel._toKwh(month.value, month.unit),
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
          <div class="label"><ha-icon icon="mdi:solar-power"></ha-icon>Produktion lige nu${I("Aktuel effekt fra solcelle-sensoren under Konfigurer. Procenten er udnyttelsen af den installerede effekt (kWp).")}</div>
          <div class="value">${fmtNum(s.powerKw === null ? null : Math.round(s.powerKw * 1000), 0)}<small>W</small></div>
          ${
            pct !== null
              ? `<div class="sub">${pct} % af ${fmtNum(s.peakKw, 1)} kWp</div><div class="progress"><div style="width:${pct}%"></div></div>`
              : `<div class="sub">${s.peakKw ? "" : "Angiv installeret effekt for at se udnyttelse"}</div>`
          }
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:counter"></ha-icon>Produceret i dag${I("Energi produceret i dag fra energi-sensoren. Uden sensor anslås den ud fra effektkurven. Procenten er i forhold til dagens prognose.")}</div>
          <div class="value">${fmtNum(s.todayKwh, 1)}<small>kWh</small></div>
          ${
            s.fcTodayKwh
              ? `<div class="sub">${fcPct} % af prognosen på ${fmtNum(s.fcTodayKwh, 1)} kWh</div><div class="progress"><div style="width:${fcPct}%"></div></div>`
              : `<div class="sub">${producedKwh !== null && s.todayKwh === null ? `ca. ${fmtNum(producedKwh, 1)} kWh ud fra effektkurven` : ""}</div>`
          }
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:weather-sunny"></ha-icon>Prognose${I("Forventet produktion i dag og i morgen fra prognose-sensorerne, fx Solcast eller Forecast.Solar. Bruges til husbatteriets regel om kun at lade fra nettet, når prognosen er lav.")}</div>
          <div class="value">${fmtNum(s.fcTodayKwh, 1)}<small>kWh i dag</small></div>
          <div class="sub">${s.fcTomorrowKwh !== null ? `I morgen: ${fmtNum(s.fcTomorrowKwh, 1)} kWh` : "Ingen prognose-sensor valgt"}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:white-balance-sunny"></ha-icon>Solen${I("Solens højde over horisonten lige nu samt tidspunkt for solopgang og solnedgang fra Home Assistants sol-entitet.")}</div>
          <div class="value">${s.elevation !== null ? `${fmtNum(s.elevation, 0)}°` : "–"}<small>over horisonten</small></div>
          <div class="sub">${sunBadge} ${esc(sunTimes)}</div>
        </div>
      </div>

      <div class="card">
        <h2><ha-icon icon="mdi:chart-areaspline"></ha-icon>Produktion i dag${I("Effektkurve for i dag ud fra solcelle-sensorens historik i Home Assistant. Lodret streg = nu.")}</h2>
        <div class="chart-wrap">${this._renderSolarChart(s)}</div>
        <div class="legend">
          <span class="l-mid">Effekt (kW)</span>
          ${s.peakKw ? `<span style="margin-left:auto">Toppunkt for anlægget: ${fmtNum(s.peakKw, 1)} kWp</span>` : ""}
        </div>
      </div>

      <div class="grid">
        <div class="card">
          <h2><ha-icon icon="mdi:information-outline"></ha-icon>Anlæg${I("Anlæggets produktion i dag og denne måned fra energi-sensorerne under Konfigurer.")}</h2>
          <table>
            <tbody>
              <tr><td>Produceret i dag</td><td class="num">${s.todayKwh !== null ? `${fmtNum(s.todayKwh, 1)} kWh` : "–"}</td></tr>
              <tr><td>Produceret denne måned</td><td class="num">${s.monthKwh !== null ? `${fmtNum(s.monthKwh, 0)} kWh` : "–"}</td></tr>
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
        <div class="status-row"><span class="rank">1.</span><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri først</div><div class="d">${battery ? `Op til ${rules.solar_priority_over} % har batteriet forrang: under ${rules.ev_buffer_soc || 0} % venter bilen, derover kører den højst med min. ladestrøm.` : "Intet husbatteri sat op – bilen får solstrømmen."}</div></div></div>
        <div class="status-row"><span class="rank">2.</span><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbil</div><div class="d">Over ${rules.solar_priority_over} % vinder bilen og får eksporten plus det, batteriet ellers ville lade med. ${esc(carText)}.</div></div></div>`;
    } else {
      rows = `
        <div class="status-row"><span class="rank">1.</span><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbil først</div><div class="d">Op til ${rules.solar_priority_over} % får bilen eksporten plus det, batteriet lader med; derover vinder batteriet. ${esc(carText)}.</div></div></div>
        <div class="status-row"><span class="rank">2.</span><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">${battery ? "Får det overskud, bilen ikke bruger, og bruges i de dyre timer." : "Intet husbatteri sat op."}</div></div></div>`;
    }
    const ctx = this._context || {};
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon>Sådan bruges solstrømmen${I("Hvordan solstrømmen fordeles mellem elbiler og husbatteri i dag ud fra Regler for opladning (nederst på Elbiler og Hus batteri) og bilernes kilde i ugeplanen.")} <a class="setup-link hint" href="#" data-goto="ev" style="margin-left:auto">Regler</a></h2>
        <div class="status-list">${rows}</div>
        ${rules ? `<div class="hint" style="margin-top:8px">${this._solarConditionsText(rules)}${ctx.surplus_w !== undefined && ctx.surplus_w !== null ? ` Overskud ved sidste beregning: ${fmtNum(ctx.surplus_w, 0)} W.` : ""}</div>` : ""}
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
    solar_low: ["Venter på solproduktion", "mid"],
    no_power: ["Starter ikke – 0 W", "high"],
    cmd_failed: ["Start fejlede", "high"],
    battery_first: ["Venter – husbatteri har prioritet", "mid"],
    solar_min: ["Lader fra sol – min. strøm", "low"],
    no_solar_sensor: ["Mangler solcelle-sensor", "neutral"],
    fuse_wait: ["Venter – hovedsikring", "mid"],
    no_grid_sensor: ["Mangler sensor til sol-overskud", "neutral"],
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

  /** Split a text into sentences (a full stop followed by a capital letter), keeping "Nr. 1" and "min. ladestrøm" intact. */
  static _sentences(text) {
    return String(text || "")
      .split(/(?<=\.)\s+(?=[A-ZÆØÅ])/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  /** One sentence describing what the current solar rules mean (shared by the rules card and the solar tab). */
  _solarPriorityText(rules) {
    const limit = rules.solar_priority_over;
    const buffer = rules.ev_buffer_soc || 0;
    return rules.solar_priority === "battery"
      ? `Nr. 1 er husbatteriet. Over ${limit} % vinder bilen og får eksporten plus det, batteriet ellers ville lade med${
          rules.battery_to_ev_above_limit !== false ? ", og batteriet må aflade til bilen" : ""
        }. Mellem ${buffer} og ${limit} % har batteriet forrang: bilen kører højst med min. ladestrøm. Under ${buffer} % lader bilen ikke fra sol.`
      : `Nr. 1 er elbilen: op til ${limit} % får den eksporten plus det, husbatteriet ellers ville lade med. Derover vinder husbatteriet, og bilen lader ikke fra sol.`;
  }

  _solarConditionsText(rules) {
    const conds = [];
    if (rules.solar_min_w !== null) conds.push(`solcellerne har produceret mindst ${fmtNum(rules.solar_min_w, 0)} W i ${rules.solar_min_minutes} min`);
    conds.push(`der har været overskud nok i ${rules.solar_min_minutes} min (stopper efter ${rules.solar_min_minutes} min uden)`);
    const src = rules.surplus_source === "solar_house" ? "Overskud = solproduktion − husforbrug; ladestrømmen følger produktionen." : "Overskud = det, der sælges til nettet.";
    return `Elbilen lader fra sol, når ${conds.join(", og ")}. ${src}`;
  }

  async _setSolarPriority(first) {
    if (!this._rules || this._rules.solar_priority === first) return;
    try {
      await this._saveRules({ solar_priority: first });
      this._rulesError = null;
    } catch (err) {
      this._rulesError = err && err.message ? err.message : String(err);
    }
    this._maybeRender(true);
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
             <label class="field"><span class="fl">Net import/eksport (W)${I("Sensor med effekt til og fra nettet. Bruges til at beregne sol-overskud til elbiler, når husbatteriet ikke har sin egen net-sensor.")}</span><div class="picker"><input name="grid_power_entity" data-domains="sensor" value="${esc(r.grid_power_entity)}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
             <label class="field"><span class="fl">Husforbrug (W)${I("Sensor med husets samlede forbrug. Bruges til sol-overskud, når beregningen er sat til solproduktion minus husforbrug, og husbatteriet ikke har sin egen husforbrugs-sensor.")}</span><div class="picker"><input name="house_power_entity" data-domains="sensor" value="${esc(r.house_power_entity || "")}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
             <label class="field"><span class="fl">Fortegn${I("Om sensoren viser positive tal, når huset køber fra nettet, eller når huset sælger til nettet.")}</span><select name="grid_sign"><option value="import_positive" ${r.grid_sign === "import_positive" ? "selected" : ""}>Positiv = køber</option><option value="export_positive" ${r.grid_sign === "export_positive" ? "selected" : ""}>Positiv = sælger</option></select></label>
           </div>
           <div class="row" style="margin-top:10px"><button class="btn primary" type="submit" data-raction="save-sensor">Gem</button><button class="btn" type="button" data-raction="cancel-sensor">Annuller</button></div>
         </form>`
      : `<div class="hint" style="margin-top:8px">${
          r.surplus_source === "solar_house"
            ? `Sol-overskud = solproduktion (Konfigurer) − husforbrug: ${
                r.house_power_entity ? `<code>${esc(r.house_power_entity)}</code>` : "bruger husbatteriets husforbrugs-sensor"
              }`
            : `Net-sensor til sol-overskud: ${
                r.grid_power_entity ? `<code>${esc(r.grid_power_entity)}</code>${gridLive.value !== null ? ` (${fmtNum(gridLive.value, 0)} W)` : ""}` : "bruger husbatteriets net-sensor"
              }`
        } <button class="btn" style="padding:4px 10px;font-size:12px;margin-left:6px" data-raction="edit-sensor">Vælg sensorer</button></div>`;
    const info = I;
    const head = (text, tip) => `<span class="fl">${text}${info(tip)}</span>`;
    const hasFuse = r.max_total_amps !== null && r.max_total_amps !== "" && Number(r.max_total_amps) > 0;
    return `
      <div class="card" data-rules>
        <h2><ha-icon icon="mdi:scale-balance"></ha-icon>Regler for opladning${I("Fælles regler for samspillet mellem elbiler og husbatteri. Hvert felt gemmes med det samme, og linjen under felterne viser, hvad de aktuelle valg betyder.")}</h2>
        <div class="rules-section">Prioritering</div>
        <div class="rules-grid">
                      <div class="field prio-field"><span class="fl">Sol prioritet${I(
              "Træk rækkerne: nr. 1 får solstrømmen først, indtil dens ladestand når 'Prioriter 1. indtil'; derover vinder nr. 2. Vinder elbilen, får den eksporten plus det, husbatteriet ellers ville lade med. Med husbatteri som nr. 1 kører bilen med min. ladestrøm mellem EV buffer og Prioriter 1. indtil og stopper under EV buffer. Flere biler får sol i den rækkefølge, de står i under Elbiler."
            )}</span>
              <ol class="prio-list" data-prio>
                ${(r.solar_priority === "battery" ? ["battery", "ev"] : ["ev", "battery"])
                  .map(
                    (k, i) => `<li draggable="true" data-prio-item="${k}" title="Træk for at ændre rækkefølgen"><span class="grip">⋮⋮</span><span class="num">${i + 1}.</span>${k === "ev" ? "Elbil" : "Husbatteri"}<button type="button" class="swap" data-raction="prio-swap" title="Byt rækkefølge">⇅</button></li>`
                  )
                  .join("")}
              </ol>
            </div>
          <label class="field">${head(
              "Prioriter 1. indtil (%)",
              "Nr. 1 har solstrømmen først, indtil dens ladestand når denne procent. Derover vinder nr. 2: er det elbilen, får den eksporten plus det, husbatteriet ellers ville lade med."
            )}<input type="number" min="1" max="100" data-rfield="solar_priority_over" value="${r.solar_priority_over}"></label>
          ${
            r.solar_priority === "battery"
              ? `<label class="field">${head(
                  "EV buffer (%)",
                  "Kun med husbatteri som nr. 1. Under denne ladestand lader elbilen ikke fra sol. Mellem EV buffer og Prioriter 1. indtil har husbatteriet forrang: bilen fortsætter kun med min. ladestrøm og starter kun, hvis solen alene dækker den. Skal være lavere end Prioriter 1. indtil."
                )}<input type="number" min="0" max="${Math.max(0, r.solar_priority_over - 1)}" data-rfield="ev_buffer_soc" value="${r.ev_buffer_soc}"></label>`
              : ""
          }

        </div>
        <div class="rules-section">Sol-ladning</div>
        <div class="rules-grid">
                      <label class="field">${head(
              "Sol-overskud beregnes fra",
              "Elnet-sensor: overskuddet er det, der sælges til nettet lige nu. Solproduktion − husforbrug: overskuddet er solcellernes produktion minus husets forbrug (minus det, husbatteriet lader med), så ladehastigheden følger produktionen direkte. Kræver solcelle-effekt under Konfigurer og en husforbrugs-sensor. I begge tilfælde trækkes det fra, som husbatteriet aflader med, så bilen ikke lader på batteriet."
            )}${sel("surplus_source", [["grid", "Elnet-sensor (eksport)"], ["solar_house", "Solproduktion − husforbrug"]])}</label>
          <label class="field">${head(
              "Elbil-sol: sol ≥ (W)",
              "Elbilen lader kun fra sol, når solcellerne producerer mindst dette i mindst det antal minutter, der står ved siden af. Falder produktionen under grænsen lige så længe, stopper bilen. Tom = kun overskuddet afgør det."
            )}<input type="number" min="0" step="100" data-rfield="solar_min_w" value="${r.solar_min_w === null ? "" : r.solar_min_w}" placeholder="fra"></label>
          <label class="field">${head(
              "… i mindst (min)",
              "Hvor længe produktionen og sol-overskuddet skal være over grænsen, før bilen starter, og under grænsen, før den stopper. Forhindrer tænd/sluk, når skyer passerer."
            )}<input type="number" min="0" step="0.5" data-rfield="solar_min_minutes" value="${r.solar_min_minutes}"></label>
          <label class="field">${head(
              "Ladestrøm hvert (sek)",
              "Ved solopladning sendes kun start-kommandoen, når bilen starter. Ladestrømmen (A) sendes første gang efter dette antal sekunder og justeres derefter højst så ofte, så laderen ikke bombarderes, når skyer passerer. Gælder kun biler med en strøm-entitet."
            )}<input type="number" min="5" step="5" data-rfield="amps_interval_seconds" value="${r.amps_interval_seconds}"></label>

        </div>
        <div class="rules-section">Elnet</div>
        <div class="rules-grid">
                      <label class="field">${head(
              "Hovedsikring (A)",
              "Maks. strøm pr. fase, som elbiler og husbatteri må trække fra nettet tilsammen. Tom = ingen grænse. Kun med en grænse har rækkefølgen ved sikringen betydning."
            )}<input type="number" min="0" step="1" data-rfield="max_total_amps" value="${r.max_total_amps === null ? "" : r.max_total_amps}" placeholder="ingen grænse"></label>

        </div>
        <div class="rules-now hint"><div class="rules-now-title">Forklaring på nuværende indstillinger</div>${ElectricityOptimizerPanel._sentences(this._solarPriorityText(r))
          .map((t) => `<div><strong>${esc(t)}</strong></div>`)
          .join("")}${ElectricityOptimizerPanel._sentences(
          `${this._solarConditionsText(r)}${hasFuse ? ` Ved fuld hovedsikring (${fmtNum(r.max_total_amps, 0)} A) får ${r.grid_priority === "battery" ? "husbatteriet" : "elbilen"} strømmen først.` : ""}`
        )
          .map((t) => `<div>${esc(t)}</div>`)
          .join("")}</div>
        <div class="rules-toggles">
          ${
            r.solar_priority === "battery"
              ? `<label class="toggle"><input type="checkbox" data-rfield="battery_to_ev_above_limit" ${r.battery_to_ev_above_limit === false ? "" : "checked"}> Husbatteri må lade bilen over øvre grænse${info(
                  "Når husbatteriet er nr. 1 og over 'Prioriter over', må dets afladning bruges til at lade bilen, hvis solen ikke rækker. Bilen får eksporten plus batteriets ledige afladeeffekt (maks. afladeeffekt minus det, batteriet allerede leverer til huset). Når batteriet igen er under grænsen, stopper bilen."
                )}</label>`
              : ""
          }
        ${
          r.surplus_source === "solar_house"
            ? `<label class="toggle"><input type="checkbox" data-rfield="house_includes_ev" ${r.house_includes_ev === false ? "" : "checked"}> Husforbruget inkluderer elbilens ladning${info(
                "Slå til, hvis husforbrugs-sensoren også tæller det, elbilen trækker (typisk for inverterens load-sensor). Så lægges bilens eget træk til overskuddet, mens den lader, så den ikke skruer sig selv ned."
              )}</label>`
            : ""
        }
        <label class="toggle"><input type="checkbox" data-rfield="notify_enabled" ${r.notify_enabled === false ? "" : "checked"}> Notifikationer${info(
          "Vis en notifikation i Home Assistant, når en elbil ikke kan nå sit mål-SoC inden deadline, når en bil skulle lade men ikke er tilsluttet, og når en kommando til bil eller husbatteri fejler. Hændelsen electricity_optimizer_notification sendes altid, så du kan lave automationer."
        )}</label>
        <label class="toggle"><input type="checkbox" data-rfield="hold_battery_while_ev_grid_charging" ${r.hold_battery_while_ev_grid_charging ? "checked" : ""}> Hold husbatteri ved net-ladning${info(
          "Når en elbil lader fra nettet, sættes husbatteriet på hold, så det ikke aflader ind i bilen i stedet for at gemme strømmen til dyre timer."
        )}</label>
        </div>
        ${sensorForm}
        ${
          ctx.surplus_w !== undefined && ctx.surplus_w !== null
            ? `<div class="hint" style="margin-top:8px">Ved sidste beregning: sol-overskud ${fmtNum(ctx.surplus_w, 0)} W${ctx.solar_w !== undefined && ctx.solar_w !== null ? ` · solproduktion ${fmtNum(ctx.solar_w, 0)} W` : ""}${ctx.house_w !== undefined && ctx.house_w !== null ? ` · husforbrug ${fmtNum(ctx.house_w, 0)} W` : ""}.</div>`
            : ""
        }
        ${this._rulesError ? `<div class="err">${esc(this._rulesError)}</div>` : ""}
      </div>`;
  }

  async _onRulesClick(btn, ev) {
    const action = btn.dataset.raction;
    if (action === "prio-swap") {
      await this._setSolarPriority(this._rules.solar_priority === "battery" ? "ev" : "battery");
      return;
    }
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

  /** One short reason line per car for the status bar (why it is or is not charging right now). */
  _carStatusDetail(car, rt) {
    const r = this._rules;
    const plan = rt.plan;
    switch (rt.status) {
      case "solar_low":
        return r ? `Solproduktion ${fmtNum(rt.solar_w || 0, 0)} W – kræver ${fmtNum(r.solar_min_w, 0)} W i ${r.solar_min_minutes} min` : "";
      case "solar_wait":
        return rt.surplus_w !== undefined ? `Sol-overskud ${fmtNum(rt.surplus_w, 0)} W – kræver ${fmtNum(car.min_amps * 230 * car.phases, 0)} W` : "";
      case "battery_first":
        return r ? (r.solar_priority === "battery" ? `Husbatteriet har forrang op til ${r.solar_priority_over} %` : `Bilen er over ${r.solar_priority_over} % – husbatteriet har forrang`) : "";
      case "solar_min":
        return r ? `Husbatteriet har forrang op til ${r.solar_priority_over} % – bilen kører med min. ladestrøm${rt.amps ? ` (${rt.amps} A)` : ""}` : "";
      case "waiting":
        if (plan && plan.next_start) {
          const ns = new Date(plan.next_start);
          return `Næste planlagte ladning ${ns.getDate() === new Date().getDate() ? "i dag" : "i morgen"} kl. ${fmtTime(ns)}`;
        }
        return "";
      case "solar":
      case "charging":
      case "below_limit":
      case "charge_now":
        return rt.amps ? `${rt.amps} A` : "";
      case "done":
        return `${fmtNum(rt.soc, 0)} % – mål ${rt.target_soc !== undefined ? rt.target_soc : car.target_soc} % nået`;
      case "no_soc":
        return `Ingen værdi fra ${car.soc_entity}`;
      case "no_grid_sensor":
        return "Vælg sensorer under Regler for opladning";
      case "no_solar_sensor":
        return "Vælg solcelle-effekt under Konfigurer";
      case "fuse_wait":
        return "Hovedsikringen er optaget";
      case "no_power":
        return "Start er sendt, men bilen trækker ingen strøm – start gensendes hvert 5. min. Tjek laderen";
      case "cmd_failed":
        return rt.last_action && rt.last_action.error ? `${rt.last_action.error} – prøver igen om et minut` : "Kommandoen blev afvist – prøver igen om et minut";
      case "not_plugged":
        return "Sæt bilen i laderen";
      default:
        return "";
    }
  }

  static BATTERY_NOTE = {
    no_soc: "SoC-sensoren har ingen værdi",
    no_prices: "Ingen priser fra EnergiDataService",
    disabled: "Smart styring er slået fra",
    override: "Manuel styring – tryk Auto for at følge planen",
    full: "Batteriet er fyldt til maks-SoC",
    ev_hold: "Holdes, fordi en elbil lader fra nettet (regel)",
    day_off: "Slået fra i ugeplanen i dag – batteriet kører selv",
    fuse_wait: "Venter – hovedsikringen er optaget af elbil (regel)",
  };

  /** Status bar under the tabs: what every car and the house battery is doing right now, and why. */
  _renderStatusBar() {
    const K = ElectricityOptimizerPanel;
    const chips = [];
    for (const car of this._cars || []) {
      const rt = car.runtime || {};
      const [text, cls] = K.STATUS_TEXT[rt.status] || ["–", "neutral"];
      const detail = this._carStatusDetail(car, rt);
      chips.push(`<div class="sb-item" data-goto="ev"><ha-icon icon="mdi:car-electric"></ha-icon><span class="sb-name">${esc(car.name)}</span><span class="badge ${cls}">${text}</span>${
        detail ? `<span class="sb-detail">${esc(detail)}</span>` : ""
      }</div>`);
    }
    if (this._battery) {
      const rt = this._batteryRuntime || {};
      const [modeText, modeCls, modeWhy] = K.MODE_TEXT[rt.mode] || ["–", "neutral", ""];
      const detail = K.BATTERY_NOTE[rt.status] || modeWhy || "";
      chips.push(`<div class="sb-item" data-goto="battery"><ha-icon icon="mdi:home-battery"></ha-icon><span class="sb-name">Husbatteri</span><span class="badge ${modeCls}">${modeText}</span>${
        detail ? `<span class="sb-detail">${esc(detail)}</span>` : ""
      }</div>`);
    }
    if (!chips.length) return "";
    return `<div class="statusbar">${chips.join("")}</div>`;
  }

  /** Shorter wording for the badge in the Status card; the full text stays in the description. */
  static STATUS_BADGE_SHORT = { battery_first: "Venter" };

  _renderEvStatusRow() {
    const cars = this._cars;
    if (!cars || !cars.length) {
      return `<div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbiler</div><div class="d">Ingen biler tilføjet – se fanen Elbiler</div></div><span class="badge neutral">Ikke sat op</span></div>`;
    }
    const K = ElectricityOptimizerPanel;
    const charging = cars.filter((c) => c.runtime && c.runtime.charging).length;
    const desc = cars
      .map((c) => {
        const v = this._numState(c.soc_entity).value;
        const [text] = K.STATUS_TEXT[(c.runtime || {}).status] || ["–"];
        return `${c.name}: ${v !== null ? fmtNum(v, 0) + " %" : "–"} – ${text}`;
      })
      .join(" · ");
    // badge: how many charge, else the most relevant waiting/blocking status, else done
    let badge = ["Klar", "low"];
    if (charging) badge = [`${charging} lader`, "low"];
    else {
      const active = cars.find((c) => c.runtime && c.runtime.status && !["done", "disabled"].includes(c.runtime.status)) || cars.find((c) => c.runtime && c.runtime.status);
      if (active) {
        const [text, cls] = K.STATUS_TEXT[active.runtime.status] || ["–", "neutral"];
        badge = [K.STATUS_BADGE_SHORT[active.runtime.status] || text, cls];
      }
    }
    return `<div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbiler</div><div class="d">${esc(desc)}</div></div><span class="badge ${badge[1]}">${esc(badge[0])}</span></div>`;
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
      ${body}
      ${this._renderRulesCard()}`;
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
      if (rt.charging && rt.status !== "no_power") meta.push("Lader lige nu");
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
      if (rt.status === "no_power") meta.push(`Start er sendt${rt.amps ? ` og ${rt.amps} A er sat` : ""}, men bilen trækker ${fmtNum(liveW || 0, 0)} W – start gensendes hvert 5. minut`);
      else meta.push(`${rt.mode === "solar" ? "Lader fra sol" : "Lader"}${parts.length ? " med " + parts.join(" · ") : ""}`);
    } else if (liveW !== null && liveW > 50) {
      meta.push(`Bilen trækker ${fmtNum(liveW, 0)} W`);
    }
    if (rt.charging && rt.battery_assist_w) meta.push(`Husbatteriet må hjælpe med op til ${fmtNum(rt.battery_assist_w, 0)} W, til det er under ${this._rules ? this._rules.solar_priority_over : "–"} %`);
    if (rt.status === "solar_wait" && rt.surplus_w !== undefined) meta.push(`Sol-overskud lige nu ${fmtNum(rt.surplus_w, 0)} W – kræver ${car.min_amps * 230 * car.phases} W${rt.battery_discharge_w ? ` (husbatteriet aflader ${fmtNum(rt.battery_discharge_w, 0)} W, som er trukket fra)` : ""}`);
    if (rt.status === "solar_low" && rt.solar_w !== undefined && this._rules) meta.push(`Solproduktion ${fmtNum(rt.solar_w, 0)} W – kræver ${fmtNum(this._rules.solar_min_w, 0)} W i ${this._rules.solar_min_minutes} min`);
    if (rt.status === "battery_first" && this._rules) meta.push(this._rules.solar_priority === "battery" ? `Husbatteriet har forrang op til ${this._rules.solar_priority_over} %${this._rules.ev_buffer_soc ? ` (bilen venter under ${this._rules.ev_buffer_soc} %)` : ""}` : `Bilen er over ${this._rules.solar_priority_over} % – husbatteriet har forrang`);
    if (rt.status === "solar_min" && this._rules) meta.push(`Husbatteriet har forrang op til ${this._rules.solar_priority_over} % – bilen kører med min. ladestrøm`);
    if (rt.last_action) {
      const la = rt.last_action;
      const actionText = { start: "start", stop: "stop", set_amps: "sæt ladestrøm" }[la.action] || la.action;
      meta.push(`Sidste kommando: ${actionText} kl. ${fmtTime(new Date(la.at))}${la.ok ? " (sendt)" : ` – fejlede: ${la.error || ""}`}`);
    }
    const socPct = soc === null ? 0 : Math.max(0, Math.min(100, soc));
    return `
      <div class="card" data-car="${car.id}">
        <h2><ha-icon icon="mdi:car-electric"></ha-icon>${esc(car.name)} <span class="hint" style="font-weight:400">#${index + 1}</span>${I("Nummeret er bilens prioritet: ved sol-overskud og ved hovedsikringen får bil #1 strøm først. Flyt rækkefølgen med pilene nederst på kortet. Mærkatet viser bilens status lige nu.")} <span class="badge ${statusCls}" style="margin-left:auto">${statusText}</span></h2>
        <div class="kpi">
          <div class="value">${soc === null ? "–" : fmtNum(soc, 0) + " %"}<small>mål ${plan && plan.target_soc ? plan.target_soc : car.target_soc} %</small></div>
        </div>
        <div class="soc-bar"><div class="fill ${rt.charging ? "charging" : ""}" style="width:${socPct}%"></div><div class="target" style="left:${car.target_soc}%"></div></div>
        <div class="car-meta">${meta.map((m) => `<div>${esc(m)}</div>`).join("")}</div>
        ${plan ? this._renderPlanStrip(plan) : ""}
        <div class="controls">
          <label class="toggle"><input type="checkbox" data-field="enabled" ${car.enabled ? "checked" : ""}> Smart opladning${I("Til: Electricity Optimizer starter og stopper bilens opladning efter ugeplan og regler. Fra: der sendes ingen kommandoer til bilen, bortset fra når du trykker Lad nu.")}</label>
          <label class="field"><span class="fl">Prisgrænse (kr/kWh)${I("Bilen lader altid, når prisen lige nu er under denne grænse, uanset planen. Tom = ingen prisgrænse.")}</span><input type="number" step="0.01" data-field="price_limit" value="${car.price_limit === null || car.price_limit === undefined ? "" : car.price_limit}" placeholder="fra"></label>
          <label class="field"><span class="fl">Min. ladestrøm (A)${I("Laveste strøm laderen må sættes til (må ikke være højere end maks.). Ved solopladning startes først, når overskuddet rækker til denne strøm.")}</span><input type="number" min="1" max="64" step="1" data-field="min_amps" value="${car.min_amps}"></label>
          <label class="field"><span class="fl">Maks. ladestrøm (A)${I("Højeste strøm laderen må sættes til. Planen regner med maks. ladestrøm × 230 V × antal faser.")}</span><input type="number" min="1" max="64" step="1" data-field="max_amps" value="${car.max_amps}"></label>
        </div>
        ${this._renderSchedule(car)}
        <div class="row" style="margin-top:12px">
          <button class="btn ${car.charge_now ? "active" : ""}" data-action="charge-now" title="Starter opladning med det samme uanset plan, mål-SoC og Smart opladning. Kører til bilen er fuld, tages ud af laderen, eller du trykker Stop.">${car.charge_now ? "Stop 'Lad nu'" : "Lad nu"}</button>
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
          <thead><tr><th>Dag${I("Rækken Alle dage sætter samme værdi på alle ugedage. Dagens række er fremhævet.")}</th><th>Til${I("Skal bilen lades den dag. Fra = ingen kommandoer den dag.")}</th><th>Kilde${I("Kun sol: lader kun på sol-overskud. Sol + billige timer: sol om dagen og de billigste timer inden deadline. Kun billige timer: kun netopladning i de billigste timer.")}</th><th>Klar senest${I("Tidspunkt hvor mål-SoC skal være nået. Planen vælger de billigste timer inden da. Ligger tidspunktet før nu, gælder næste dag.")}</th><th>Mål-SoC %${I("Ladestand bilen skal nå inden tidspunktet. Er bilen allerede over, sker der ingen opladning.")}</th></tr></thead>
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

  /* Shared plan strip used by cars and the battery: same height, hour ticks every 6 h, day boundary
     markers, current slot outlined, estimated (unknown price) slots dimmed. */
  _renderStrip(slots, classOf, labelOf) {
    if (!slots.length) return "";
    const t0 = Math.min(Date.now(), new Date(slots[0].start).getTime());
    const t1 = new Date(slots[slots.length - 1].end).getTime();
    const W = 600, H = 44, barH = 20, textY = H - 4;
    const x = (t) => ((t - t0) / (t1 - t0)) * W;
    const now = Date.now();
    const rects = slots
      .map((s) => {
        const a = new Date(s.start).getTime(), b = new Date(s.end).getTime();
        const isNow = a <= now && now < b;
        return `<rect class="slot ${classOf(s)} ${s.estimated ? "est" : ""} ${isNow ? "now" : ""}" x="${x(a).toFixed(1)}" y="0" width="${Math.max(0.5, x(b) - x(a) - 0.5).toFixed(1)}" height="${barH}" rx="2"><title>${esc(`${fmtTime(new Date(a))} · ${fmtNum(s.price)}${s.estimated ? " (estimat)" : ""} · ${labelOf(s)}`)}</title></rect>`;
      })
      .join("");
    const marks = [];
    let prevDay = null;
    for (const s of slots) {
      const d = new Date(s.start);
      const day = d.getDate();
      if (prevDay !== null && day !== prevDay) {
        const xx = x(d.getTime()).toFixed(1);
        marks.push(`<line class="strip-day" x1="${xx}" x2="${xx}" y1="0" y2="${barH + 4}"/>`);
        marks.push(`<text class="tick" x="${x(d.getTime()) + 3}" y="${textY}">${DAY_SHORT[(d.getDay() + 6) % 7]}</text>`);
      } else if (d.getMinutes() === 0 && d.getHours() % 6 === 0) {
        marks.push(`<text class="tick" x="${x(d.getTime()).toFixed(1)}" y="${textY}">${pad2(d.getHours())}</text>`);
      }
      prevDay = day;
    }
    return `<svg class="plan-strip" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}${marks.join("")}</svg>`;
  }

  _renderPlanStrip(plan) {
    const slots = plan.plan || [];
    if (!slots.length) return "";
    return `${this._renderStrip(slots, (s) => (s.chosen ? "chosen" : ""), (s) => (s.chosen ? "Planlagt ladning" : "Ingen ladning"))}
      <div class="legend"><span class="l-normal">Ingen ladning</span><span class="l-charge">Planlagt ladning</span><span class="l-est">Estimat (pris ukendt)</span></div>`;
  }

  _renderCarForm(car) {
    const v = (k, d = "") => esc(car[k] === undefined || car[k] === null ? d : car[k]);
    const isNew = !car.id;
    const errText = {
      name_required: "Navn mangler.",
      soc_required: "Vælg en SoC-sensor.",
      start_stop_required: "Vælg både start- og stop-entitet.",
      capacity_power_positive: "Kapacitet og ladestrøm skal være større end 0.",
      min_amps_above_max: "Min. ladestrøm må ikke være højere end maks. ladestrøm.",
      current_entity_number: "Strømgrænse-entiteten skal være en number- eller input_number-entitet.",
      ready_by_invalid: "Ugyldigt klokkeslæt.",
    };
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:car-electric"></ha-icon>${isNew ? "Tilføj bil" : `Rediger ${esc(car.name)}`}</h2>
        <form class="car-form" data-id="${v("id")}">
          <div class="form-section">Bil</div>
          <div class="form-grid">
            <label class="field"><span class="fl">Navn${I("Vises på kortet, i statuslinjen og i prisdiagrammets forklaring.")}</span><input name="name" value="${v("name")}" placeholder="fx Tesla" required></label>
            <label class="field"><span class="fl">SoC-sensor (%)${I("Sensor med bilens ladestand i procent, typisk fra bilens egen integration. Uden den kan der ikke planlægges.")}</span><div class="picker"><input name="soc_entity" data-domains="sensor" value="${v("soc_entity")}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Batterikapacitet (kWh)${I("Bilens batteristørrelse. Bruges til at beregne, hvor mange kWh og timer der skal lades for at nå mål-SoC.")}</span><input name="capacity_kwh" type="number" step="0.1" min="1" value="${v("capacity_kwh", 60)}"></label>
            <label class="field"><span class="fl">Tilsluttet-sensor (valgfri)${I("binary_sensor der er tændt, når bilen sidder i laderen. Uden den antages bilen altid tilsluttet.")}</span><div class="picker"><input name="plugged_entity" data-domains="binary_sensor" value="${v("plugged_entity")}" placeholder="binary_sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
          </div>
          <div class="form-section">Lader</div>
          <div class="form-grid">
            ${this._cmdFields("Start opladning", "start_entity", "start_value", v)}
            ${this._cmdFields("Stop opladning", "stop_entity", "stop_value", v)}
            <label class="field"><span class="fl">Laderens strøm-entitet (valgfri)${I("number-entitet på laderen, som ladestrømmen i ampere sendes til. Ved solopladning sendes den først efter det interval, der er valgt under Regler, og justeres derefter løbende efter overskuddet. Uden den lades altid med maks. ladestrøm.")}</span><div class="picker"><input name="current_entity" data-domains="number,input_number" value="${v("current_entity")}" placeholder="number.… fx laderens 'charger current limit'" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Ladeeffekt-sensor (W, valgfri)${I("Bilens eller laderens faktiske effekt. Vises live og bruges i sol-regnestykket, så bilens eget træk ikke tæller som husforbrug.")}</span><div class="picker"><input name="power_entity" data-domains="sensor" value="${v("power_entity")}" placeholder="sensor.… bilens/laderens effekt" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Faser${I("Antal faser laderen bruger. Effekt = ladestrøm × 230 V × faser.")}</span><select name="phases">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(car.phases || 3) === n ? "selected" : ""}>${n} fase${n > 1 ? "r" : ""}</option>`).join("")}</select></label>
            <label class="field"><span class="fl">Min. ladestrøm (A)${I("Laveste strøm laderen må sættes til (må ikke være højere end maks.). Ved solopladning startes først, når overskuddet rækker til denne strøm.")}</span><input name="min_amps" type="number" step="1" min="1" max="64" value="${v("min_amps", 6)}"></label>
            <label class="field"><span class="fl">Maks. ladestrøm (A)${I("Højeste strøm laderen må sættes til. Planen regner med maks. ladestrøm × 230 V × antal faser.")}</span><input name="max_amps" type="number" step="1" min="1" max="64" value="${v("max_amps", 16)}"></label>
          </div>
          <div class="form-section">Plan</div>
          <div class="form-grid">
            <label class="field"><span class="fl">Kilde (alle dage)${I("Startværdi for alle ugedage; kan ændres pr. dag bagefter. Kun sol: kun sol-overskud. Sol + billige timer: sol om dagen og billigste timer inden deadline. Kun billige timer: kun netopladning.")}</span><select name="source">${Object.entries(ElectricityOptimizerPanel.SOURCE_TEXT).map(([val, l]) => `<option value="${val}" ${(car.source || "solar_plan") === val ? "selected" : ""}>${l}</option>`).join("")}</select></label>
            ${isNew ? `<label class="field"><span class="fl">Klar senest (alle dage)${I("Startværdi for alle ugedage. Kan ændres pr. dag i ugeplanen bagefter.")}</span>${timeInput('name="ready_by"', car.ready_by || "07:00")}</label>
            <label class="field"><span class="fl">Mål-SoC % (alle dage)${I("Startværdi for alle ugedage. Kan ændres pr. dag i ugeplanen bagefter.")}</span><input name="target_soc" type="number" min="1" max="100" value="${v("target_soc", 80)}"></label>` : ""}
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

  /** "Test" next to a start/stop entity: run it now and show the outcome under the field. */
  async _testCommand(btn) {
    const form = btn.closest("form");
    const entityKey = btn.dataset.testcmd;
    const val = (name) => {
      const el = form && form.querySelector(`[name="${name}"]`);
      return el ? el.value.trim() : "";
    };
    const entityId = val(entityKey);
    const value = val(btn.dataset.valuekey);
    const isStop = /stop/.test(entityKey);
    const startKey = entityKey.replace("stop", "start");
    const out = form.querySelector(`[data-testresult="${entityKey}"]`);
    if (!entityId) {
      out.className = "cmd-result hint fail";
      out.textContent = "Vælg en entitet først.";
      return;
    }
    out.className = "cmd-result hint";
    out.textContent = `Sender til ${entityId}…`;
    btn.disabled = true;
    try {
      await this._hass.callWS({
        type: "electricity_optimizer/command/test",
        entity_id: entityId,
        value: value || null,
        is_stop: isStop,
        start_entity: isStop ? val(startKey) || null : null,
      });
      out.className = "cmd-result hint ok";
      out.textContent = `Sendt kl. ${fmtTime(new Date())} – tjek at laderen reagerer.`;
    } catch (err) {
      out.className = "cmd-result hint fail";
      out.textContent = `Fejlede: ${err && err.message ? err.message : err}`;
    } finally {
      btn.disabled = false;
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
    const testBtn = ev.target.closest && ev.target.closest("[data-testcmd]");
    if (testBtn) {
      await this._testCommand(testBtn);
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

  _cmdFields(label, entityKey, valueKey, v, tip = ElectricityOptimizerPanel.CMD_HINT) {
    return `
      <div class="field cmd-field"><span class="fl">${label}${I(tip)}</span>
        <div class="cmd">
          <div class="picker"><input name="${entityKey}" data-domains="${ElectricityOptimizerPanel.CMD_DOMAINS}" value="${v(entityKey)}" placeholder="entitet" autocomplete="off"><div class="picker-list" hidden></div></div>
          <input name="${valueKey}" value="${v(valueKey)}" placeholder="værdi (select/number)">
          <button type="button" class="btn" data-testcmd="${entityKey}" data-valuekey="${valueKey}" title="Send kommandoen nu og se, om den virker">Test</button>
        </div>
        <div class="cmd-result hint" data-testresult="${entityKey}"></div>
      </div>`;
  }

  /* ---------- history ---------- */

  async _loadHistory(force = false) {
    if (!this._hass || !this._hass.callWS) return;
    const now = Date.now();
    if (!force && this._historyLoadedAt && now - this._historyLoadedAt < 10000) return;
    if (this._historyLoading) return;
    this._historyLoading = true;
    try {
      const res = await this._hass.callWS({ type: "electricity_optimizer/history/list" });
      this._historyLoadedAt = Date.now();
      const json = JSON.stringify(res);
      if (json !== this._historyJson) {
        this._history = res;
        this._historyJson = json;
        this._historyStamp = Date.now();
        this._maybeRender();
      }
    } catch (err) {
      this._historyError = err && err.message ? err.message : String(err);
    } finally {
      this._historyLoading = false;
    }
  }

  static _sumHistory(items, since) {
    const out = { kwh: 0, solar: 0, cost: 0, saved: 0, n: 0 };
    for (const e of items) {
      const t = new Date(e.end || e.last || e.start).getTime();
      if (t < since) continue;
      out.kwh += e.kwh || 0;
      out.solar += e.solar_kwh || 0;
      out.cost += e.cost || 0;
      out.saved += e.saved || 0;
      out.n++;
    }
    return out;
  }

  _renderHistory() {
    const h = this._history;
    if (!h) return `<div class="card"><div class="empty"><ha-icon icon="mdi:timer-sand"></ha-icon>Henter historik…</div></div>`;
    const all = [...(h.open || []), ...(h.entries || [])];
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const periods = [
      ["I dag", dayStart],
      ["7 dage", now.getTime() - 7 * 864e5],
      ["30 dage", now.getTime() - 30 * 864e5],
    ];
    const kr = (v) => `${fmtNum(v, 2)}<small>kr</small>`;
    const cards = periods
      .map(([label, since]) => {
        const t = ElectricityOptimizerPanel._sumHistory(all, since);
        return `
          <div class="card kpi">
            <div class="label"><ha-icon icon="mdi:calendar-range"></ha-icon>${label}${I(`Summen af ladeperioder, der er afsluttet (eller i gang) i perioden: ${label.toLowerCase()}.`)}</div>
            <div class="value">${fmtNum(t.kwh + t.solar, 1)}<small>kWh ladet</small></div>
            <div class="sub">heraf ${fmtNum(t.solar, 1)} kWh fra sol · ${fmtNum(t.kwh, 1)} kWh fra nettet</div>
            <div class="sub">Betalt ${kr(t.cost)} · sparet <strong>${kr(t.saved)}</strong> · ${t.n} ${t.n === 1 ? "periode" : "perioder"}</div>
          </div>`;
      })
      .join("");
    const src = (e) => (e.source === "solar" ? '<span class="badge low">Sol</span>' : '<span class="badge mid">Net</span>');
    const rows = all
      .map((e) => {
        const start = new Date(e.start);
        const end = e.end ? new Date(e.end) : null;
        const total = (e.kwh || 0) + (e.solar_kwh || 0);
        const avg = e.kwh > 0 && e.price_kwh !== undefined ? e.price_kwh / e.kwh : e.kwh > 0 ? e.cost / e.kwh : null;
        const soc = e.soc_start !== null && e.soc_start !== undefined && e.soc_end !== null && e.soc_end !== undefined ? `${fmtNum(e.soc_start, 0)} → ${fmtNum(e.soc_end, 0)} %` : "–";
        return `<tr class="${e.running ? "running" : ""}">
          <td>${fmtDate(start)} ${fmtTime(start)}</td>
          <td>${end ? `${fmtDate(end) === fmtDate(start) ? "" : fmtDate(end) + " "}${fmtTime(end)}` : '<span class="badge info">i gang</span>'}</td>
          <td>${esc(e.name)}</td>
          <td>${src(e)}</td>
          <td class="num">${fmtNum(total, 2)}</td>
          <td class="num">${fmtNum(e.cost || 0, 2)}</td>
          <td class="num">${avg === null ? "–" : fmtNum(avg, 2)}</td>
          <td class="num">${fmtNum(e.saved || 0, 2)}</td>
          <td class="num">${soc}</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="grid">${cards}</div>
      <div class="card">
        <h2><ha-icon icon="mdi:history"></ha-icon>Ladeperioder${I(
          "Hver periode, hvor en elbil eller husbatteriet har ladet. kWh regnes ud fra ladeeffekt-sensoren (ellers ladestrøm × 230 V × faser) for hvert minut. Betalt = kWh fra nettet × elprisen i den time. Sparet: solstrøm regnes som det, samme energi ville have kostet fra nettet; netopladning regnes i forhold til dagens gennemsnitspris. Der gemmes 90 dage."
        )}</h2>
        ${
          all.length
            ? `<div class="chart-wrap"><table class="history">
          <thead><tr><th>Start</th><th>Slut</th><th>Hvad</th><th>Kilde</th><th style="text-align:right">kWh</th><th style="text-align:right">Betalt kr</th><th style="text-align:right">Gns. kr/kWh</th><th style="text-align:right">Sparet kr</th><th style="text-align:right">SoC</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
            : `<div class="empty"><ha-icon icon="mdi:battery-clock"></ha-icon>Ingen ladeperioder endnu. De dukker op her, når en bil eller husbatteriet har ladet.</div>`
        }
        ${this._historyError ? `<div class="err">${esc(this._historyError)}</div>` : ""}
      </div>
      ${this._renderCommandLog(h.commands || [])}`;
  }

  _renderCommandLog(commands) {
    const rows = commands
      .map((c) => {
        const at = new Date(c.at);
        return `<tr class="${c.ok ? "" : "failed"}">
          <td>${fmtDate(at)} ${fmtTime(at)}</td>
          <td>${esc(c.who || "")}</td>
          <td>${esc(c.action || "")}</td>
          <td><code>${esc(c.entity_id || "")}</code>${c.value ? ` = ${esc(c.value)}` : ""}</td>
          <td>${esc(c.service || "")}</td>
          <td>${c.ok ? '<span class="badge low">OK</span>' : `<span class="badge high">Fejl</span> ${esc(c.error || "")}`}</td>
        </tr>`;
      })
      .join("");
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:console-line"></ha-icon>Sendte kommandoer${I(
          "Alle kommandoer, integrationen har sendt til ladere og husbatteri: start, stop, ladestrøm og manuelle tests fra formularen. Service er det kald, Home Assistant fik. OK betyder, at kaldet blev accepteret; om laderen faktisk reagerede, ses på bilens status. De seneste 300 gemmes."
        )}</h2>
        ${
          rows
            ? `<div class="chart-wrap"><table class="history cmdlog">
          <thead><tr><th>Tid</th><th>Hvem</th><th>Handling</th><th>Entitet</th><th>Service</th><th>Resultat</th></tr></thead>
          <tbody>${rows}</tbody></table></div>`
            : `<div class="empty"><ha-icon icon="mdi:console-line"></ha-icon>Ingen kommandoer sendt endnu.</div>`
        }
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
    const statusNote = { ...ElectricityOptimizerPanel.BATTERY_NOTE, auto: modeWhy }[rt.status] || "";
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
          <div class="label"><ha-icon icon="mdi:home-battery"></ha-icon>Batteri${I("Ladestand, kapacitet og reserve. Stregen på bjælken er reserven, som batteriet ikke aflades under.")}</div>
          <div class="value">${live.soc === null ? "–" : fmtNum(live.soc, 0) + " %"}<small>${fmtNum(b.capacity_kwh, 1)} kWh · reserve ${b.min_soc} %</small></div>
          <div class="soc-bar"><div class="fill ${live.batW > 0 ? "charging" : ""}" style="width:${socPct}%"></div><div class="target" style="left:${b.min_soc}%"></div></div>
          <div class="sub">${live.batW === null ? "Ingen effekt-sensor" : live.batW >= 0 ? `Lader med ${fmtNum(live.batW, 0)} W` : `Aflader med ${fmtNum(-live.batW, 0)} W`}</div>
        </div>
        <div class="card kpi">
          <div class="label"><ha-icon icon="mdi:state-machine"></ha-icon>Modus lige nu${I("Normal: batteriet styres af sin egen inverter. Hold: batteriet spares til dyrere timer senere. Lad fra nettet: batteriet lades i billige timer. Teksten under forklarer hvorfor.")}</div>
          <div class="value"><span class="badge ${modeCls}" style="font-size:16px;padding:4px 14px">${modeText}</span></div>
          <div class="sub">${esc(statusNote)}</div>
          <div class="sub">${esc(why)}</div>
        </div>
        <div class="card">
          <h2><ha-icon icon="mdi:swap-vertical"></ha-icon>Energiflow${I("Effekt lige nu for elnet (køb/salg), husforbrug og batteri (lader/aflader) fra sensorerne under Rediger.")}</h2>
          <div class="flow">
            <div class="item ${live.gridW > 0 ? "in" : "out"}"><ha-icon icon="mdi:transmission-tower"></ha-icon><div><div class="v">${live.gridW === null ? "–" : fmtNum(Math.abs(live.gridW), 0) + " W"}</div><div class="l">${live.gridW === null ? "Elnet" : live.gridW > 0 ? "Køber fra nettet" : "Sælger til nettet"}</div></div></div>
            <div class="item"><ha-icon icon="mdi:home-lightning-bolt"></ha-icon><div><div class="v">${live.houseW === null ? "–" : fmtNum(live.houseW, 0) + " W"}</div><div class="l">Husforbrug</div></div></div>
            <div class="item ${live.batW > 0 ? "out" : live.batW < 0 ? "in" : ""}"><ha-icon icon="mdi:battery-charging"></ha-icon><div><div class="v">${live.batW === null ? "–" : fmtNum(Math.abs(live.batW), 0) + " W"}</div><div class="l">${live.batW === null ? "Batteri" : live.batW >= 0 ? "Batteri lader" : "Batteri aflader"}</div></div></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h2><ha-icon icon="mdi:chart-timeline"></ha-icon>Plan${I("Planlagt modus pr. tidsrum for i dag og i morgen. Manuel-knapperne overstyrer planen, indtil Auto vælges igen. Knapper uden kommandoer er slået fra.")}</h2>
        ${plan ? this._renderBatteryPlanStrip(plan) : '<div class="hint">Ingen plan endnu.</div>'}
        <div class="legend"><span class="l-normal">Normal</span><span class="l-hold">Hold</span><span class="l-charge">Lad fra nettet</span><span class="l-est">Estimat (pris ukendt)</span></div>
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
        <h2><ha-icon icon="mdi:tune"></ha-icon>Indstillinger${I("Regler for hvornår batteriet holdes tilbage eller lades fra nettet. Hvert felt gemmes med det samme.")}</h2>
        <div class="controls">
          <label class="toggle"><input type="checkbox" data-bfield="enabled" ${b.enabled ? "checked" : ""}> Smart styring${I("Til: Electricity Optimizer sender hold- og lad-kommandoer efter planen. Fra: planen vises, men der sendes ingen kommandoer.")}</label>
          <label class="field"><span class="fl">Prisforskel (kr/kWh)${I("Hold: prisen nu skal være under dagens gennemsnit, og en senere time mindst så meget dyrere. Lad fra nettet: en senere time skal være mindst så meget dyrere end nu, efter der er regnet med virkningsgraden.")}</span><input type="number" step="0.05" min="0" data-bfield="spread_threshold" value="${b.spread_threshold}"></label>
          <label class="field"><span class="fl">Reserve-SoC (%)${I("Batteriet aflades ikke under denne ladestand. Vises som streg på ladestands-bjælken.")}</span><input type="number" min="0" max="100" data-bfield="min_soc" value="${b.min_soc}"></label>
          <label class="field"><span class="fl">Maks-SoC ved netopladning (%)${I("Netopladning stopper, når batteriet når denne ladestand.")}</span><input type="number" min="0" max="100" data-bfield="max_soc" value="${b.max_soc}"></label>
          <label class="field"><span class="fl">Virkningsgrad (0–1)${I("Andel af den indkøbte strøm, der kommer ud af batteriet igen. 0,9 = 10 % tab ved op- og afladning. Indgår i prisforskel-reglen for netopladning.")}</span><input type="number" step="0.01" min="0.5" max="1" data-bfield="efficiency" value="${b.efficiency}"></label>
          <label class="field"><span class="fl">Lad kun fra net hvis solprognose &lt; (kWh)${I("Netopladning springes over på dage, hvor solprognosen er over denne grænse, fordi solen forventes at fylde batteriet. Tom = altid tilladt. Kræver prognose-sensorer under Konfigurer.")}</span><input type="number" step="0.5" min="0" data-bfield="grid_charge_max_forecast_kwh" value="${b.grid_charge_max_forecast_kwh === null || b.grid_charge_max_forecast_kwh === undefined ? "" : b.grid_charge_max_forecast_kwh}" placeholder="fra"></label>
        </div>
        ${this._renderForecastRuleHint(plan)}
        <div class="hint" style="margin-top:8px">Hold: prisen er under dagens gennemsnit, og en senere time er mindst prisforskellen dyrere. Lad fra nettet: kun på dage hvor det er tilladt, og kun når de dyreste timer bagefter (ganget med virkningsgraden) er mindst prisforskellen dyrere end nu – eller når ugeplanens mål-SoC skal nås inden klokkeslættet.</div>
        ${this._renderBatterySchedule(b, plan)}
        <div class="row" style="margin-top:12px">
          <button class="btn" data-baction="edit">Rediger</button>
          <button class="btn danger" data-baction="delete">Slet</button>
        </div>
        ${this._batteryError ? `<div class="err">${esc(this._batteryError)}</div>` : ""}
      </div>
      ${this._renderRulesCard()}`;
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
          <thead><tr><th>Dag${I("Rækken Alle dage sætter samme værdi på alle ugedage. Dagens række er fremhævet.")}</th><th>Til${I("Smart styring den dag. Fra = ingen kommandoer den dag.")}</th><th>Kilde${I("Kun sol: aldrig netopladning den dag. Sol + billige timer: må lade fra nettet efter prisforskel-reglen og mål-SoC.")}</th><th>Fuldt senest${I("Tidspunkt hvor mål-SoC skal være nået, med netopladning i de billigste timer inden.")}</th><th>Mål-SoC %${I("Ladestand batteriet skal nå inden tidspunktet. Tom = kun prisforskel-reglen afgør netopladning.")}</th></tr></thead>
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
    const label = { normal: "Normal", hold: "Hold", charge: "Lad fra nettet" };
    return this._renderStrip(slots, (s) => s.mode, (s) => label[s.mode] || s.mode);
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
          <div class="form-section">Sensorer</div>
          <div class="form-grid">
            <label class="field"><span class="fl">Batteri-SoC (%)${I("Sensor med batteriets ladestand i procent. Påkrævet.")}</span><div class="picker"><input name="soc_entity" data-domains="sensor" value="${v("soc_entity")}" placeholder="sensor.…" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Batteri-effekt (W, fortegn)${I("Én sensor med batteriets effekt, hvor fortegnet viser retningen. Vælg fortegn i feltet ved siden af. Har batteriet separate sensorer, så brug de to felter nedenfor i stedet.")}</span><div class="picker"><input name="power_entity" data-domains="sensor" value="${v("power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Fortegn for batteri-effekt${I("Om sensoren viser positive tal, når batteriet lader, eller når det aflader.")}</span>${sel("power_sign", [["charge_positive", "Positiv = lader"], ["discharge_positive", "Positiv = aflader"]], "charge_positive")}</label>
            <label class="field"><span class="fl">…eller ladeeffekt (W)${I("Sensor med effekten ind i batteriet, hvis batteriet har separate sensorer for op- og afladning.")}</span><div class="picker"><input name="charge_power_entity" data-domains="sensor" value="${v("charge_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">…og afladeeffekt (W)${I("Sensor med effekten ud af batteriet, hvis batteriet har separate sensorer for op- og afladning.")}</span><div class="picker"><input name="discharge_power_entity" data-domains="sensor" value="${v("discharge_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Net import/eksport (W)${I("Sensor med effekt til og fra nettet. Vises på Forsiden og bruges til sol-overskud for elbiler.")}</span><div class="picker"><input name="grid_power_entity" data-domains="sensor" value="${v("grid_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
            <label class="field"><span class="fl">Fortegn for net${I("Om sensoren viser positive tal, når huset køber fra nettet, eller når huset sælger til nettet.")}</span>${sel("grid_sign", [["import_positive", "Positiv = køber"], ["export_positive", "Positiv = sælger"]], "import_positive")}</label>
            <label class="field"><span class="fl">Husforbrug (W)${I("Sensor med husets samlede forbrug. Vises på Forsiden og i Energiflow.")}</span><div class="picker"><input name="house_power_entity" data-domains="sensor" value="${v("house_power_entity")}" placeholder="sensor.… (valgfri)" autocomplete="off"><div class="picker-list" hidden></div></div></label>
          </div>
          <div class="form-section">Batteri</div>
          <div class="form-grid">
            <label class="field"><span class="fl">Kapacitet (kWh)${I("Batteriets brugbare størrelse. Bruges til at beregne, hvor mange timer netopladning tager.")}</span><input name="capacity_kwh" type="number" step="0.1" min="0.1" value="${v("capacity_kwh", 10)}"></label>
            <label class="field"><span class="fl">Maks. ladeeffekt (kW)${I("Højeste effekt batteriet kan lade med. Bruges til planens timeberegning, hovedsikringen og skalaen på Batteri effekt-gaugen.")}</span><input name="max_charge_kw" type="number" step="0.1" min="0.1" value="${v("max_charge_kw", 5)}"></label>
            <label class="field"><span class="fl">Maks. afladeeffekt (kW)${I("Højeste effekt batteriet kan aflade med. Bruges til skalaen på Batteri effekt-gaugen.")}</span><input name="max_discharge_kw" type="number" step="0.1" min="0.1" value="${v("max_discharge_kw", 5)}"></label>
          </div>
          <div class="form-section">Kommandoer: lad fra nettet (valgfri)${I("Kommandoer der tvinger batteriet til at lade fra nettet, fx en switch som force charge eller en select med værdien Charge. Uden dem vises planen kun.")}</div>
          <div class="form-grid">
            ${this._cmdFields("Start", "charge_start_entity", "charge_start_value", v)}
            ${this._cmdFields("Stop", "charge_stop_entity", "charge_stop_value", v)}
          </div>
          <div class="form-section">Kommandoer: hold batteriet – ingen afladning (valgfri)${I("Kommandoer der stopper afladning, fx en switch som stop discharge eller en select med værdien Hold. Uden dem vises planen kun.")}</div>
          <div class="form-grid">
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

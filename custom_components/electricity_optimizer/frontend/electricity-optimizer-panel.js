/*
 * Electricity Optimizer - Home Assistant sidebar panel.
 * Plain web component (no build step). Reads the EnergiDataService price
 * sensor straight from `hass.states` and renders an overview plus tabs for
 * EV charging and house battery settings.
 */

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
    this._timer = setInterval(() => this._maybeRender(), 30000);
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
    const key = [
      this._tab,
      st ? st.last_updated : "missing",
      solarKey,
      this._solarHistoryStamp || 0,
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
    else html = this._renderBattery();
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
            <div class="status-row"><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">Ikke tilknyttet endnu</div></div><span class="badge neutral">Senere</span></div>
            <div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbiler</div><div class="d">Ingen biler tilføjet</div></div><span class="badge neutral">Senere</span></div>
            <div class="status-row"><ha-icon icon="mdi:database-clock-outline"></ha-icon><div class="t"><div class="n">Prisdata</div><div class="d">${esc(d.attribution || "EnergiDataService")}${
              d.nextUpdate ? ` · næste opdatering ${fmtTime(new Date(d.nextUpdate))}` : ""
            }</div></div><span class="badge low">OK</span></div>
          </div>
        </div>
      </div>`;
  }

  _renderSolarStatusRow() {
    const s = this._readSolar();
    if (!s.configured) {
      return `<div class="status-row"><ha-icon icon="mdi:solar-power-variant"></ha-icon><div class="t"><div class="n">Solceller</div><div class="d">Ingen sensorer valgt – se fanen Solceller</div></div><span class="badge neutral">Ikke sat op</span></div>`;
    }
    const parts = [];
    if (s.powerKw !== null) parts.push(`${fmtNum(s.powerKw, 2)} kW lige nu`);
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
          <div class="value">${fmtNum(s.powerKw, 2)}<small>kW</small></div>
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
        <div class="card">
          <h2><ha-icon icon="mdi:lightbulb-on-outline"></ha-icon>Sådan bruges solstrømmen</h2>
          <div class="status-list">
            <div class="status-row"><ha-icon icon="mdi:car-electric"></ha-icon><div class="t"><div class="n">Elbil</div><div class="d">Overskud fra solceller går først til bilen (indstilles under Elbiler).</div></div></div>
            <div class="status-row"><ha-icon icon="mdi:home-battery"></ha-icon><div class="t"><div class="n">Hus batteri</div><div class="d">Resten lagres til de dyre timer (indstilles under Hus batteri).</div></div></div>
          </div>
        </div>
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

  _renderEv() {
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:car-electric"></ha-icon>Elbiler <span class="chip"><ha-icon icon="mdi:progress-wrench"></ha-icon>Kommer i næste trin</span></h2>
        <div class="empty">
          <ha-icon icon="mdi:car-electric-outline"></ha-icon>
          <div>Ingen elbiler er tilføjet endnu.</div>
        </div>
      </div>
      <div class="card">
        <h2><ha-icon icon="mdi:tune"></ha-icon>Planlagte indstillinger pr. bil</h2>
        <ul class="planned">
          <li><ha-icon icon="mdi:ev-station"></ha-icon><div><div class="n">Lader og bil</div><div class="d">Vælg laderens tænd/sluk-kontakt, ladeeffekt (A/kW) og bilens SoC-sensor.</div></div></li>
          <li><ha-icon icon="mdi:battery-charging-80"></ha-icon><div><div class="n">Ønsket opladning</div><div class="d">Mål-SoC eller antal kWh, og hvornår bilen skal være klar (fx kl. 07:00).</div></div></li>
          <li><ha-icon icon="mdi:weather-sunny"></ha-icon><div><div class="n">Solcelle-prioritet</div><div class="d">Lad primært på overskudsstrøm fra solceller, og fyld op i de billigste timer.</div></div></li>
          <li><ha-icon icon="mdi:cash-multiple"></ha-icon><div><div class="n">Prisgrænse</div><div class="d">Lad altid, når prisen er under en valgt grænse.</div></div></li>
        </ul>
      </div>`;
  }

  _renderBattery() {
    return `
      <div class="card">
        <h2><ha-icon icon="mdi:home-battery"></ha-icon>Hus batteri <span class="chip"><ha-icon icon="mdi:progress-wrench"></ha-icon>Kommer i næste trin</span></h2>
        <div class="empty">
          <ha-icon icon="mdi:home-battery-outline"></ha-icon>
          <div>Intet husbatteri er tilknyttet endnu.</div>
        </div>
      </div>
      <div class="card">
        <h2><ha-icon icon="mdi:tune"></ha-icon>Planlagte indstillinger</h2>
        <ul class="planned">
          <li><ha-icon icon="mdi:battery"></ha-icon><div><div class="n">Batteri</div><div class="d">Kapacitet (kWh), maks. lade-/afladeeffekt og SoC-sensor.</div></div></li>
          <li><ha-icon icon="mdi:battery-arrow-down-outline"></ha-icon><div><div class="n">Reserve</div><div class="d">Minimum SoC som batteriet aldrig aflades under.</div></div></li>
          <li><ha-icon icon="mdi:transmission-tower-import"></ha-icon><div><div class="n">Lad fra nettet</div><div class="d">Fyld batteriet i de billigste timer, når solen ikke rækker.</div></div></li>
          <li><ha-icon icon="mdi:transmission-tower-export"></ha-icon><div><div class="n">Aflad ved høj pris</div><div class="d">Brug batteriet til huset i de dyreste timer på dagen.</div></div></li>
        </ul>
      </div>`;
  }
}

if (!customElements.get("electricity-optimizer-panel")) {
  customElements.define("electricity-optimizer-panel", ElectricityOptimizerPanel);
}

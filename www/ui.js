// shinyreact PoC client -- no build step.
// shinyreact.js (served by page_react()) installs React, ReactDOM and the
// hooks on window.shinyreact, so we use React.createElement instead of JSX.
const {
  React,
  ReactDOM,
  useShinyInput,
  useShinyOutputValue,
  useShinyOutputStatus,
  useShinyMessageHandler,
  useShinyInitialized,
  useShinyBusy,
  ShinyOutput,
  PROTOCOL_VERSION,
} = window.shinyreact;

const h = React.createElement;
const { useState, useRef, useEffect } = React;

// --- Small utilities --------------------------------------------------------

// Count-up animation for stat values. Runs entirely client-side.
function useAnimatedNumber(target, duration = 550) {
  const [display, setDisplay] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);

  useEffect(() => {
    if (target == null || Number.isNaN(target)) return;
    const from = fromRef.current;
    if (from === target) {
      setDisplay(target);
      return;
    }
    const t0 = performance.now();
    let raf;
    const step = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (target - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(step);
      } else {
        fromRef.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

// Light 1-2-1 smoothing so the density curve reads as a trend, not noise.
function smoothCounts(counts, passes = 2) {
  let c = counts.slice();
  for (let p = 0; p < passes; p++) {
    const next = c.slice();
    for (let i = 0; i < c.length; i++) {
      const a = c[i - 1] ?? c[i];
      const b = c[i];
      const d = c[i + 1] ?? c[i];
      next[i] = (a + 2 * b + d) / 4;
    }
    c = next;
  }
  return c;
}

// Catmull-Rom -> cubic bezier, for the density curve over the bars.
function smoothPath(points) {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

// --- Theme: a client-owned concern, like the rest of the UI ----------------

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("shinyreact-theme") || "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("shinyreact-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  return [theme, setTheme];
}

function ThemeToggle({ theme, setTheme }) {
  const next = theme === "dark" ? "light" : "dark";
  return h(
    "button",
    {
      className: "icon-btn",
      onClick: () => setTheme(next),
      "aria-label": `Switch to ${next} theme`,
      title: `Switch to ${next} theme`,
    },
    theme === "dark"
      ? h(
          "svg",
          { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true" },
          h("circle", {
            cx: 12, cy: 12, r: 4.2,
            fill: "none", stroke: "currentColor", strokeWidth: 1.8,
          }),
          h("path", {
            d: "M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6",
            stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round",
          })
        )
      : h(
          "svg",
          { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true" },
          h("path", {
            d: "M20.5 14.4A8.6 8.6 0 0 1 9.6 3.5a8.6 8.6 0 1 0 10.9 10.9Z",
            fill: "none", stroke: "currentColor", strokeWidth: 1.8,
            strokeLinejoin: "round",
          })
        )
  );
}

// --- Session lifecycle: shiny:connected / shiny:busy -----------------------

function StatusPill() {
  const initialized = useShinyInitialized();
  const busy = useShinyBusy();
  const state = !initialized ? "connecting" : busy ? "busy" : "live";
  return h(
    "span",
    { className: "status-pill status-" + state },
    h("span", { className: "status-dot" }),
    state
  );
}

// --- Inputs: useShinyInput(id, default, options) ---------------------------

function Controls() {
  // Debounced (default 100 ms) text input -> input$name
  const [name, setName] = useShinyInput("name", "world");
  // Range input -> input$bins (debounced a little longer)
  const [bins, setBins] = useShinyInput("bins", 15, { debounceMs: 200 });
  // Segmented control -> input$column
  const [column, setColumn] = useShinyInput("column", "eruptions");
  // Event-priority counters: every click reaches the server, debounce off.
  const [, setSave] = useShinyInput("save", 0, {
    debounceMs: 0,
    priority: "event",
  });
  const [, setSlow] = useShinyInput("slow", 0, {
    debounceMs: 0,
    priority: "event",
  });

  const pct = ((bins - 5) / (50 - 5)) * 100;

  return h(
    "section",
    { className: "card controls", "aria-label": "Controls" },
    h("h2", { className: "card-title" }, "Controls"),

    h(
      "label",
      { className: "field" },
      h("span", { className: "field-label" }, "Your name"),
      h("input", {
        className: "text-input",
        type: "text",
        value: name,
        placeholder: "world",
        onChange: (e) => setName(e.target.value),
      })
    ),

    h(
      "div",
      { className: "field" },
      h("span", { className: "field-label" }, "Column"),
      h(
        "div",
        { className: "segmented", role: "group", "aria-label": "Column" },
        ["eruptions", "waiting"].map((v) =>
          h(
            "button",
            {
              key: v,
              className: "seg" + (column === v ? " is-active" : ""),
              onClick: () => setColumn(v),
              "aria-pressed": column === v,
            },
            v
          )
        )
      )
    ),

    h(
      "label",
      { className: "field" },
      h(
        "span",
        { className: "field-row" },
        h("span", { className: "field-label" }, "Histogram bins"),
        h("span", { className: "field-value" }, bins)
      ),
      h("input", {
        className: "range",
        type: "range",
        min: 5,
        max: 50,
        value: bins,
        style: { "--fill": pct + "%" },
        onChange: (e) => setBins(Number(e.target.value)),
      })
    ),

    h(
      "div",
      { className: "btn-stack" },
      h(
        "button",
        { className: "btn btn-primary", onClick: () => setSave((n) => n + 1) },
        h(
          "svg",
          { viewBox: "0 0 24 24", width: 15, height: 15, "aria-hidden": "true" },
          h("path", {
            d: "M5 12.5 10 17.5 19 7.5",
            fill: "none", stroke: "currentColor", strokeWidth: 2.2,
            strokeLinecap: "round", strokeLinejoin: "round",
          })
        ),
        "Save settings"
      ),
      h(
        "button",
        { className: "btn btn-ghost", onClick: () => setSlow((n) => n + 1) },
        h(
          "svg",
          { viewBox: "0 0 24 24", width: 15, height: 15, "aria-hidden": "true" },
          h("circle", {
            cx: 12, cy: 12, r: 8.2,
            fill: "none", stroke: "currentColor", strokeWidth: 1.9,
          }),
          h("path", {
            d: "M12 7.5V12l3.2 2",
            fill: "none", stroke: "currentColor", strokeWidth: 1.9,
            strokeLinecap: "round",
          })
        ),
        "Simulate slow compute"
      )
    ),

    h(
      "p",
      { className: "hint" },
      "Every control here is a ",
      h("code", null, "useShinyInput()"),
      " hook — the server sees plain ",
      h("code", null, "input$"),
      " values."
    )
  );
}

// --- Outputs: useShinyOutputValue + useShinyOutputStatus -------------------

function StatCard({ label, value, decimals = 0, suffix }) {
  const animated = useAnimatedNumber(value);
  const text = value == null ? "—" : animated.toFixed(decimals) + (suffix || "");
  return h(
    "div",
    { className: "stat" },
    h("span", { className: "stat-value" }, text),
    h("span", { className: "stat-label" }, label)
  );
}

function StatsRow() {
  const data = useShinyOutputValue("hist_data");
  return h(
    "div",
    { className: "stats-row" },
    h(StatCard, { label: "observations", value: data?.n }),
    h(StatCard, { label: "mean", value: data?.mean, decimals: 2 }),
    h(StatCard, { label: "std dev", value: data?.sd, decimals: 2 }),
    h(StatCard, { label: "bins", value: data?.bins })
  );
}

// A hand-rolled SVG histogram: the server ships {breaks, counts} JSON and
// the client owns the rendering -- the core of the ui.tsx pattern.
function Histogram() {
  const data = useShinyOutputValue("hist_data");
  const status = useShinyOutputStatus("hist_data");
  const wrapRef = useRef(null);
  const [tip, setTip] = useState(null);

  const W = 620;
  const H = 300;
  const PAD = { t: 20, r: 14, b: 36, l: 46 };

  let body;
  if (status === "pending" || !data) {
    body = h(
      "div",
      { className: "skeleton", "aria-busy": "true" },
      h("span", null, "waiting for the server…")
    );
  } else {
    const { breaks, counts } = data;
    const lo = breaks[0];
    const hi = breaks[breaks.length - 1];
    const maxCount = Math.max(...counts, 1);
    const x = (v) => PAD.l + ((v - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
    const y = (v) => H - PAD.b - (v / maxCount) * (H - PAD.t - PAD.b);
    const baseline = H - PAD.b;

    const bars = counts.map((c, i) =>
      h("rect", {
        key: i,
        className: "bar",
        x: x(breaks[i]) + 0.75,
        y: y(c),
        width: Math.max(x(breaks[i + 1]) - x(breaks[i]) - 1.5, 1),
        height: baseline - y(c),
        rx: 2.5,
        style: { animationDelay: i * 14 + "ms" },
        onMouseEnter: (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const cRect = wrapRef.current.getBoundingClientRect();
          setTip({
            left: r.left - cRect.left + r.width / 2,
            top: r.top - cRect.top,
            text: `${breaks[i].toFixed(2)} – ${breaks[i + 1].toFixed(2)}`,
            count: c,
          });
        },
        onMouseLeave: () => setTip(null),
      })
    );

    // Client-side density curve over the bin centers.
    const smoothed = smoothCounts(counts);
    const pts = smoothed.map((c, i) => ({
      x: x((breaks[i] + breaks[i + 1]) / 2),
      y: y(c) - 1,
    }));
    const line = smoothPath(pts);
    const area =
      line +
      ` L ${pts[pts.length - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z`;

    const xTicks = [lo, (lo + hi) / 2, hi].map((v, i) =>
      h(
        "text",
        { key: "x" + i, className: "tick", x: x(v), y: H - 12, textAnchor: "middle" },
        v.toFixed(1)
      )
    );
    const yTicks = [0, Math.round(maxCount / 2), maxCount].map((v, i) =>
      h(
        "text",
        { key: "y" + i, className: "tick", x: PAD.l - 10, y: y(v) + 5, textAnchor: "end" },
        String(v)
      )
    );
    const grid = [0, Math.round(maxCount / 2), maxCount].map((v, i) =>
      h("line", {
        key: "g" + i,
        className: "grid-line",
        x1: PAD.l,
        y1: y(v),
        x2: W - PAD.r,
        y2: y(v),
      })
    );

    body = h(
      "div",
      { className: "chart-wrap", ref: wrapRef },
      h(
        "svg",
        {
          viewBox: `0 0 ${W} ${H}`,
          className: "chart",
          role: "img",
          "aria-label": `Histogram of faithful$${data.column}, ${data.bins} bins`,
        },
        h(
          "defs",
          null,
          h(
            "linearGradient",
            { id: "barGrad", x1: 0, y1: 0, x2: 0, y2: 1 },
            h("stop", { offset: "0%", className: "stop-top" }),
            h("stop", { offset: "100%", className: "stop-bottom" })
          ),
          h(
            "linearGradient",
            { id: "areaGrad", x1: 0, y1: 0, x2: 0, y2: 1 },
            h("stop", { offset: "0%", className: "area-top" }),
            h("stop", { offset: "100%", className: "area-bottom" })
          )
        ),
        grid,
        h("g", { key: data.column + "-" + data.bins, className: "bars" }, bars),
        h("path", { className: "density-area", d: area }),
        h("path", { className: "density-line", d: line }),
        h("line", {
          className: "axis",
          x1: PAD.l,
          y1: baseline,
          x2: W - PAD.r,
          y2: baseline,
        }),
        xTicks,
        yTicks
      ),
      tip &&
        h(
          "div",
          {
            className: "tooltip",
            style: { left: tip.left + "px", top: tip.top + "px" },
          },
          h("strong", null, tip.count),
          h("span", null, tip.text)
        )
    );
  }

  const recalculating = status === "recalculating";

  return h(
    "section",
    { className: "card chart-card" + (recalculating ? " is-recalculating" : "") },
    h(
      "div",
      { className: "card-head" },
      h("h2", { className: "card-title" }, "Distribution"),
      h(
        "div",
        { className: "card-meta" },
        h("span", { className: "tag" }, "faithful$" + (data ? data.column : "…")),
        recalculating && h("span", { className: "chip chip-busy" }, "recalculating"),
        status === "error" && h("span", { className: "chip chip-err" }, "error")
      )
    ),
    body,
    h(
      "p",
      { className: "caption" },
      "Bars, density curve and hover tooltip are drawn by React from the ",
      h("code", null, "reactive_output()"),
      " JSON. The server sends numbers, never markup."
    )
  );
}

// Raw JSON inspector: shows exactly what crossed the wire.
function PayloadInspector() {
  const data = useShinyOutputValue("hist_data");
  const [copied, setCopied] = useState(false);
  const text = data ? JSON.stringify(data, null, 2) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return h(
    "details",
    { className: "card payload" },
    h(
      "summary",
      null,
      h("span", null, "Raw JSON payload for ", h("code", null, "output$hist_data")),
      h(
        "button",
        {
          className: "mini-btn",
          onClick: (e) => {
            e.preventDefault();
            copy();
          },
          "aria-label": "Copy payload",
        },
        copied ? "copied" : "copy"
      )
    ),
    h("pre", null, text || "—")
  );
}

// --- Traditional Shiny output bound inside the React tree ------------------

function ScatterCard() {
  return h(
    "section",
    { className: "card" },
    h(
      "div",
      { className: "card-head" },
      h("h2", { className: "card-title" }, "Server-side plot"),
      h("span", { className: "tag" }, "renderPlot")
    ),
    h(
      "div",
      { className: "paper" },
      h(ShinyOutput, { id: "scatter", className: "shiny-plot-output scatter" })
    ),
    h(
      "p",
      { className: "caption" },
      "A base R plot, rendered in R, mounted inside the React tree by ",
      h("code", null, "<ShinyOutput>"),
      " — no ",
      h("code", null, "plotOutput()"),
      " placeholder needed."
    )
  );
}

function WiringCard() {
  const rows = [
    ["reactive_output()", "publishes JSON to the client"],
    ["useShinyInput()", "sends values to the server"],
    ["useShinyOutputStatus()", "pending / recalculating / error"],
    ["send_message()", "one-off pushes, no output id"],
    ["<ShinyOutput>", "mounts traditional renderers"],
  ];
  return h(
    "section",
    { className: "card" },
    h("h2", { className: "card-title" }, "Wired with"),
    h(
      "ul",
      { className: "wiring" },
      rows.map(([fn, note]) =>
        h(
          "li",
          { key: fn },
          h("code", null, fn),
          h("span", null, note)
        )
      )
    )
  );
}

// --- Messages: useShinyMessageHandler receives send_message() pushes -------

function Toasts() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  useShinyMessageHandler("toast", (msg) => {
    const id = nextId.current++;
    setToasts((ts) => [...ts, { id, ...msg }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4000);
  });

  return h(
    "div",
    { className: "toast-stack", role: "status", "aria-live": "polite" },
    toasts.map((t) =>
      h(
        "div",
        { key: t.id, className: "toast toast-" + (t.level || "info") },
        h(
          "svg",
          { viewBox: "0 0 24 24", width: 16, height: 16, "aria-hidden": "true" },
          t.level === "success"
            ? h("path", {
                d: "M5 12.5 10 17.5 19 7.5",
                fill: "none", stroke: "currentColor", strokeWidth: 2.4,
                strokeLinecap: "round", strokeLinejoin: "round",
              })
            : h("circle", {
                cx: 12, cy: 12, r: 8,
                fill: "none", stroke: "currentColor", strokeWidth: 2,
              })
        ),
        h("span", null, t.text),
        h("i", { className: "toast-timer", "aria-hidden": "true" })
      )
    )
  );
}

// --- App shell --------------------------------------------------------------

function Hero() {
  const [theme, setTheme] = useTheme();
  const greeting = useShinyOutputValue("greeting");

  return h(
    "header",
    { className: "hero" },
    h(
      "div",
      { className: "hero-main" },
      h(
        "h1",
        { className: "hero-title" },
        h("span", { className: "grad" }, "shinyreact"),
        h("span", { className: "hero-badge" }, "PoC")
      ),
      h(
        "p",
        { className: "hero-sub" },
        "The server publishes data. React owns the pixels."
      ),
      h("p", { className: "greeting" }, greeting ?? "…")
    ),
    h(
      "div",
      { className: "hero-actions" },
      h(StatusPill),
      h(ThemeToggle, { theme, setTheme })
    )
  );
}

function Footer() {
  return h(
    "footer",
    { className: "footer" },
    h(
      "span",
      null,
      "shinyreact protocol ",
      h("code", null, String(PROTOCOL_VERSION ?? "1.0")),
      " · UI rendered by React, data by R"
    ),
    h("span", { className: "footer-note" }, "shiny + shinyreact + renv")
  );
}

function App() {
  return h(
    "div",
    { className: "page" },
    h(Hero),
    h(
      "main",
      { className: "grid" },
      h("div", { className: "col" }, h(Controls), h(WiringCard)),
      h(
        "div",
        { className: "col" },
        h(StatsRow),
        h(Histogram),
        h(PayloadInspector)
      ),
      h("div", { className: "col" }, h(ScatterCard))
    ),
    h(Footer),
    h(Toasts)
  );
}

// page_react() emits no mount node -- the client owns the DOM.
const root = ReactDOM.createRoot(
  document.body.appendChild(document.createElement("div"))
);
root.render(h(App));

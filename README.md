# Shiny-React-Demo

Proof of concept for [shinyreact](https://posit-dev.github.io/shinyreact/r/) —
the `ui.tsx` pattern where the Shiny server publishes data and a React client
you own renders the UI. No JS build step required: `page_react()` serves
`www/ui.js` + `www/ui.css` and installs React plus the client hooks at
`window.shinyreact`.

## What the PoC demonstrates

| Capability | Where |
|---|---|
| `reactive_output()` publishing JSON | `app.R` → `output$hist_data`, `output$greeting` |
| `useShinyInput()` (debounce, event priority) | `www/ui.js` → `Controls` |
| `useShinyOutputValue()` / `useShinyOutputStatus()` (pending/recalculating/error) | `Histogram`, `StatsRow` |
| `send_message()` → `useShinyMessageHandler()` | "Save" button → toast |
| `useShinyInitialized()` / `useShinyBusy()` | `StatusPill` |
| Traditional renderers via `<ShinyOutput>` | `renderPlot` scatter card |

The client is a real React app, so the presentation is entirely ours:

- hand-drawn SVG histogram with gradient bars, a client-computed density curve,
  hover tooltips, and a staggered grow-in animation on every recalculation
- count-up animation on the stat cards
- light/dark theme toggle (localStorage-backed, client-only state)
- toast notifications with icon and auto-dismiss progress bar
- `prefers-reduced-motion` respected throughout

## Run

```r
renv::restore()   # first time only
shiny::runApp()
```

or from the shell:

```sh
Rscript -e 'shiny::runApp(port = 8400)'
```

## Layout

```
app.R          # server: reactive_output() + send_message() + renderPlot
www/ui.js      # React client (React.createElement, no bundler)
www/ui.css     # page styles + two themes (auto-discovered)
www/favicon.svg
renv.lock      # pinned R dependencies
.devin/skills/shinyreact-gotchas/SKILL.md   # pitfalls found while building this
```

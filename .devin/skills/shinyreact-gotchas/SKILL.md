---
name: shinyreact-gotchas
description: Hard-won gotchas for building Shiny for R apps with the shinyreact package (the ui.tsx pattern) — asset cache busting, custom message handlers, input timing, JSON coercion, output status, ShinyOutput sizing. Use when writing or debugging a shinyreact app (page_react(), reactive_output(), send_message(), useShinyInput, useShinyOutputValue, ShinyOutput).
allowed-tools:
  - read
  - grep
  - glob
  - exec
---

# shinyreact gotchas

Verified against **shinyreact 0.1.0** and **shiny 1.14.0**. Each entry is
symptom → cause → fix, from actually hitting the problem. The worked example
in this repo is `app.R` + `www/ui.js` + `www/ui.css`.

## API in one screen

| Side | Call | Purpose |
|---|---|---|
| R | `page_react(src_dir = "www", js_file = "ui.js", css_file = "ui.css")` | UI: serves assets, installs React + hooks at `window.shinyreact` |
| R | `reactive_output({ ... })` | Publish any JSON-serializable value to `output$id` |
| R | `send_message(session, id, data)` | One-off push to `useShinyMessageHandler(id, ...)` |
| R | any renderer (`renderPlot`, `renderTable`, `plotly::renderPlotly`) | Still works; bind client-side with `<ShinyOutput>` |
| JS | `useShinyInput(id, default, {debounceMs, priority, type})` | `[value, setValue]`, like `useState` |
| JS | `useShinyOutputValue(id)` | Value from `reactive_output()` |
| JS | `useShinyOutputStatus(id)` | `"pending" \| "ready" \| "recalculating" \| "error"` |
| JS | `useShinyMessageHandler(id, fn)` | Receives `send_message()` payloads |
| JS | `useShinyInitialized()`, `useShinyBusy()` | Connection / server-busy booleans |
| JS | `ShinyOutput`, `ImageOutput` | Mount traditional outputs inside the React tree |

`page_react()` emits an **empty `<body>`** — the client must create its own
mount node: `ReactDOM.createRoot(document.body.appendChild(document.createElement("div")))`.

---

## 1. Asset changes don't show up (stale `ui.css`)

**Symptom:** you edit `www/ui.css`, reload, and the browser still renders the old styles.

**Cause:** `page_react()` attaches `ui.js`/`ui.css` as an `htmltools::htmlDependency`
whose **version is `ui.js`'s mtime, resolved once when `ui <- page_react()` is
evaluated at app startup**. Editing only the CSS leaves the versioned URL
unchanged, so the browser serves its cached copy. Touching `ui.js` after startup
doesn't help either — the version was already computed.

**Fix:** restart the app after editing either asset. (`touch www/ui.js` before
restarting if you want the version string to move.) During iteration, keep
devtools open with cache disabled.

## 2. Never call `Shiny.addCustomMessageHandler("shinyReactMessage", ...)` yourself

**Symptom:** `send_message()` toasts/handlers silently stop working — no error
anywhere.

**Cause:** Shiny keeps **one handler per message type**, and shinyreact routes
*every* custom message through the single type `"shinyReactMessage"`, dispatching
by `msg.id` in its own registry. Adding your own handler for that type replaces
shinyreact's dispatcher, so `useShinyMessageHandler` never fires. This is easy to
do accidentally while "just debugging" the wire.

**Fix:** use `useShinyMessageHandler(id, fn)` only. To inspect payloads, log
inside the handler, or wrap it:

```js
useShinyMessageHandler("toast", (msg) => { console.log("toast", msg); showToast(msg); });
```

Server side, `send_message(session, id, data)` sends
`sendCustomMessage("shinyReactMessage", list(id = session$ns(id), data = data))`,
so a raw `addCustomMessageHandler("toast", ...)` will never fire — the type is
not your id. `send_message()` also requires a real session (`session$ns` must
exist) and namespaces `id` inside Shiny modules.

## 3. `input$id` is `NULL` on first flush — and the default arrives on mount

**Symptom A:** outputs error or render empty until the user touches a control.

**Cause:** client-owned inputs don't exist server-side until the client's first
value crosses the websocket.

**Fix:** `req(input$id)` in every output that depends on a client input.

**Symptom B:** an `observeEvent(input$save, ...)` fires once on page load.

**Cause:** `useShinyInput(id, default)` sends its default on mount, so the server
sees `NULL → default`, which counts as a change.

**Fix:** guard the initial value, or start the counter at 0 and skip it:

```r
observeEvent(input$save, {
  if (is.null(input$save) || input$save == 0) return()
  send_message(session, "toast", list(text = "Saved", level = "success"))
})
```

Action buttons are just counters with the debounce off:

```js
const [, setSave] = useShinyInput("save", 0, { debounceMs: 0, priority: "event" });
h("button", { onClick: () => setSave((n) => n + 1) }, "Save");
```

## 4. JSON coercion surprises

**Symptom:** a length-1 R vector arrives as a scalar, or `list()` arrives as `[]`
and you expected `NULL` (or vice versa).

**Cause / rules:** `reactive_output()` serializes with jsonlite. Incoming client
values: arrays of scalars become atomic vectors; `[]` stays `list()`, not `NULL`.

**Fix:** use `I()` on the R side to force a length-1 vector to stay a JSON array:

```r
list(breaks = I(h$breaks), counts = I(h$counts))
```

Pass `{ type: "shinyreact.asis" }` to `useShinyInput()` for untouched parsed
JSON, or a handler name such as `"shiny.datetime"` to route through Shiny's
input handler. A given input id's `type` is finalized on first mount — a later
mount that disagrees throws.

## 5. `useShinyInput` is one-way (no `updateTextInput`)

**Symptom:** you try to reset a client input from the server and nothing happens.

**Cause:** the hook sends values *to* Shiny only; it does not apply
server-side updates back to React state.

**Fix:** drive resets through your own channel — `send_message()` plus a
handler that calls `setValue(...)`, or publish a value with `reactive_output()`
and apply it in a `useEffect`.

## 6. `useShinyBusy()` stays `false` during a long computation

**Symptom:** you `Sys.sleep(1.5)` in an output, and the busy badge never lights.

**Cause:** `useShinyBusy()` tracks Shiny's `shiny:busy`/`shiny:idle` request
cycle, not per-output recalculation.

**Fix:** for "this output is recomputing" UI, use `useShinyOutputStatus(id)`.
Keep the previous value mounted while `"recalculating"` and only show a
placeholder when `"pending"` (no value has ever arrived).

## 7. `<ShinyOutput>` needs the right class, and its first render overflows

**Symptom:** a traditional output renders blank, or flashes oversized before
snapping to the container width.

**Cause:** `ShinyOutput` binds by class or tag name. `renderPlot` needs
`className: "shiny-plot-output"`; plotly needs
`"plotly html-widget html-widget-output"`. No `plotOutput()` placeholder is
required — shinyreact discovers the renderer's JS/CSS deps from the render
function. The image is generated server-side at a default size, then re-rendered
after the client reports the container's dimensions.

**Fix:** give the element a size (CSS or `width`/`height` props) and cap the
image so the pre-resize frame cannot overflow:

```css
.scatter { width: 100%; height: 380px; }
.scatter img { max-width: 100%; height: auto; }
```

`ImageOutput` is only for `renderImage()` and must have explicit dimensions
(props or CSS). Keep base-R plot titles short — long `main =` text clips inside
a narrow plot device rather than wrapping.

## 8. Fixed-size output images blow out `1fr` grid columns

**Symptom:** with `grid-template-columns: 300px 1fr 1fr`, the middle column
collapses to a sliver and the output card overlaps it.

**Cause:** `1fr` is `minmax(auto, 1fr)`, so the column's minimum is its content's
min-content width. A `ShinyOutput` image with an intrinsic pixel width makes that
minimum huge, starving the sibling column.

**Fix:** `grid-template-columns: 300px minmax(0, 1fr) minmax(0, 1fr)` and
`min-width: 0` on grid children.

## 9. `shinyreact_js = "client"` only for bundled apps

Serve `"server"` (the default) for no-build apps — that's what puts
`window.shinyreact` on the page. `"client"` is only for apps whose own bundle
imports `@posit-dev/shinyreact`; otherwise two copies of React and two
registries land on one page.

## 10. A `favicon.ico` 404 in the console is expected

`page_react()` owns no `<head>` markup, so the browser's automatic favicon
request 404s. Fix it by injecting a link through an `htmlDependency` — the
documented hook for extra page-level tags (implemented in this repo):

```r
favicon <- htmltools::htmlDependency(
  name = "favicon", version = "1.0.0", src = "www",
  head = '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
)
ui <- page_react(title = "My app", favicon)
```

`www/favicon.svg` is then served statically at `/favicon.svg`. Verified: with
the link present the console is completely clean.

---

## Verifying behaviour in a real browser

Toast/handler lifetimes are short, so a click followed by a *separate* check can
race. Do click-and-assert in one evaluate:

```js
() => new Promise((res) => {
  const btn = Array.from(document.querySelectorAll(".btn"))
    .find((b) => b.textContent.startsWith("Save"));
  btn.click();
  setTimeout(() => res({
    toasts: Array.from(document.querySelectorAll(".toast")).map((t) => t.textContent),
  }), 900);
})
```

Same pattern works for `useShinyOutputStatus`: click "slow compute", wait ~700 ms,
assert the `recalculating` chip exists.

Quick server-side sanity check without a browser:

```r
shiny::testServer(app = shinyApp(page_react(), server), {
  session$setInputs(bins = 20, column = "eruptions")
  # read what reactive_output published via the output's value
})
```

`shinyreact::wire_tap()` records the wire payloads a shinytest2 browser test
observes, if you want assertions on the exact JSON.

## Checklist before shipping a shinyreact app

- [ ] Every output that reads a client input starts with `req(input$id)`
- [ ] Event inputs use `{ debounceMs: 0, priority: "event" }` and start at 0
- [ ] Initial-value observers guard against the mount default
- [ ] Length-1 arrays use `I()` on the R side
- [ ] Recalculation UI uses `useShinyOutputStatus`, not `useShinyBusy`
- [ ] `ShinyOutput` classes match the renderer (`shiny-plot-output`, `plotly ...`)
- [ ] Grid columns use `minmax(0, 1fr)`; images have `max-width: 100%`
- [ ] No custom `shinyReactMessage` handlers installed
- [ ] App restarted after editing `www/` assets

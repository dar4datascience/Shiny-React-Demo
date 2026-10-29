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

## Deploy to Posit Connect Cloud

Deployment runs on GitHub Actions (`.github/workflows/deploy.yml`), following
[this pattern](https://www.r-bloggers.com/2026/08/using-github-actions-to-deploy-to-posit-connect-cloud/):
`renv.lock` pins the packages, `pak` restores them as Posit Package Manager
binaries, and `rsconnect::deployApp()` pushes the bundle on every push to `main`
(or on manual dispatch).

One-time setup:

1. **Create Connect Cloud credentials** at
   <https://login.posit.cloud/identity/credentials> → *New Credentials* →
   "Use with: **Connect Cloud**". This gives you `clientId`, `clientSecret`, and
   your account name.
2. **Do one manual deploy** (Posit Publisher in Positron/VS Code, or RStudio) so
   the content exists. Then open its **Settings → URL** and copy the UUID from
   the default URL, `https://<uuid>.share.connect.posit.cloud`.
3. **Set secrets and variables** on the GitHub repo
   (Settings → Secrets and variables → Actions):

| Kind | Name | Value |
|---|---|---|
| Secret | `RSCONNECT_CLIENT_ID` | `clientId` from step 1 |
| Secret | `RSCONNECT_CLIENT_SECRET` | `clientSecret` from step 1 |
| Variable | `RSCONNECT_USERNAME` | your Connect Cloud username (`connect.posit.cloud/<username>`) |
| Variable | `APP_NAME` | `shiny-react-demo` |
| Variable | `APP_TITLE` | `shinyreact PoC` |
| Variable | `CONNECT_CONTENT_ID` | UUID from step 2 |

Or with the `gh` CLI (the secrets prompt for the value, so nothing lands in
shell history):

```sh
gh secret set RSCONNECT_CLIENT_ID
gh secret set RSCONNECT_CLIENT_SECRET
gh variable set RSCONNECT_USERNAME --body "<username>"
gh variable set APP_NAME --body "shiny-react-demo"
gh variable set APP_TITLE --body "shinyreact PoC"
gh variable set CONNECT_CONTENT_ID --body "<uuid>"
```

Then push to `main`, or trigger it manually:

```sh
gh workflow run deploy.yml
```

Notes:

- The bundle is narrowed to `app.R`, `www/`, and `renv.lock` via `appFiles`, so
  repo tooling (`.devin/`, `.vscode/`) never ships to the server.
- `rsconnect` is installed by the workflow instead of being pinned in
  `renv.lock`; that keeps `renv::status()` clean for the app itself.
- Connect Cloud also supports **git-backed deployment** (no Actions minutes):
  connect the repo in Connect Cloud, commit a `manifest.json` from
  `rsconnect::writeManifest()`, and it redeploys on push by itself.

## Layout

```
app.R          # server: reactive_output() + send_message() + renderPlot
www/ui.js      # React client (React.createElement, no bundler)
www/ui.css     # page styles + two themes (auto-discovered)
www/favicon.svg
renv.lock      # pinned R dependencies
.github/workflows/deploy.yml                # GitHub Actions → Connect Cloud
.devin/skills/shinyreact-gotchas/SKILL.md   # pitfalls found while building this
```

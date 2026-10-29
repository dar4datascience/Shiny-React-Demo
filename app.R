library(shiny)
library(shinyreact)

# shinyreact PoC -- the "ui.tsx" pattern.
#
# The server never renders HTML: it publishes JSON-serializable values with
# reactive_output() and pushes one-off messages with send_message(). All UI
# lives in www/ui.js, a React client served by page_react() together with
# www/ui.css. No JS build step is required -- the shinyreact package bundles
# React and the client hooks at `window.shinyreact`.

# page_react() owns no <head> markup, so a favicon is injected through an
# htmlDependency -- the documented hook for extra page-level tags.
favicon <- htmltools::htmlDependency(
  name = "favicon",
  version = "1.0.0",
  src = "www",
  head = '<link rel="icon" type="image/svg+xml" href="favicon.svg">'
)

ui <- page_react(title = "shinyreact PoC", favicon)

server <- function(input, output, session) {
  # --- reactive_output(): publish structured JSON to the client ------------

  output$greeting <- reactive_output({
    name <- input$name
    if (is.null(name) || !nzchar(name)) {
      name <- "world"
    }
    paste0("Hello, ", name, "!")
  })

  # Histogram + summary stats for whichever faithful column is selected.
  # Inputs owned by React are NULL until the client's first value arrives,
  # so guard with req().
  output$hist_data <- reactive_output({
    req(input$column, input$bins)

    # input$slow is an event-priority counter bumped by a client button.
    # Sleeping here makes the client's useShinyOutputStatus("hist_data")
    # visibly flip to "recalculating".
    if (isTRUE(input$slow > 0)) {
      Sys.sleep(1.5)
    }

    x <- faithful[[input$column]]
    hst <- hist(x, breaks = input$bins, plot = FALSE)
    list(
      breaks = I(hst$breaks), # I() keeps length-1 vectors as JSON arrays
      counts = I(hst$counts),
      n = length(x),
      mean = mean(x),
      sd = sd(x),
      column = input$column,
      bins = input$bins
    )
  })

  # --- send_message(): one-off pushes outside the reactive graph -----------

  observeEvent(input$save, {
    if (is.null(input$save) || input$save == 0) {
      return()
    }
    send_message(session, "toast", list(
      text = sprintf("Saved: column=%s, bins=%s", input$column, input$bins),
      level = "success"
    ))
  })

  # --- Traditional renderers still work ------------------------------------
  # renderPlot ships an image; the client mounts it with <ShinyOutput>, no
  # plotOutput() placeholder needed. shinyreact auto-delivers the renderer's
  # JS/CSS dependencies to the client.

  output$scatter <- renderPlot({
    req(input$column)
    other <- setdiff(names(faithful), input$column)
    plot(
      faithful[[input$column]], faithful[[other]],
      pch = 19, col = "#4c8bf5", cex = 0.8,
      xlab = input$column, ylab = other,
      main = "Server-side renderPlot"
    )
    abline(lm(faithful[[other]] ~ faithful[[input$column]]),
      col = "#e4572e", lwd = 2
    )
  })
}

# Bookmarking also works: enableBookmarking = "url" would restore
# useShinyInput() initial values from the URL.
shinyApp(ui, server)

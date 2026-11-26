# imagework

A self-contained composition package: turn `fragment*.png` components plus
custom fonts/text into a finished graphic artifact — **png or pdf** — using
Pandoc templating, with an agent-assisted interactive mode.

The whole environment (pandoc, node, chromium, opencode, all fonts config)
is built **with nix inside a docker container**, so the only thing a user
needs is docker. No unix knowledge required.

## Layout

```
imagework/
  Makefile                  # entry point for everything
  Dockerfile                # docker build, environment from nix (flake.nix)
  flake.nix                 # the nix "buildfile": packages for the container
  run.sh                    # no-unix-knowledge helper (build / repl / serve / png / pdf)
  scripts/
    compose.mjs             # single-shot artifact rebuild (layout -> html -> png/pdf)
    serve.mjs               # node livereload webserver (http://localhost:8899)
  project/                  # CODE + composition machinery
    templates/
      compose.html.tmpl     # pandoc template (agent-maintained, png AND pdf)
    layout.json             # THE composition: canvas + fragment/text placement
    layout.example.json     # copy this to layout.json to start
    output/                 # rendered artifacts land here
  resources/                # DATA — your media, kept separate from code
    fragments/              # your fragment*.png components go here
    fonts/                  # custom .ttf/.otf fonts go here
  .opencode/skill/
    imagework-compose/      # skill loaded in interactive sessions (mounted in)
```

## Quick start (no unix knowledge needed)

1. Install [Docker](https://docs.docker.com/get-docker/).
2. Open a terminal in this folder and run:
   - **Linux/macOS:** `./run.sh build` then `./run.sh repl`
   - **Windows:** `docker build -t imagework .` then `make repl` equivalents in `run.bat`

## Everyday commands

| command                    | what it does                                        |
|----------------------------|-----------------------------------------------------|
| `make png`                 | single-shot rebuild → `project/output/output.png`   |
| `make png FILE=mygraphic`  | single-shot rebuild → `project/output/mygraphic.png`|
| `make pdf`                 | single-shot rebuild → `project/output/output.pdf`   |
| `make pdf FILE=report`     | single-shot rebuild → `project/output/report.pdf`   |
| `make repl`                | interactive opencode session (skill mounted)        |
| `make serve`               | livereload preview server on port 8899              |
| `make check-layout`        | lint text layout for overlaps/overflow              |
| `make arrange`             | algorithmically re-stack text, no overlaps          |
| `make dist`                | zip the folder for distribution                     |

`FILE` is the artifact *stem*; the target (`png`/`pdf`) decides the
extension. Default is `output.png` / `output.pdf`.

## How composition works

- `project/layout.json` is the single source of truth. It names the canvas
  (size, background), the `fragment*.png` files with their `x`/`y`/`w`
  placement, any custom `text` elements, and custom `fonts`.
- `scripts/compose.mjs` generates the HTML, applies the pandoc template,
  and renders with headless chromium — once per target, both png and pdf
  supported from the same layout.
- **Linting:** the compose script fails (exit 2) if any `fragment*.png` on
  disk lacks a placement, or any placement references a missing file.
- In interactive sessions (`make repl`), the opencode agent follows the
  mounted `imagework-compose` skill: it scans fragments, performs the lint
  pass *with you*, proposes placements, maintains the template, and
  rebuilds both targets.

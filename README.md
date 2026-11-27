# cinnamon-print

A self-contained composition package: turn `fragment*.png` components plus
custom fonts/text into a finished graphic artifact — png or pdf — using
Pandoc templating, with an agent-assisted interactive mode.

The whole environment (pandoc, node, chromium, opencode, all fonts config)
is built with nix inside a docker container, so the only thing a user
needs is docker. No unix knowledge required.

## Layout

```text
cinnamon-print/
  Makefile                  # entry point for everything
  Dockerfile                # docker build, environment from nix (flake.nix)
  flake.nix                 # the nix "buildfile": packages for the container
  run.sh                    # no-unix-knowledge helper (build / repl / serve / png / pdf)
  scripts/
    compose.mjs             # single-shot artifact rebuild (layout -> html -> png/pdf)
    serve.mjs               # node livereload webserver (http://localhost:8899)
    frag-scan.js            # [WIP] client-side WebGL renderer for live .frag shaders
  project/                  # CODE + composition machinery
    templates/
      compose.html.tmpl     # pandoc template (agent-maintained, png AND pdf)
    layout.json             # THE composition: canvas + fragment/text placement
    layout.example.json     # copy this to layout.json to start
    output/                 # rendered artifacts land here
  resources/                # DATA — your media, kept separate from code
    fragments/              # your fragment*.png components go here
    shaders/                # [WIP] agent-authored .frag shaders watched by Frag Bench
                            #   — read SHADER-NOTES.md before editing (Y-axis gotchas)
    fonts/                  # custom .ttf/.otf fonts go here
  .opencode/skill/
    imagework-compose/      # skill loaded in interactive sessions (mounted in)
```

## Quick start (no unix knowledge needed)

> **Support status:** current support assumes some basic understanding of
> terminals and agentic coding. the Linux REPL (`make repl` / `./run.sh repl`)
> is **experimental**; Windows support is a **work in progress** (the
> `run.bat` path is not yet complete).

1. Install Docker https://docs.docker.com/get-docker/.
2. Open a terminal in this folder and run:
   * Linux/macOS: `./run.sh build` then `./run.sh repl`
   * Windows: work in progress — `run.bat` is not complete yet; the docker commands (`docker build -t cinnamon-print .`) work from PowerShell in principle

## Everyday commands

| command | what it does |
| :--- | :--- |
| `make png` | single-shot rebuild → `project/output/output.png` |
| `make png FILE=mygraphic` | single-shot rebuild → `project/output/mygraphic.png` |
| `make pdf` | single-shot rebuild → `project/output/output.pdf` |
| `make pdf FILE=report` | single-shot rebuild → `project/output/report.pdf` |
| `make repl` | interactive opencode session (skill mounted) |
| `make serve` | livereload preview server + Frag Bench on port 8899 |
| `make check-layout` | lint text layout for overlaps/overflow |
| `make arrange` | algorithmically re-stack text, no overlaps |
| `make dist` | zip the folder for distribution |

`FILE` is the artifact stem; the target (`png` / `pdf`) decides the
extension. Default is `output.png` / `output.pdf`.

## How composition works

* `project/layout.json` is the single source of truth. It names the canvas
  (size, background), the `fragment*.png` files with their `x / y / w`
  placement, any custom `text` elements, and custom `fonts`.
* `scripts/compose.mjs` generates the HTML, applies the pandoc template,
  and renders with headless chromium — once per target, both png and pdf
  supported from the same layout.
* Linting: the compose script fails (exit 2) if any `fragment*.png` on
  disk lacks a placement, or any placement references a missing file.
* In interactive sessions (`make repl`), the opencode agent follows the
  mounted `imagework-compose` skill: it scans fragments, performs the lint
  pass with you, proposes placements, maintains the template, and
  rebuilds both targets.

## Work in Progress: Frag Bench (Live Shader Synthesis)

To generate custom abstract textures and raster elements without adding heavy
GPU dependencies to the Docker container, `cinnamon-print` leverages your active
browser session (`make serve`) as a client-side WebGL worker:

1. **Agent Shader Authoring:** During a `make repl` session, ask the opencode
   agent to write or iterate on GLSL fragment shaders inside `resources/shaders/`.
2. **Live Indexing & GPU Preview:** Alongside the main artifact preview on
   `http://localhost:8899`, the **Frag Bench** tab (`scripts/frag-scan.js`)
   automatically detects new/updated `.frag` files and compiles them in-browser
   into native, high-resolution `<img>` swatches.
3. **Drag-to-Compose Flow:** Curate the live shader renders directly in the
   browser and drag-and-drop your favorite outputs straight into
   `resources/fragments/` as `fragment*.png` assets. Once dropped, the
   standard lint-and-compose pipeline picks them up for placement in `layout.json`.


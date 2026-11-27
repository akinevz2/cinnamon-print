<p align="center">
  <img src="./cinnamon-print_banner.png" alt="cinnamon-print" width="100%">
</p>

# cinnamon-print

**describe it, an agent places it, your browser renders it.**

a docker-in-a-folder composition package: give it fragment images, text, fonts and procedural shaders, get a finished png or pdf. built for flyers, cover art, zines and social cards.

[project page](https://akinevz.com/projects/cinnamon-print)

## what it makes

<!-- TODO: an excerpt of project/layout.json beside the png it produced.
     one real example is worth the rest of this page. -->

## try it

```sh
git clone https://github.com/akinevz2/cinnamon-print
cd cinnamon-print
./run.sh build
make png                 # -> project/output/output.png
make pdf                 # -> project/output/output.pdf
./run.sh repl            # agent-assisted session (experimental)
```

the only prerequisite is [docker](https://docs.docker.com/get-docker/). everything else
(pandoc, node, chromium, fonts, opencode) is built with nix inside the container.

## how it works

1. **describe it.** `project/layout.json` is the single source of truth: canvas, `fragment*.png` placements, text, fonts.
2. **an agent places it.** in `make repl`, the opencode agent scans your fragments, lints the layout for overlaps and overflow, and proposes placements with you.
3. **it renders.** a compose script generates html, applies a pandoc template, and renders png and pdf through headless chromium from the same layout.
4. **reproducibly.** same folder, same docker, same result.

## status

| works today | still being sanded |
| :--- | :--- |
| single-shot png and pdf (`make png` / `make pdf`) | linux agent REPL (experimental) |
| layout lint (`make check-layout`) and auto-stacking (`make arrange`) | frag bench: live shader synthesis |
| livereload preview on `localhost:8899` (`make serve`) | linux agent REPL (experimental) |

**windows**: run `requirements.bat` once (installs GNU Make + Docker Desktop via
winget), then `run.bat` — it starts the docker engine if needed, builds the image
on first run, launches the repl session, and tears the container down on exit.

## frag bench: shaders without a gpu in the container

your browser doubles as a WebGL worker. the agent writes GLSL into `resources/shaders/`,
the frag bench tab compiles each `.frag` live into a high-resolution swatch, and you drag the
keepers into `resources/fragments/` as `fragment*.png`. from there the normal lint-and-compose
pipeline takes over. conventions live in `resources/shaders/SHADER-NOTES.md`.

<details>
<summary>project layout</summary>

```text
cinnamon-print/
  Makefile                  # entry point for everything (bare `make` = interactive session)
  Dockerfile                # docker build, environment from nix (flake.nix)
  flake.nix                 # the nix "buildfile": packages for the container
  run.sh                    # no-unix-knowledge helper (build / repl / serve / png / pdf)
  scripts/
    compose.mjs             # single-shot artifact rebuild (layout -> html -> png/pdf)
    serve.mjs               # livereload webserver + frag bench APIs (localhost:8899)
    layout.mjs              # text-geometry lint + auto-arrange
    cloud-step.sh           # one monte-carlo cloud-fill step (bernoulli banner fill)
    meta.mjs                # per-output title/prompt metadata sidecars
    frag-scan.js            # client-side WebGL renderer for live .frag shaders
  project/                  # CODE + composition machinery
    templates/
      compose.html.tmpl     # pandoc template (agent-maintained, png AND pdf)
    layout.json             # THE composition: canvas + fragment/text placement
    layout.example.json     # copy this to layout.json to start
    cloud.html              # /cloud — live build preview + project sidebar
    frag.html               # /frag — standalone frag bench page
    output/                 # rendered artifacts land here
  resources/                # DATA — your media, kept separate from code
    fragments/              # your fragment*.png components go here
    shaders/                # agent-authored .frag shaders, watched live by the bench
    fonts/                  # custom .ttf/.otf fonts go here
  .opencode/skill/
    cinnamon-print/         # skill loaded in interactive sessions (mounted in)
```

</details>

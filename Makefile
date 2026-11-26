# imagework — artifact composition
#
# Usage:
#   make png                 # single-shot rebuild -> project/output/output.png
#   make pdf                 # single-shot rebuild -> project/output/output.pdf
#   make png FILE=my         # rebuild -> project/output/my.png (extension follows target)
#   make pdf  FILE=my        # rebuild -> project/output/my.pdf
#   make repl                # interactive opencode session (skill mounted)
#   make serve               # node livereload server on http://localhost:8899
#   make check-layout        # report text overlaps / canvas overflow
#   make arrange             # algorithmically re-stack text, no overlaps
#   make dist                # zip the whole folder for distribution

SHELL := /bin/bash

# FILE is the artifact *stem*; the target decides the extension.
# Defaults: `make png` -> output.png, `make pdf` -> output.pdf.
FILE ?= output

# How docker is invoked (override, e.g. DOCKER="podman", for non-docker unix users).
DOCKER ?= docker
IMAGE  ?= imagework

# Mount the whole folder so the skill, templates and fragments are all visible.
VOL := -v "$(CURDIR)":/work -w /work
# Port forwarded to the host for the livereload preview server.
PORT_FWD := -p 8899:8899

# --init: run tini as PID 1 so SIGINT/SIGTERM/SIGTSTP are actually forwarded.
# Without it, `bash -c <single cmd>` execs the command, making e.g. node PID 1,
# and the kernel silently drops default-terminate signals sent to PID 1 —
# ctrl-c / ctrl-z appear dead.
define DOCKER_RUN
$(DOCKER) run --rm -it --init $(VOL) $(IMAGE) bash -c $(1)
endef

.PHONY: png pdf repl serve shell check-layout arrange dist build build-image clean

# Stamp so docker build only reruns when the Dockerfile/flake/scripts change.
# A missing image (e.g. after `docker rmi`) also forces a rebuild.
IMAGE_STAMP := .image-built
STAMP_INPUTS := Dockerfile flake.nix scripts project resources .opencode

$(IMAGE_STAMP): $(STAMP_INPUTS)
	$(DOCKER) build -t $(IMAGE) .
	touch $@

## ---- single-shot artifact rebuild -------------------------------------

png: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"./scripts/compose.mjs png $(FILE)")

pdf: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"./scripts/compose.mjs pdf $(FILE)")

## ---- interactive development ------------------------------------------

# "REPL" work: an opencode session with the imagework-compose skill loaded,
# fully inside the nix container.
repl: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"opencode")

# Livereload webserver for browser preview during composition.
serve: $(IMAGE_STAMP)
	$(DOCKER) run --rm -it --init $(VOL) $(PORT_FWD) $(IMAGE) bash -c "node ./scripts/serve.mjs"

shell: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"exec /root/.nix-profile/bin/bash")

## ---- text geometry -------------------------------------------------------

check-layout: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"node ./scripts/layout.mjs check")

arrange: $(IMAGE_STAMP)
	$(call DOCKER_RUN,"node ./scripts/layout.mjs arrange")

## ---- build / distribution ---------------------------------------------

build-image:
	$(DOCKER) build -t $(IMAGE) .
	touch $(IMAGE_STAMP)

# Zip the whole folder (minus outputs) so non-unix users can distribute it.
dist:
	rm -f imagework.zip
	zip -r imagework.zip . -x '*.zip' -x 'project/output/*' -x 'node_modules/*' -x '.git/*' -x 'result*' -x '.image-built'
	@echo "wrote imagework.zip"

clean:
	rm -f project/output/*.png project/output/*.pdf project/compose.html

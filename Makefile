# imagework — artifact composition
#
# Usage:
#   make png                 # single-shot rebuild -> project/output/output.png
#   make pdf                 # single-shot rebuild -> project/output/output.pdf
#   make png FILE=my         # rebuild -> project/output/my.png (extension follows target)
#   make pdf  FILE=my        # rebuild -> project/output/my.pdf
#   make repl                # interactive opencode session (skill mounted)
#   make serve               # node livereload server on http://localhost:8899
#   make serve               #   .../cloud  = live cloud-fill preview + progress
#   make check-layout        # report text overlaps / canvas overflow
#   make arrange             # algorithmically re-stack text, no overlaps
#   make dist                # zip the whole folder for distribution
#   make cloud               # bernoulli/monte-carlo fill: project/output/banner.png
#   make cloud COUNT=8 STEM=cloud-test   # quick 8-instance test render

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
# fully inside the nix container. Port 8899 is forwarded so a build started
# from INSIDE the session can be previewed live in a host browser at
# http://localhost:8899/cloud (same as builds started on the host).
repl: $(IMAGE_STAMP)
	$(DOCKER) run --rm -it --init $(VOL) $(PORT_FWD) $(IMAGE) bash -c "opencode"

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

## ---- bernoulli / monte-carlo background fill ------------------------------
# Plasters resources/hec.56.png across a canvas: COUNT random instances are
# stamped at random positions with random per-instance rotations, and after
# EVERY stamp the whole canvas is transformed (1 rotation or 2 shears, chosen
# at random) — so the cloud accumulates iteratively, "unintuitively".
#
# Each step emits a byproduct png (project/output/$(STEM)_NNN.png) and a
# [NNN/COUNT] pct% [####....] progress line. The final target crops the
# center $(BANNER_W)x$(BANNER_H) out of the $(CANVAS)x$(CANVAS) working
# canvas (padding absorbs the shear/rotation bleed at the edges).
#
# NOTE: run serially (no `make -j`) — the steps form a strict chain.
# While building, open http://localhost:8899/cloud for a live preview with
# per-step progress (works for host-side and in-container builds alike).
# Parameters (override on the command line):
#   COUNT      number of random instances stamped   (default 256)
#   CANVAS     working canvas side, square          (default 3000)
#   BANNER_W/H final crop size                      (default 2560x1440)
#   FILL_SRC   the tile png to plaster              (resources/hec.56.png)
#   STEM       output stem -> project/output/<STEM>.png (default banner)

COUNT    ?= 256
CANVAS   ?= 3000
BANNER_W ?= 2560
BANNER_H ?= 1440
FILL_SRC ?= resources/hec.56.png
STEM     ?= banner
OUTDIR   := project/output
STEP     := $(OUTDIR)/$(STEM)
# The chain root (step 001) has no predecessor; zero-pad to match step names.
PCOUNT   := $(shell printf %03d $(COUNT))

# Each step gets an EXPLICIT rule (generated below) chaining on the previous
# step's png; the step logic lives in scripts/cloud-step.sh.
define CLOUD_STEP
$(OUTDIR)/$(STEM)_$(1).png: $(FILL_SRC) $(if $(filter-out 001,$(1)),$(OUTDIR)/$(STEM)_$(2).png)
	@bash scripts/cloud-step.sh $(1) $(CANVAS) $(COUNT) $(OUTDIR) $(STEM) $(FILL_SRC)
endef
# Instantiate one rule per step (001..COUNT); each links to its predecessor.
$(foreach i,$(shell seq 1 $(COUNT)),\
	$(eval $(call CLOUD_STEP,$(shell printf %03d $(i)),$(shell printf %03d $$(($(i)-1))))))

# Final banner: center-crop the working canvas down to the target size.
$(STEP).png: $(STEP)_$(PCOUNT).png
	magick $< -gravity center -crop $(BANNER_W)x$(BANNER_H)+0+0 +repage $@
	@echo "banner written: $@"

.PHONY: cloud cloud-clean
cloud: $(STEP).png

cloud-clean:
	rm -f $(STEP)_*.png $(STEP).png project/output/cloud-progress.log


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

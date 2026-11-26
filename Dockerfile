# imagework container — nix-built environment inside docker.
#
# The nixos/nix base image declares /nix as a docker VOLUME, which masks
# anything installed during a build stage at run time. So we build the
# environment in a build stage and copy the resulting /nix tree (store +
# profile) into a plain base image. Nix itself is not needed at run time —
# only the store closure it produced.

FROM nixos/nix:2.24.10 AS nixbuild

ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

# Copy only what nix needs first, so the nix store layers cache well.
COPY flake.nix flake.lock* ./

# Build the package environment and register it as a profile under /nix.
# A failing nix build must fail the docker build — no error masking.
RUN nix build .#env -o env-result && \
    nix profile install ./env-result --profile /nix/var/nix/profiles/imagework

# Copy only what nix needs first, so the nix store layers cache well.
FROM debian:bookworm-slim

COPY --from=nixbuild /nix /nix

# fontconfig's /etc/fonts isn't merged by buildEnv — copy it in place so
# chromium/cairo can load the default config (resolves fonts in /nix/store).
RUN mkdir -p /etc/fonts && \
    src=""; \
    for d in /nix/store/*fontconfig-*/; do \
      if [ -d "$d/etc/fonts" ] && [ -f "$d/etc/fonts/fonts.conf" ]; then src="$d/etc/fonts"; break; fi; \
    done; \
    cp -rL "$src/." /etc/fonts/

ENV PATH=/nix/var/nix/profiles/imagework/bin:/usr/local/bin:/usr/bin:/bin
ENV HOME=/work
# buildEnv merges fontconfig config into the profile; point at it.
ENV FONTCONFIG_PATH=/nix/var/nix/profiles/imagework/etc/fonts

# Project workspace (fragments, templates, skill) is mounted at /work at
# run time — but bake the defaults in so the image works standalone too.
COPY project /work
COPY resources /work/resources
COPY .opencode /work/.opencode
COPY scripts /work/scripts

WORKDIR /work

# Default to an interactive shell; `make repl` and `make serve` pass their
# own commands via docker run.
CMD ["bash"]

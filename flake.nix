{
  description = "imagework: pandoc + node livereload + opencode composition environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        # Everything the composition workflow needs.
        imageworkEnv = pkgs.buildEnv {
          name = "imagework-env";
          paths = with pkgs; [
            pandoc                 # templating / HTML generation
            nodejs                 # livereload server + compose script
            chromium               # headless render: png screenshot + pdf print
            opencode               # interactive agent sessions
            coreutils
            gnugrep
            findutils
            jq
            which
            fontconfig             # /etc/fonts for chromium rendering
            dejavu_fonts           # baseline font set for text elements
          ];
        };
      in
      {
        packages.default = imageworkEnv;
        packages.env = imageworkEnv;

        devShells.default = pkgs.mkShell {
          packages = [ imageworkEnv ];
        };
      });
}

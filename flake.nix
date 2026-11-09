{
  description = "Transposeur — formant-preserving pitch shifting for browsers (Chrome + Firefox)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: {
        # Everything needed to build, pack and test the extension.
        default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24 # extension packaging + playwright-core test harness
            web-ext # Firefox manifest lint + xpi packaging
            jq
            zip
            resvg # rasterises the toolbar icon (npm run icons)

            gcc # native DSP test harness
            gnumake

            chromium # headless browser for the Chrome integration tests
            firefox # ... and the Firefox ones, driven over WebDriver
            geckodriver # the only way to install an unsigned MV3 add-on
          ];

          # playwright-core drives this binary directly, so no browser download
          # (Playwright's own downloads are not patchelf'd for NixOS anyway).
          env = {
            CHROMIUM_BIN = "${pkgs.chromium}/bin/chromium";
            FIREFOX_BIN = "${pkgs.firefox}/bin/firefox";
            GECKODRIVER_BIN = "${pkgs.geckodriver}/bin/geckodriver";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };

          # to stderr, so piping a command's stdout through the shell stays clean
          shellHook = ''
            >&2 cat <<'BANNER'
            Transposeur dev shell
              npm test                everything below
              npm run test:dsp        pitch ratio / formant / tempo checks
              npm run test:extension  packed extension in Chromium
              npm run test:firefox    packed extension in Firefox
              npm run lint:firefox    web-ext lint of the Firefox build
              npm run build           pack extension/ for Chrome and Firefox
              npm run icons           redraw the toolbar icon from assets/icon.svg
            BANNER
          '';
        };

        # Only needed to rebuild the WASM module from the C++ sources; the
        # vendored Signalsmith Stretch web build is already compiled.
        wasm = pkgs.mkShell {
          packages = with pkgs; [ emscripten cmake python3 nodejs_24 ];
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixpkgs-fmt);
    };
}

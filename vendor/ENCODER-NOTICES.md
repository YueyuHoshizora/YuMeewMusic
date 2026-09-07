# Local audio encoder notices

The MP3 and FLAC extension bundles are from Mediabunny 1.55.7 (MPL-2.0).
Only the import specifier `mediabunny` is modified to `./mediabunny.min.mjs` for direct browser use.

- Extension source and build instructions: https://github.com/Vanilagy/mediabunny/tree/v1.55.7/packages
- MP3 encoding uses LAME 3.100 (LGPL): https://lame.sourceforge.io/
- LAME source: https://sourceforge.net/projects/lame/files/lame/3.100/
- FLAC encoding uses libFLAC: https://github.com/xiph/flac

The included encoder README files describe rebuilding the WASM and worker bundles, and link to their respective source projects. Users may replace the local vendor modules with compatible builds; they are loaded dynamically as separate modules.

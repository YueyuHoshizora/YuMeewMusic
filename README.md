# YuMeew Music Studio

Traditional Chinese music visualizer. Audio and background images are processed locally in the browser. Six canvas spectrum styles share a PCM-based FFT renderer between preview and export. MP4 export uses Mediabunny and WebCodecs H.264/AAC, with exact 1280×720 or 1920×1080 frames at 30 or 60 fps.

## Development

- `npm install`
- `npm run dev`
- `npm run build`
- `npx tsc --noEmit`

Use a browser that supports WebCodecs H.264 and AAC encoding. Codec support is checked before export; unsupported browsers receive an actionable message. Locally selected audio is limited to 150 MB / 20 minutes and images to 30 MB. Encoding buffers the output in memory, so long 1080p videos can require substantial memory. Keep the page open while exporting. This app does not upload media to a server.

## Validation

Production build, TypeScript check, route HTTP 200, FFT silence/sine/bounds checks and frame-duration checks passed. Browser interaction and a full exported MP4 have not been end-to-end tested. The optional `configure_visualizer` WebMCP interface is feature-detected; no supported WebMCP validation context was available.

## Client-only file processing requirement

Original media, decoded audio, spectrum data, image pixels and generated MP4 files must remain on the client. Do not introduce upload endpoints, cloud transcoding, media storage, or telemetry containing file names or contents. The server only serves the application; unsupported local codecs must produce an error rather than fall back to uploading files.

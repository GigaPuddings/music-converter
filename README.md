# Music Converter

Electron + React local audio format converter for Windows, bundled with FFmpeg.

## Features

- Batch convert local audio files.
- Drag and drop single files, multiple files, or folders.
- Recursively import folders and scan supported audio files.
- Input: FLAC, WAV, M4A, AAC, OGG, OPUS, WMA, APE, AIFF, MP3, WEBM.
- Local preprocess/decode for supported encrypted containers: NCM, KGG, KGM, KGMA, VPR.
- Output: MP3, FLAC, WAV, M4A, OGG.
- MP3/M4A/OGG bitrate presets: 128, 192, 256, 320 kbps.
- Default output is Desktop, with custom output directory support.
- Supports auto-convert after import, manual start, and cancelling the current task.

## Scope

This tool is intended for local files you have the right to process. Some proprietary encrypted formats are unsupported and will be skipped, including KWM and unsupported QMC/MFLAC variants.

NCM and supported Kugou formats are decoded locally before being passed to FFmpeg for conversion.

## Preprocessor Plugins

Encrypted-format preprocessing is registered in `electron/preprocessors/index.js`.

Current preprocessors:

- NCM: `.ncm`
- Kugou: `.kgg`, `.kgm`, `.kgma`, `.vpr`

To add another encrypted container, implement a decoder that writes a normal audio file into the provided temporary output directory, then register it with its extensions in the preprocessor registry.

## Development

```bash
pnpm install
pnpm rebuild ffmpeg-static
pnpm build
pnpm electron
```

Development mode uses two terminals:

```bash
pnpm start
pnpm electron:dev
```

If your local environment cannot run the `ffmpeg-static` install script, install system FFmpeg and set `FFMPEG_PATH` to `ffmpeg.exe`.

## Windows Packaging

Before first packaging, install dependencies and ensure `ffmpeg-static` has downloaded `ffmpeg.exe`:

```bash
pnpm install
pnpm rebuild ffmpeg-static
```

Build both installer and portable packages:

```bash
pnpm dist
```

Build only the NSIS installer:

```bash
pnpm dist:installer
```

Build only the portable exe:

```bash
pnpm dist:portable
```

Build an unpacked directory for local smoke testing:

```bash
pnpm dist:dir
```

Artifacts are written to `dist/`.

The packaging config copies `node_modules/ffmpeg-static/ffmpeg.exe` into Electron resources at `resources/ffmpeg/ffmpeg.exe`. Runtime prefers that bundled binary, while development still uses `ffmpeg-static` or `FFMPEG_PATH`.

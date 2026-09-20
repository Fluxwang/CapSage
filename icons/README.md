# EchoSage icon

Generated with the built-in image generation tool. `echosage-source.png` is the original output; `icon-{16,32,48,128}.png` are Lanczos-resized PNGs used by the extension manifest and UI.

## Generation prompt

Use case: logo-brand. Create one final production app icon for EchoSage, a Chrome extension for realtime audio transcription, translation and dual-track subtitles. Square 1024x1024 raster icon. Existing product accent is teal (approximately #008f91). Design a crisp minimal flat vector-like teal rounded-square tile with a bold white speech bubble containing two thick teal horizontal subtitle strokes of different lengths. The bubble and two lines should form a distinctive balanced unified mark, with very generous strokes readable at 16px. Tile fills nearly entire canvas with only 3% outer transparent margin. True transparent background outside rounded tile. Centered front-facing geometry, beautifully balanced optical spacing. No letters, no words, no extra symbols, no shadows, no mockup, no texture, no watermark, no surrounding presentation. Output only the single icon.

## Export

Run from the repository root with FFmpeg installed:

```sh
for size in 16 32 48 128; do
  ffmpeg -y -v error -i icons/echosage-source.png -vf "scale=$size:$size:flags=lanczos" -frames:v 1 "icons/icon-$size.png"
done
```

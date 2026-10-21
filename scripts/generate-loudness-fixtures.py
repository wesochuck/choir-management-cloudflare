"""Generate synthetic MP3s and independent FFmpeg measurements; run from the repo root."""
import json
from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit("Usage: python3 scripts/generate-loudness-fixtures.py /absolute/path/to/ffmpeg")
ffmpeg = sys.argv[1]
output = Path("apps/web/src/account/loudness/fixtures")
output.mkdir(parents=True, exist_ok=True)
fixtures = []


def generate(name, rate, channels, source, encoding, extra=(), silence=False):
    path = output / name
    subprocess.run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        f"aevalsrc={source}:s={rate}:d=2.437", "-ac", str(channels), "-c:a", "libmp3lame",
        *encoding, *extra, "-metadata", "title=Choir synthetic parity fixture", "-y", str(path)
    ], check=True)
    reference = subprocess.run([
        ffmpeg, "-hide_banner", "-i", str(path), "-af",
        "loudnorm=I=-18:TP=-1:print_format=json", "-f", "null", "-"
    ], capture_output=True, text=True, check=True)
    measured = json.JSONDecoder().raw_decode(reference.stderr[reference.stderr.rfind("{"):])[0]
    pcm = subprocess.run([
        ffmpeg, "-v", "error", "-i", str(path), "-f", "f32le", "-"
    ], capture_output=True, check=True).stdout
    fixtures.append(dict(
        name=name, integratedLufs=None if silence else float(measured["input_i"]),
        truePeakDbtp=None if silence else float(measured["input_tp"]),
        samples=len(pcm) // 4 // channels, rate=rate, channels=channels,
    ))


for rate in [32000, 44100, 48000]:
    for channels in [1, 2]:
        for vbr in [False, True]:
            generate(
                f"{rate}-{channels}-{'vbr' if vbr else 'cbr'}.mp3", rate, channels,
                "0.04*sin(2*PI*997*t)+0.008*sin(2*PI*11003*t)",
                ["-q:a", "4"] if vbr else ["-b:a", "128k"],
            )
generate("high-intersample-peak.mp3", 48000, 2, "0.93*sin(2*PI*11003*t)", ["-q:a", "2"])
generate("dynamic.mp3", 44100, 1, "if(lt(t\\,1)\\,0.0005\\,0.15)*sin(2*PI*997*t)", ["-q:a", "4"])
generate("silence.mp3", 44100, 1, "0", ["-b:a", "128k"], silence=True)
generate("no-xing.mp3", 44100, 1, "0.04*sin(2*PI*997*t)", ["-b:a", "128k"], ["-write_xing", "0"])
version = subprocess.run([ffmpeg, "-version"], capture_output=True, text=True, check=True).stdout.splitlines()[0]
(output / "reference.json").write_text(json.dumps(dict(
    generator="FFmpeg lavfi + libmp3lame; loudnorm measurement only", ffmpegVersion=version,
    fixtures=fixtures,
), indent=2) + "\n")

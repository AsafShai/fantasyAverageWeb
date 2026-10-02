"""Crop raw screenshots down to the part worth showing on a slide.

Raw captures are 1440x900. Each entry is the (top, bottom) pixel band to keep —
chosen to drop nav chrome / footers and to end on a clean table-row boundary so
no row is sliced in half. Output goes to shots/crop/, which both builders prefer
over the raw file when it exists.
"""
from pathlib import Path

from PIL import Image

SHOTS = Path(__file__).resolve().parent.parent / "shots"
OUT = SHOTS / "crop"

CROPS = {
    "01-navbar.png": (0, 470),
    "02-players.png": (555, 900),
    "03-players-matchup-expanded.png": (140, 638),
    "04-players-custom-range.png": (540, 900),
    "10-trends-minutes.png": (95, 712),
    "13-trends-minutes-expanded.png": (170, 740),
    "14-trends-usage-expanded.png": (170, 740),
    "15-trends-shooting-expanded.png": (170, 740),
    # re-captured 2026-08-22 at 1920x1080 for the video (new UI)
    "20-player-rankings.png": (250, 1078),
    "50-team-slots.png": (35, 572),
    "21-projections.png": (95, 525),
    "31-minigame-who-am-i.png": (60, 640),
    "32-minigame-now-you-see-me.png": (60, 640),
    "33-minigame-hangman.png": (60, 700),
    "34-minigame-who-he-play-for.png": (60, 640),
    "60-global-search.png": (0, 460),
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (top, bottom) in CROPS.items():
        src = SHOTS / name
        if not src.exists():
            print(f"  !! missing {name}")
            continue
        im = Image.open(src)
        im.crop((0, top, im.width, bottom)).save(OUT / name)
        print(f"  {name:<40} {im.width}x{bottom - top}  ratio {im.width / (bottom - top):.2f}")


if __name__ == "__main__":
    main()

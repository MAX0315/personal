from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps


SUPPORTED_EXTENSIONS = {".gif", ".jpeg", ".jpg", ".png"}


def thumbnail_path(source_root: Path, output_root: Path, source: Path) -> Path:
    relative = source.relative_to(source_root)
    return output_root / relative.with_suffix(".webp")


def generate_thumbnail(source: Path, destination: Path, max_size: tuple[int, int], quality: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)

    with Image.open(source) as image:
        if getattr(image, "is_animated", False):
            image.seek(0)

        image = ImageOps.exif_transpose(image)
        image.thumbnail(max_size, Image.Resampling.LANCZOS)

        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")

        image.save(
            destination,
            "WEBP",
            quality=quality,
            method=6,
            optimize=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate lightweight WebP thumbnails for design works.")
    parser.add_argument("--source", type=Path, default=Path("assets/design"))
    parser.add_argument("--output", type=Path, default=Path("assets/design-thumbs"))
    parser.add_argument("--max-width", type=int, default=960)
    parser.add_argument("--max-height", type=int, default=640)
    parser.add_argument("--quality", type=int, default=78)
    args = parser.parse_args()

    sources = sorted(
        path
        for path in args.source.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    original_bytes = 0
    thumbnail_bytes = 0

    for source in sources:
        destination = thumbnail_path(args.source, args.output, source)
        generate_thumbnail(
            source,
            destination,
            (args.max_width, args.max_height),
            args.quality,
        )
        original_bytes += source.stat().st_size
        thumbnail_bytes += destination.stat().st_size

    reduction = 0 if not original_bytes else 100 * (1 - thumbnail_bytes / original_bytes)
    print(
        f"Generated {len(sources)} thumbnails: "
        f"{original_bytes / 1024 / 1024:.1f} MB -> "
        f"{thumbnail_bytes / 1024 / 1024:.1f} MB "
        f"({reduction:.1f}% smaller)"
    )


if __name__ == "__main__":
    main()

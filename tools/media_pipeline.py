from __future__ import annotations

import argparse
from pathlib import Path

import requests
import yt_dlp
from bs4 import BeautifulSoup
from moviepy import VideoFileClip


def scrape_page_title(url: str) -> str:
    response = requests.get(url, timeout=20)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "lxml")
    return soup.title.string.strip() if soup.title and soup.title.string else "Untitled page"


def download_permitted_video(url: str, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    template = str(output_dir / "%(title).120s.%(ext)s")
    options = {
        "outtmpl": template,
        "format": "mp4/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best",
        "noplaylist": True,
    }

    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
        filename = downloader.prepare_filename(info)

    return Path(filename)


def trim_video(source: Path, destination: Path, start: float, end: float) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    duration = max(1, end - start)

    with VideoFileClip(str(source)).subclipped(start, start + duration) as clip:
        clip.write_videofile(
            str(destination),
            codec="libx264",
            audio_codec="aac",
            fps=30,
            preset="medium",
        )

    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description="Creator Pro media tooling")
    subparsers = parser.add_subparsers(dest="command", required=True)

    scrape_parser = subparsers.add_parser("scrape-title")
    scrape_parser.add_argument("url")

    download_parser = subparsers.add_parser("download")
    download_parser.add_argument("url")
    download_parser.add_argument("--output-dir", default="media/raw")

    trim_parser = subparsers.add_parser("trim")
    trim_parser.add_argument("source")
    trim_parser.add_argument("destination")
    trim_parser.add_argument("--start", type=float, default=0)
    trim_parser.add_argument("--end", type=float, default=30)

    args = parser.parse_args()

    if args.command == "scrape-title":
      print(scrape_page_title(args.url))
    elif args.command == "download":
      print(download_permitted_video(args.url, Path(args.output_dir)))
    elif args.command == "trim":
      print(trim_video(Path(args.source), Path(args.destination), args.start, args.end))


if __name__ == "__main__":
    main()

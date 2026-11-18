"""Build Sanad's Saudi Sign Language landmark index from the SSL dataset.

Usage (Python 3.11/3.12 with: pip install -r scripts/ssl/requirements.txt):
    python scripts/ssl/build_landmark_index.py --dataset ../../Saudi-Sign-Language-main/Saudi-Sign-Language-main \
        --out .data/ssl-landmarks.npz --categories 39_common_words,14_social_relations,19_jobs_and_careers

Videos are read from dataset/videos (run `git lfs pull` there first). With --download, a missing video
is fetched once from its public sshi.sa URL into --cache. Each sign becomes a 32-frame landmark template.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssl_features import FEATURES, SEQ_LEN, extract_sequence, resample  # noqa: E402


def read_video(path: Path, every: int = 2):
    import cv2

    capture = cv2.VideoCapture(str(path))
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % every == 0:
            yield cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        index += 1
    capture.release()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True, help='Folder containing dataset/metadata/dataset.csv')
    parser.add_argument('--out', default='.data/ssl-landmarks.npz')
    parser.add_argument('--categories', default='', help='Comma-separated category folders to include (default: all)')
    parser.add_argument('--include-unverified', action='store_true', help='Also use labels flagged needs_manual_review')
    parser.add_argument('--download', action='store_true', help='Download videos missing locally from their source_url')
    parser.add_argument('--cache', default='.data/ssl-video-cache')
    parser.add_argument('--limit', type=int, default=0)
    args = parser.parse_args()

    import mediapipe as mp

    dataset = Path(args.dataset)
    wanted = {item.strip() for item in args.categories.split(',') if item.strip()}
    with open(dataset / 'dataset' / 'metadata' / 'dataset.csv', encoding='utf-8-sig', newline='') as handle:
        rows = [row for row in csv.DictReader(handle)
                if (not wanted or row['category'] in wanted)
                and (args.include_unverified or row['verification_status'] == 'source_label')
                and row['category'] != '01_signal_alphabet_letters']
    if args.limit:
        rows = rows[:args.limit]

    templates, labels, video_ids = [], [], []
    holistic = mp.solutions.holistic.Holistic(static_image_mode=False, model_complexity=1)
    cache = Path(args.cache)
    try:
        for number, row in enumerate(rows, 1):
            path = dataset / 'dataset' / 'videos' / row['filename']
            if not path.exists() or path.stat().st_size < 2048:
                if not args.download:
                    continue
                path = cache / row['filename']
                if not path.exists():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    request = urllib.request.Request(row['source_url'], headers={'User-Agent': 'SanadSSLIndexer/1.0'})
                    with urllib.request.urlopen(request, timeout=60) as response, open(path, 'wb') as out:
                        out.write(response.read())
            sequence = extract_sequence(read_video(path), holistic)
            if len(sequence) < 4 or sequence[:, 126:128].max() < 0.5:
                continue  # no hands detected
            hands = sequence[sequence[:, 126:128].max(axis=1) > 0.5]
            templates.append(resample(hands))
            labels.append(row['label_ar'])
            video_ids.append(row['video_id'])
            if number % 50 == 0:
                print(f'{number}/{len(rows)} processed, {len(templates)} templates', flush=True)
    finally:
        holistic.close()

    if not templates:
        print('No templates built. Pull the videos (git lfs pull) or use --download.', file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, templates=np.stack(templates).astype(np.float16), labels=np.array(labels), video_ids=np.array(video_ids))
    print(f'Saved {len(templates)} templates ({SEQ_LEN}x{FEATURES}) to {out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

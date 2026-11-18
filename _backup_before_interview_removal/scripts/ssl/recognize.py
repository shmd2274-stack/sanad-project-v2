"""Recognise Saudi Sign Language signs in a candidate's answer (called by the Sanad server).

    python recognize.py --index .data/ssl-landmarks.npz --frames <dir of JPEG frames> [--vocab vocab.json]

`--vocab` restricts matching to signs that fit the current interview question (context-aware recognition).
Prints JSON: {"glosses": [{"label": "...", "score": 0.0-1.0}, ...], "segments": n}
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssl_features import extract_sequence, match_segment, segment_signs  # noqa: E402


def load_frames(folder: Path):
    import cv2

    for path in sorted(folder.glob('*.jpg')):
        image = cv2.imread(str(path))
        if image is not None:
            yield cv2.cvtColor(image, cv2.COLOR_BGR2RGB)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--index', required=True)
    parser.add_argument('--frames', required=True)
    parser.add_argument('--vocab')
    args = parser.parse_args()

    data = np.load(args.index, allow_pickle=False)
    templates = data['templates'].astype(np.float32)
    labels = [str(label) for label in data['labels']]
    if args.vocab:
        vocab = set(json.loads(Path(args.vocab).read_text(encoding='utf-8')))
        keep = [i for i, label in enumerate(labels) if label in vocab]
        if len(keep) >= 5:  # fall back to the full index when the context vocabulary is too small
            templates, labels = templates[keep], [labels[i] for i in keep]

    sequence = extract_sequence(load_frames(Path(args.frames)))
    segments = segment_signs(sequence)
    glosses = []
    for segment in segments[:12]:
        label, score = match_segment(segment, templates, labels)
        if label and (not glosses or glosses[-1]['label'] != label):
            glosses.append({'label': label, 'score': round(score, 3)})
    print(json.dumps({'glosses': glosses, 'segments': len(segments)}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())

"""Shared Saudi Sign Language feature extraction and matching for Sanad.

Features per frame (142 values): both hands (21 landmarks x 3, normalised to the signer's
shoulders), a presence flag per hand, and 7 upper-body pose points (x, y).
Matching: coarse filter on pooled vectors, then dynamic time warping (DTW) on the top candidates.
Only numpy is needed here; MediaPipe is imported lazily by `extract_sequence`.
"""
from __future__ import annotations

import numpy as np

SEQ_LEN = 32
POSE_POINTS = (0, 11, 12, 13, 14, 15, 16)  # nose, shoulders, elbows, wrists
FEATURES = 21 * 3 * 2 + 2 + len(POSE_POINTS) * 2


def frame_features(left, right, pose) -> np.ndarray:
    """left/right: (21, 3) arrays or None; pose: (33, 3) array or None (MediaPipe image coordinates)."""
    out = np.zeros(FEATURES, dtype=np.float32)
    if pose is not None:
        center = (pose[11, :2] + pose[12, :2]) / 2
        scale = float(np.linalg.norm(pose[11, :2] - pose[12, :2])) or 1.0
    else:
        hands = [h for h in (left, right) if h is not None]
        center = np.mean([h[0, :2] for h in hands], axis=0) if hands else np.zeros(2)
        scale = 0.25
    for slot, hand in enumerate((left, right)):
        if hand is None:
            continue
        norm = hand.copy()
        norm[:, :2] = (norm[:, :2] - center) / scale
        norm[:, 2] = norm[:, 2] / scale
        out[slot * 63:(slot + 1) * 63] = norm.reshape(-1)
        out[126 + slot] = 1.0
    if pose is not None:
        points = (pose[list(POSE_POINTS), :2] - center) / scale
        out[128:] = points.reshape(-1)
    return out


def resample(sequence: np.ndarray, length: int = SEQ_LEN) -> np.ndarray:
    if len(sequence) == 0:
        return np.zeros((length, FEATURES), dtype=np.float32)
    idx = np.linspace(0, len(sequence) - 1, length)
    lo = np.floor(idx).astype(int)
    hi = np.minimum(lo + 1, len(sequence) - 1)
    t = (idx - lo)[:, None]
    return ((1 - t) * sequence[lo] + t * sequence[hi]).astype(np.float32)


def segment_signs(sequence: np.ndarray, min_len: int = 4, gap: int = 3) -> list[np.ndarray]:
    """Split a continuous answer into sign units: runs where a hand is visible and moving, separated by pauses."""
    if len(sequence) == 0:
        return []
    present = sequence[:, 126:128].max(axis=1) > 0.5
    wrists = sequence[:, [0, 1, 63, 64]]
    motion = np.r_[0, np.linalg.norm(np.diff(wrists, axis=0), axis=1)]
    active = present & (motion > np.percentile(motion[present], 20) if present.any() else present)
    segments, start, quiet = [], None, 0
    for i, on in enumerate(active):
        if on:
            start = i if start is None else start
            quiet = 0
        elif start is not None:
            quiet += 1
            if quiet >= gap:
                end = i - quiet + 1
                if end - start >= min_len:
                    segments.append(sequence[start:end])
                start, quiet = None, 0
    if start is not None and len(sequence) - start >= min_len:
        segments.append(sequence[start:])
    if not segments and present.sum() >= min_len:
        segments = [sequence[present]]
    return segments


def dtw(a: np.ndarray, b: np.ndarray) -> float:
    cost = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2)
    n, m = cost.shape
    acc = np.full((n + 1, m + 1), np.inf)
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        row = cost[i - 1]
        for j in range(1, m + 1):
            acc[i, j] = row[j - 1] + min(acc[i - 1, j], acc[i, j - 1], acc[i - 1, j - 1])
    return float(acc[n, m] / (n + m))


def match_segment(segment: np.ndarray, templates: np.ndarray, labels: list[str], shortlist: int = 25):
    """Returns (label, confidence 0..1) for one sign segment."""
    query = resample(segment)
    pooled_query = np.concatenate([query.reshape(4, SEQ_LEN // 4, FEATURES).mean(axis=1).reshape(-1)])
    pooled = templates.reshape(len(templates), 4, SEQ_LEN // 4, FEATURES).mean(axis=2).reshape(len(templates), -1)
    coarse = np.linalg.norm(pooled - pooled_query, axis=1)
    order = np.argsort(coarse)[:shortlist]
    scored = sorted((dtw(query, templates[i]), i) for i in order)
    if not scored:
        return None, 0.0
    best, best_i = scored[0]
    runner = next((d for d, i in scored[1:] if labels[i] != labels[best_i]), best * 2 or 1.0)
    margin = (runner - best) / runner if runner else 0.0
    absolute = 1.0 / (1.0 + best)
    return labels[best_i], float(max(0.0, min(1.0, 0.6 * margin * 2 + 0.4 * absolute)))


def extract_sequence(frames, holistic=None) -> np.ndarray:
    """frames: iterable of RGB numpy images. Uses MediaPipe Holistic (Python 3.9–3.12)."""
    import mediapipe as mp  # noqa: WPS433 (optional heavy dependency)

    owner = holistic is None
    holistic = holistic or mp.solutions.holistic.Holistic(static_image_mode=False, model_complexity=1)
    rows = []
    try:
        for image in frames:
            result = holistic.process(image)
            to_np = lambda lm: None if lm is None else np.array([[p.x, p.y, p.z] for p in lm.landmark], dtype=np.float32)  # noqa: E731
            rows.append(frame_features(to_np(result.left_hand_landmarks), to_np(result.right_hand_landmarks), to_np(result.pose_landmarks)))
    finally:
        if owner:
            holistic.close()
    return np.array(rows, dtype=np.float32) if rows else np.zeros((0, FEATURES), dtype=np.float32)

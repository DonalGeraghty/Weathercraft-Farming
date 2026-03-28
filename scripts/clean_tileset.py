from PIL import Image
import numpy as np

TARGET_SIZE = 76  # all output tiles will be this size

def get_content_mask(img_array):
    r, g, b = img_array[:,:,0], img_array[:,:,1], img_array[:,:,2]
    return ~((r > 230) & (g > 230) & (b > 230))

def find_segments(mask_1d, min_gap=8):
    segments = []
    in_content = False
    start = 0
    for i, val in enumerate(mask_1d):
        if val and not in_content:
            in_content = True; start = i
        elif not val and in_content:
            in_content = False; segments.append((start, i))
    if in_content:
        segments.append((start, len(mask_1d)))
    merged = []
    for seg in segments:
        if merged and seg[0] - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], seg[1])
        else:
            merged.append(list(seg))
    return [tuple(s) for s in merged if mask_1d[s[0]:s[1]].any()]

def force_divide(total, n):
    """Divide [0, total] into n equal parts."""
    return [(int(i * total / n), int((i + 1) * total / n)) for i in range(n)]

def tight_crop(tile_arr, tile_mask, padding=1):
    """Crop to content bounding box with small padding."""
    rows = np.where(tile_mask.any(axis=1))[0]
    cols = np.where(tile_mask.any(axis=0))[0]
    if len(rows) == 0 or len(cols) == 0:
        return tile_arr
    r0 = max(0, rows[0] - padding)
    r1 = min(tile_arr.shape[0], rows[-1] + 1 + padding)
    c0 = max(0, cols[0] - padding)
    c1 = min(tile_arr.shape[1], cols[-1] + 1 + padding)
    return tile_arr[r0:r1, c0:c1]

img = Image.open("assets/sprites/Gemini_Generated_Image_ixz1mdixz1mdixz1.png").convert("RGB")
img_array = np.array(img)
mask = get_content_mask(img_array)
print(f"Image: {img.size[0]}x{img.size[1]}")

# min_gap=15 for row bands (large inter-band gaps)
row_bands = find_segments(mask.any(axis=1), min_gap=15)

all_tiles = []

for band_i, (rb_start, rb_end) in enumerate(row_bands):
    band_mask = mask[rb_start:rb_end, :]

    # min_gap=20: merges 16px intra-group gaps without merging 22px inter-group gaps
    col_groups = find_segments(band_mask.any(axis=0), min_gap=20)

    for group_j, (cg_start, cg_end) in enumerate(col_groups):
        gm  = mask[rb_start:rb_end, cg_start:cg_end]
        gp  = img_array[rb_start:rb_end, cg_start:cg_end]
        gh, gw = gp.shape[:2]

        # Detect columns and rows within the group
        col_segs = find_segments(gm.any(axis=0), min_gap=2)
        row_segs = find_segments(gm.any(axis=1), min_gap=2)

        n_cols = len(col_segs)
        n_rows = len(row_segs)

        # If group is tall but only 1 row detected (no visible gap between rows),
        # force 2 rows (all groups in this sheet have 2 rows per band)
        if n_rows == 1 and gh > 120:
            n_rows = 2

        # Force-divide the group evenly into the tile grid
        row_divs = force_divide(gh, n_rows)
        col_divs = force_divide(gw, n_cols)

        print(f"  Band {band_i} Group {group_j}: {n_rows}r x {n_cols}c  "
              f"(x={cg_start}-{cg_end} w={gw}, y={rb_start}-{rb_end} h={gh})")

        for r0, r1 in row_divs:
            for c0, c1 in col_divs:
                tile      = gp[r0:r1, c0:c1]
                tile_mask = gm[r0:r1, c0:c1]
                tile      = tight_crop(tile, tile_mask, padding=1)
                t = Image.fromarray(tile).resize(
                    (TARGET_SIZE, TARGET_SIZE), Image.NEAREST)
                all_tiles.append(np.array(t))

# ── Build output grid ────────────────────────────────────────────────────────
n       = len(all_tiles)
cols_out = 16
rows_out = (n + cols_out - 1) // cols_out
pad      = 4
cell     = TARGET_SIZE + pad
out_w    = cols_out * cell + pad
out_h    = rows_out * cell + pad
out      = np.ones((out_h, out_w, 3), dtype=np.uint8) * 255

for i, tile in enumerate(all_tiles):
    r = i // cols_out
    c = i % cols_out
    y = pad + r * cell
    x = pad + c * cell
    out[y:y + TARGET_SIZE, x:x + TARGET_SIZE] = tile

Image.fromarray(out).save("assets/sprites/tileset_clean.png")
print(f"\n{n} tiles -> assets/sprites/tileset_clean.png  ({out_w}x{out_h}px)")

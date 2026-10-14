"""Remove backdrop RGB contamination within two pixels of a segmented edge."""
import numpy as np
from scipy.ndimage import binary_erosion, distance_transform_edt
from PIL import Image


def clean_boundary(image, cutout):
    source = np.asarray(image).astype(float)
    result = np.asarray(cutout).copy()
    alpha = result[:, :, 3]
    core = binary_erosion(alpha >= 254, iterations=2, border_value=0)
    distance, nearest = distance_transform_edt(~core, return_indices=True)
    interior = source[nearest[0], nearest[1]]
    border = np.concatenate([source[0], source[-1], source[:, 0], source[:, -1]])
    backdrop = np.median(border, axis=0)
    direction = backdrop - interior
    denominator = np.maximum(np.sum(direction * direction, axis=2), 1)
    blend = np.sum((source - interior) * direction, axis=2) / denominator
    residual = np.linalg.norm(source - (interior + blend[:, :, None] * direction), axis=2)
    # Only a narrow, color-contaminated edge can be corrected. No color determines
    # foreground membership, and the eroded subject interior is never changed.
    contamination = np.linalg.norm(source - interior, axis=2)
    fix = ((alpha > 0) & (distance <= 2.9) & (~core) & (blend > .05)
           & (blend < .98) & (residual < 20) & (contamination > 35))
    result[fix, :3] = interior[fix].astype(np.uint8)
    estimated_alpha = np.clip((1 - blend) * 255, 0, 255).astype(np.uint8)
    result[fix, 3] = np.minimum(alpha[fix], estimated_alpha[fix])
    # Only preserve matting's RGB estimates inside its uncertain boundary band.
    fractional = (result[:, :, 3] > 0) & (result[:, :, 3] < 255)
    preserve = ~(fractional | fix)
    result[preserve, :3] = source[preserve].astype(np.uint8)
    return Image.fromarray(result), int(fix.sum())

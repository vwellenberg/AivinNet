"""
Thumbnail geometry, shared by every place that scales a picture down (#391).

Four copies of "scale to a width, keep the ratio" each failed on odd shapes:
a 2000x1 banner came out 0 pixels high (`resize` raises ValueError), a 1x2000
strip asked for millions of rows and then failed at WebP's size limit. A
picture beyond 1:4 either way is cropped to its centre first, so a thumbnail
is never distorted and never degenerate.
"""

# A thumbnail is at most this many times as wide as high, or as high as wide.
MAX_ASPECT = 4


def crop_box(width: int, height: int) -> tuple[int, int, int, int] | None:
    """The centre of a picture beyond 1:`MAX_ASPECT` either way, or None to keep it whole."""
    if width > height * MAX_ASPECT:
        kept = height * MAX_ASPECT
        left = (width - kept) // 2
        return (left, 0, left + kept, height)
    if height > width * MAX_ASPECT:
        kept = width * MAX_ASPECT
        top = (height - kept) // 2
        return (0, top, width, top + kept)
    return None


def thumb_size(width: int, height: int, size: int, upscale: bool = True) -> tuple[int, int]:
    """
    Width and height of a thumbnail `size` wide, keeping the ratio of an
    already cropped picture; never 0, never past the aspect limit. Without
    `upscale`, a picture narrower than `size` keeps its width.
    """
    target = size if upscale else min(size, width)
    target = max(1, target)
    return target, max(1, min(round(target * height / width), target * MAX_ASPECT))

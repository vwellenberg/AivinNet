"""Thumbnail geometry for pictures of any shape (#391)."""

import pytest

from aivinnet.utils.thumbs import MAX_ASPECT, crop_box, thumb_size


@pytest.mark.parametrize(("width", "height"), [(600, 600), (600, 400), (400, 600), (400, 1600), (1600, 400)])
def test_an_ordinary_cover_is_kept_whole(width, height):
    assert crop_box(width, height) is None


def test_a_banner_keeps_its_centre():
    assert crop_box(2000, 1) == (998, 0, 1002, 1)
    assert crop_box(1000, 10) == (480, 0, 520, 10)


def test_a_tall_strip_keeps_its_centre():
    assert crop_box(1, 2000) == (0, 998, 1, 1002)


@pytest.mark.parametrize(("width", "height"), [(4, 1), (1, 4), (2000, 1), (1, 2000), (1, 1), (3000, 2000)])
@pytest.mark.parametrize("size", [64, 96, 1024])
def test_a_thumbnail_is_never_degenerate(width, height, size):
    box = crop_box(width, height)
    if box:
        width, height = box[2] - box[0], box[3] - box[1]

    w, h = thumb_size(width, height, size)

    assert w == size
    assert 1 <= h <= MAX_ASPECT * size


def test_the_ratio_is_kept():
    assert thumb_size(600, 400, 96) == (96, 64)


def test_without_upscaling_a_small_picture_keeps_its_width():
    assert thumb_size(50, 50, 512, upscale=False) == (50, 50)
    assert thumb_size(800, 400, 512, upscale=False) == (512, 256)

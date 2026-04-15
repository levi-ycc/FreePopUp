#!/usr/bin/env python3
"""Generate PNG icons for FreePopUp Chrome extension."""
import struct
import zlib
import os

def create_png(width, height, pixels_func):
    """Create a PNG file from a pixel function."""
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # 8-bit RGBA
    ihdr = make_chunk(b'IHDR', ihdr_data)

    # IDAT
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00'  # filter byte
        for x in range(width):
            r, g, b, a = pixels_func(x, y, width, height)
            raw_data += struct.pack('BBBB', r, g, b, a)

    compressed = zlib.compress(raw_data)
    idat = make_chunk(b'IDAT', compressed)

    # IEND
    iend = make_chunk(b'IEND', b'')

    # Full PNG
    return b'\x89PNG\r\n\x1a\n' + ihdr + idat + iend


def icon_pixels(x, y, w, h):
    """Generate pixel colors for the FreePopUp icon."""
    import math

    cx, cy = w / 2, h / 2
    margin = w * 0.08

    # Normalize coordinates
    nx = x / w
    ny = y / h

    # --- Background: rounded rectangle with gradient ---
    # Check if inside rounded rect
    r_corner = w * 0.18
    inside = True
    # Check corners
    corners = [
        (margin + r_corner, margin + r_corner),
        (w - margin - r_corner, margin + r_corner),
        (margin + r_corner, h - margin - r_corner),
        (w - margin - r_corner, h - margin - r_corner),
    ]

    if x < margin + r_corner and y < margin + r_corner:
        dist = math.sqrt((x - corners[0][0])**2 + (y - corners[0][1])**2)
        if dist > r_corner:
            inside = False
    elif x > w - margin - r_corner and y < margin + r_corner:
        dist = math.sqrt((x - corners[1][0])**2 + (y - corners[1][1])**2)
        if dist > r_corner:
            inside = False
    elif x < margin + r_corner and y > h - margin - r_corner:
        dist = math.sqrt((x - corners[2][0])**2 + (y - corners[2][1])**2)
        if dist > r_corner:
            inside = False
    elif x > w - margin - r_corner and y > h - margin - r_corner:
        dist = math.sqrt((x - corners[3][0])**2 + (y - corners[3][1])**2)
        if dist > r_corner:
            inside = False
    elif x < margin or x >= w - margin or y < margin or y >= h - margin:
        inside = False

    if not inside:
        return (0, 0, 0, 0)

    # Gradient background: purple (#7C3AED) to dark (#1a1a2e)
    t = (nx + ny) / 2
    bg_r = int(124 * (1 - t * 0.7) * 0.35 + 26 * 0.65)
    bg_g = int(58 * (1 - t * 0.7) * 0.35 + 26 * 0.65)
    bg_b = int(237 * (1 - t * 0.7) * 0.35 + 46 * 0.65)

    # --- Draw a play triangle (video symbol) ---
    # Video screen area - left portion
    screen_left = w * 0.15
    screen_right = w * 0.62
    screen_top = h * 0.22
    screen_bottom = h * 0.68

    # Screen background
    if screen_left <= x <= screen_right and screen_top <= y <= screen_bottom:
        # Dark screen
        r, g, b = 20, 20, 35
        # Play triangle in center of screen
        scx = (screen_left + screen_right) / 2
        scy = (screen_top + screen_bottom) / 2
        tri_size = (screen_right - screen_left) * 0.3

        # Triangle test: pointing right
        tx = x - (scx - tri_size * 0.3)
        ty = y - scy
        if tx >= 0 and tx <= tri_size and abs(ty) <= (tri_size * 0.5) * (1 - tx / tri_size):
            # Gradient: purple to cyan
            gt = tx / tri_size
            r = int(124 * (1 - gt) + 6 * gt)
            g = int(58 * (1 - gt) + 182 * gt)
            b = int(237 * (1 - gt) + 212 * gt)

        # Screen border
        border_w = max(1, w * 0.02)
        if (abs(x - screen_left) < border_w or abs(x - screen_right) < border_w or
            abs(y - screen_top) < border_w or abs(y - screen_bottom) < border_w):
            r, g, b = 80, 80, 120

        return (r, g, b, 255)

    # --- Pop-out arrow (upper right) ---
    arrow_cx = w * 0.76
    arrow_cy = h * 0.35
    arrow_size = w * 0.18

    # Small floating screen (popped out)
    pop_left = w * 0.62
    pop_right = w * 0.90
    pop_top = h * 0.38
    pop_bottom = h * 0.72

    if pop_left <= x <= pop_right and pop_top <= y <= pop_bottom:
        border_w = max(1, w * 0.02)
        if (abs(x - pop_left) < border_w or abs(x - pop_right) < border_w or
            abs(y - pop_top) < border_w or abs(y - pop_bottom) < border_w):
            # Cyan border for pop-out window
            return (6, 182, 212, 255)
        # Inner
        gt = (x - pop_left) / (pop_right - pop_left)
        r = int(124 * (1 - gt) + 6 * gt)
        g = int(58 * (1 - gt) + 182 * gt)
        b = int(237 * (1 - gt) + 212 * gt)
        return (r, g, b, 180)

    # --- Arrow pointing from screen to pop-out ---
    # Diagonal arrow line
    ax1, ay1 = w * 0.55, h * 0.45  # start (from main screen)
    ax2, ay2 = w * 0.68, h * 0.32  # end (to pop-out)
    line_len = math.sqrt((ax2 - ax1)**2 + (ay2 - ay1)**2)

    if line_len > 0:
        # Project point onto line
        dx, dy = ax2 - ax1, ay2 - ay1
        t_proj = max(0, min(1, ((x - ax1) * dx + (y - ay1) * dy) / (line_len ** 2)))
        px = ax1 + t_proj * dx
        py = ay1 + t_proj * dy
        dist = math.sqrt((x - px)**2 + (y - py)**2)
        arrow_w = max(1.5, w * 0.025)

        if dist < arrow_w:
            return (6, 182, 212, 230)

        # Arrowhead
        if t_proj > 0.7:
            head_size = w * 0.06
            # Check if near arrowhead area
            adist = math.sqrt((x - ax2)**2 + (y - ay2)**2)
            if adist < head_size:
                return (6, 182, 212, 220)

    return (bg_r, bg_g, bg_b, 255)


if __name__ == '__main__':
    script_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(script_dir, 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    for size in [16, 48, 128]:
        png_data = create_png(size, size, icon_pixels)
        path = os.path.join(icons_dir, f'icon{size}.png')
        with open(path, 'wb') as f:
            f.write(png_data)
        print(f'Generated {path} ({len(png_data)} bytes)')

    print('Done!')

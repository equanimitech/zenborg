# Globe-spin scroll animation for the banded heatmap

Raw capture — 2026-04-30.

- When scrolling/dragging the banded heatmap, the motion should feel like spinning a very long globe — momentum, deceleration, a slight curvature/parallax sense rather than flat linear pan.
- Today's vermillion-replaced "NOW" hairline is the polar axis you spin around.
- Open questions:
  - Native CSS scroll snap won't get there — needs custom inertial scroll (rAF loop with friction).
  - Subtle perspective transform on cells far from center? Or just easing?
  - `prefers-reduced-motion` must collapse this to a clean linear pan.
  - Touch trackpad already has native momentum — don't double-up.
- Don't shape yet.

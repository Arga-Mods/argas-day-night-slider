# Arga's Day-Night Slider

This is a system-agnostic, very lightweight GM module (under 40 KB) for quick and easy adjustment of canvas brightness.

By default, the slider docks to the bottom-left of the Active Players window, but it can be freely repositioned by simply dragging it anywhere on screen. The module remembers the new position.

When the UI scaling is changed, the slider adapts automatically. It does not fade out, so you always have the current canvas brightness at a glance.

![Day-Night Slider](https://raw.githubusercontent.com/Arga-Mods/argas-day-night-slider/main/screenshots/slider.webp)


## Features in Detail

- Clicking the **sun** or **moon** icon instantly sets maximum brightness or darkness, respectively.
- For custom brightness levels, the slider handle can be grabbed and moved with the left mouse button.
- While the cursor is hovering over the slider area, brightness can also be adjusted using the **scroll wheel**:
  - **Scroll Wheel** — Steps of 1/100 (i.e. 1% increments for smooth adjustments)
  - **Ctrl + Scroll** — Steps of 1/300 (for subtle, creeping changes your players will barely notice)
  - **Shift + Scroll** — Steps of 1/12 (i.e. 12 scroll steps = 12 hours)
- **Repositioning:** When the cursor approaches the slider, a drag handle (three dots) appears above it. When dragged to a new position, the slider will try to snap to nearby screen edges or the hotbar, but can also be placed freely. Moving the slider back near the Active Players window triggers a wiggle animation to indicate the correct docking position. Regardless of the slider's current position, double-clicking the drag handle will snap it back to the Players window.


## Notes

Bug reports are welcome, but please don't request new features. This module is intentionally kept small and simple, and that's by design. For extended functionality like time of day, calendars, or moon phases, there are already wonderful other modules available.



*Enjoy — Arga*

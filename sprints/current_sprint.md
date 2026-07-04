```
Goal: Introduce hostile elements that challenge the player's gravitational planning.

Requirements:
1. Create a class structure for "Obstacles" which can be of three types:
   - 'hostile_devourer': Swallows particles that get too close (deducts potential points, reduces success %).
   - 'solid_asteroid': Elastic collision boundary (particles bounce off physically).
   - 'wind_field': Applies a constant vector force (directional draft) in a localized rectangle.
2. Allow levels to define custom arrays of these obstacles placed statically on the map.
3. Render devourers with a pulsing red core and a surrounding event-horizon circle. Particles falling inside are instantly deleted.

Acceptance Criteria:
- Players must place Gravity Anchors strategically to curve particle flight paths *around* these hostile obstacles.
- Solid asteroids deflect particles realistically based on their bounce variables.

```


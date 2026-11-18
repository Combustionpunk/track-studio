# Lane squares within the pipe margin of an obstacle are blocked

On the step 1 grid, a square counts as blocked when an obstacle comes within half the pipe's width (`PIPE_SIZE / 2`: 3.25 cm since rctrack 1.12, when the pipe became 0.065 m square; 4 cm before), not only when they overlap. Otherwise a square that just touches an obstacle passes the grid, but the bake raises `obstacle` because its obstacle check covers the lanes plus half the pipe's width. This is slightly stricter than "any overlap", but anything the grid allows bakes clean. Accepted by the Board (Yeti, 2026-11-05) in #44.

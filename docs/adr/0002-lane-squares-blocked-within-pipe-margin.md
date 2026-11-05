# Lane squares within the pipe margin of an obstacle are blocked

On the step 1 grid, a square counts as blocked when an obstacle comes within `PIPE_R` (4 cm) of it, not only when they overlap. Otherwise a square that just touches an obstacle passes the grid, but the bake raises `obstacle` because its obstacle check covers the lanes plus half the pipe's thickness. This is slightly stricter than "any overlap", but anything the grid allows bakes clean. Accepted by the Board (Yeti, 2026-11-05) in #44.

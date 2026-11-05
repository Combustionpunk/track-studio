# On touch, no long-press delete, and the apex handle wins over the corner

In Quick mode's step 2, a touch long-press doesn't delete a corner (Chrome fires `contextmenu` on long-press, so it would delete by accident); only a mouse right-click or Delete does. On a tight hairpin the 44 px touch targets of a corner and its apex handle can overlap; there the apex handle wins. Accepted by the Board (Yeti, 2026-11-05) in #48.

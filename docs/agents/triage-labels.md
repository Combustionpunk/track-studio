# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Workflow labels

These move work between the Mechanic, the Tester and the Board. See `docs/agents/README.md` for the full flow.

| Label | On | Meaning |
| --- | --- | --- |
| `in-progress` | issue | The Mechanic has claimed it |
| `needs-testing` | PR | Ready for the Tester |
| `tests-failed` | PR | The Tester found failures; back to the Mechanic |
| `board` | issue or PR | Needs Yeti or Marshal: a decision, a review or a blocker |
| `priority:high`, `priority:medium`, `priority:low` | issue | Pick order for the worker |

Dependencies: list blockers under a `## Blocked by` heading in the issue body (`- #12`). The worker skips the issue until they're all closed.

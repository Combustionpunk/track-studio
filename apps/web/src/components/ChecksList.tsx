// The engine's checks in plain words, with a way to jump to the problem on the plan.
import type { Check } from "@track-studio/engine";
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";

const ORDER = { error: 0, warning: 1, info: 2 } as const;
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** One line: "No problems.", "No errors. 1 warning: corner 3 is tight.", "2 errors, 1 warning." Notes don't count. */
export function checksSummary(checks: Check[]): string {
  const errors = checks.filter((c) => c.level === "error");
  const warnings = checks.filter((c) => c.level === "warning");
  if (!errors.length && !warnings.length) return "No problems.";
  if (!errors.length) return warnings.length === 1 ? `No errors. 1 warning: ${sentence(warnings[0].message)}` : `No errors. ${count(warnings.length, "warning")}.`;
  return `${[count(errors.length, "error"), warnings.length ? count(warnings.length, "warning") : ""].filter(Boolean).join(", ")}.`;
}

export function ChecksList({ checks, onShow, okText = "No problems." }: { checks: Check[]; onShow: (c: Check) => void; okText?: string }) {
  const sorted = [...checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  const problems = sorted.some((c) => c.level !== "info");
  return (
    <section className="ts-section" aria-labelledby="checks-h">
      <h2 id="checks-h" className="ts-heading">
        Checks
      </h2>
      {!problems && (
        <p className="ts-check ts-check--ok">
          <CircleCheck size={16} aria-hidden />
          <span>{okText}</span>
        </p>
      )}
      {problems && <p className="ts-summary">{checksSummary(checks)}</p>}
      {sorted.length > 0 && (
        <ul className="ts-checks">
          {sorted.map((c, i) => (
            <li key={i} className={`ts-check ts-check--${c.level}`}>
              {c.level === "error" ? <CircleAlert size={16} aria-hidden /> : c.level === "warning" ? <TriangleAlert size={16} aria-hidden /> : <Info size={16} aria-hidden />}
              <span>
                <span className="sr-only">{c.level === "error" ? "Error: " : c.level === "warning" ? "Warning: " : "Note: "}</span>
                {c.message}
              </span>
              {c.x !== undefined && (
                <button type="button" className="ts-check__go" onClick={() => onShow(c)}>
                  Show
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// A "?" link to a section of the user guide (#171). It opens in a new tab: in the designer the drawing stays where it
// is, and on the build sheet the sheet stays ready to print.
import { CircleQuestionMark } from "lucide-react";
import type { ReactNode } from "react";
import { HELP_TOPICS, helpHref, type HelpTopic } from "./topics.js";

export function HelpLink({ topic, className = "", children }: { topic: HelpTopic; className?: string; children?: ReactNode }) {
  const label = HELP_TOPICS[topic].label;
  return (
    <a className={`help-link ${className}`.trim()} href={helpHref(topic)} target="_blank" rel="noopener" aria-label={`${label} (opens in a new tab)`} title={label}>
      <CircleQuestionMark size={18} aria-hidden="true" />
      {children}
    </a>
  );
}

/**
 * "Which program starts it?" (usePrograms.ts): in Big Picture with the
 * controller, as the download picker; in desktop mode as upstream's.
 */
import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { useInputHandler } from "../context";
import { LAYER } from "../input/router";
import type { ProgramChoice } from "./usePrograms";

const lead = (title: string) =>
  `${title}'s folder has more than one program, and the catalog doesn't say which starts it on this computer. Big Quiver remembers the one you pick.`;

export function ProgramPickerBp({ choice }: { choice: ProgramChoice | null }) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [choice]);

  useInputHandler(
    {
      onAction(action) {
        if (!choice) return;
        if (action === "up") setIndex((i) => Math.max(0, i - 1));
        else if (action === "down") setIndex((i) => Math.min(choice.choices.length - 1, i + 1));
        else if (action === "accept") choice.resolve(choice.choices[index]);
        else if (action === "back") choice.resolve(null);
      },
      hints: () => [
        { action: "accept", label: "Start this" },
        { action: "back", label: "Cancel" },
      ],
    },
    LAYER.dialog,
    Boolean(choice),
  );

  if (!choice) return null;
  return (
    <div className="bp-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Choose a program">
      <section className="bp-dialog">
        <div className="bp-dialog-body">
          <h2>Which program starts it?</h2>
          <p className="bp-dialog-lead">{lead(choice.title)}</p>
          <ul className="bp-asset-list">
            {choice.choices.map((path, i) => (
              <li key={path} className={i === index ? "focused" : ""} onMouseMove={() => setIndex(i)} onClick={() => choice.resolve(path)}>
                <Play aria-hidden="true" />
                <span>{path}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export function ProgramPickerDesktop({ choice }: { choice: ProgramChoice | null }) {
  if (!choice) return null;
  return (
    <div className="overlay">
      <section className="detail choose" role="dialog" aria-label="Choose a program">
        <div className="detail-body">
          <h2>Which program starts it?</h2>
          <p className="muted">{lead(choice.title)}</p>
          <div className="choices">
            {choice.choices.map((path) => (
              <button key={path} onClick={() => choice.resolve(path)}>
                {path}
              </button>
            ))}
          </div>
          <button onClick={() => choice.resolve(null)}>Cancel</button>
        </div>
      </section>
    </div>
  );
}

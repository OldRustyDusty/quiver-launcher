/**
 * The question "Use the same games folder as Quiver 3?", its preview, progress
 * and result (useShare.ts). In Big Picture it takes the controller; in desktop
 * mode it's an ordinary dialog for the mouse and keyboard.
 */
import { FolderSync, Loader2 } from "lucide-react";
import { useInputHandler } from "../context";
import type { InputAction } from "../input/actions";
import { LAYER, type ButtonHint } from "../input/router";
import { Glyph } from "../views/Glyph";
import { previewLines } from "./v3share";
import type { Share } from "./useShare";

function hintsFor(share: Share): ButtonHint[] {
  const d = share.dialog;
  if (d?.kind === "ask") {
    const ready = Boolean(d.plan) && !d.running && !d.error;
    return [
      ...(ready ? [{ action: "accept" as const, label: "Yes" }] : []),
      { action: "back", label: "Not now" },
      ...(d.oneTime ? [{ action: "details" as const, label: "Don't ask again" }] : []),
    ];
  }
  if (d?.kind === "done") return [{ action: "accept", label: "OK" }];
  return [];
}

function press(share: Share, action: InputAction) {
  const d = share.dialog;
  if (d?.kind === "ask") {
    if (action === "accept") share.accept();
    else if (action === "back") share.notNow();
    else if (action === "details" && d.oneTime) share.dontAsk();
  } else if (d?.kind === "done" && (action === "accept" || action === "back")) share.closeDialog();
}

function Body({ share, glyphs }: { share: Share; glyphs: boolean }) {
  const d = share.dialog;
  if (!d) return null;
  const hints = hintsFor(share);
  const buttons = hints.length > 0 && (
    <div className="bp-dialog-buttons">
      {hints.map((h) => (
        <button key={h.action} type="button" className={h.action === "accept" ? "primary" : ""} onClick={() => press(share, h.action)}>
          {glyphs && <Glyph action={h.action} size={22} />}
          {h.label}
        </button>
      ))}
    </div>
  );

  if (d.kind === "ask") {
    const lines = d.plan ? previewLines(d.plan, d.gamesDir) : [];
    return (
      <>
        <h2>
          <FolderSync aria-hidden="true" /> Use the same games folder as Quiver 3?
        </h2>
        <p className="bp-dialog-lead">
          This is a new feature, and is <b>Recommended</b>. When enabled, Quiver 3 and Big Quiver Launcher will share the same game files and folders, so each game is
          installed once, and its updates and saves work in both.
        </p>
        <p className="bp-dialog-lead">
          If this feature isn't enabled, note that Quiver 3 will not see game updates or newly installed games from Big Quiver Launcher, if launched separately on its
          own.
        </p>
        <p className="bp-dialog-lead">
          Games you get in Big Quiver Launcher will install to <b className="bp-share-path">{d.gamesDir}</b> with your Quiver 3 games.
        </p>
        {d.error ? (
          <p className="bp-error">{d.error}</p>
        ) : !d.plan ? (
          <p className="bp-dialog-lead small">
            <Loader2 className="bp-spin" aria-hidden="true" /> Checking your games…
          </p>
        ) : (
          lines.length > 0 && (
            <ul className="bp-dialog-notes">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )
        )}
        {d.plan && d.plan.moves.length + d.plan.duplicates.length > 0 && (
          <p className="bp-dialog-lead small">Moved games will keep their save files. Note that any desktop shortcuts for individual games will be regenerated, however if you're using custom Steam shortcuts those will need to be re-created manually.</p>
        )}
        {d.running && <p className="bp-error">Close Quiver Launcher 3 to continue.</p>}
        {buttons}
      </>
    );
  }

  if (d.kind === "working") {
    const fraction = d.total > 0 ? d.done / d.total : null;
    return (
      <>
        <h2>
          <FolderSync aria-hidden="true" /> {d.title}
        </h2>
        <p className="bp-dialog-lead">
          {d.current} ({d.step} of {d.steps})
        </p>
        <div className={`bp-dialog-progress${fraction === null ? " indeterminate" : ""}`}>
          <i style={{ width: `${(fraction ?? 0.3) * 100}%` }} />
        </div>
        <p className="bp-dialog-lead small">Please keep Big Quiver Launcher open until this finishes.</p>
      </>
    );
  }

  return (
    <>
      <h2>
        <FolderSync aria-hidden="true" /> {d.title}
      </h2>
      <ul className="bp-dialog-notes">
        {d.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {buttons}
    </>
  );
}

function Frame({ share, glyphs }: { share: Share; glyphs: boolean }) {
  return (
    <div className="bp-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Use the same games folder as Quiver 3">
      <section className="bp-dialog bp-share">
        <div className="bp-dialog-body">
          <Body share={share} glyphs={glyphs} />
        </div>
      </section>
    </div>
  );
}

/** In Big Picture: on top, with the controller. */
export function ShareDialogBp({ share }: { share: Share }) {
  useInputHandler({ onAction: (a) => press(share, a), hints: () => hintsFor(share) }, LAYER.dialog, Boolean(share.dialog));
  if (!share.dialog) return null;
  return <Frame share={share} glyphs />;
}

/** In desktop mode: an ordinary dialog. */
export function ShareDialogDesktop({ share }: { share: Share }) {
  if (!share.dialog) return null;
  return (
    <div className="bp-share-desktop">
      <Frame share={share} glyphs={false} />
    </div>
  );
}

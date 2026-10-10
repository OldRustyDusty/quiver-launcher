/** A game's page (Y). For now its art, name, versions and description; its buttons come in S11. */
import { useBp, useInputHandler } from "../context";
import { LAYER } from "../input/router";
import type { BpApp } from "../bridge";
import { versionLabel } from "../../versions";

/** `app` as it was opened; shown live from the library when it's in it (a game from Discover may not be). */
export function Details({ app: opened, onClose }: { app: BpApp; onClose: () => void }) {
  const { bridge } = useBp();
  const app = bridge.apps.find((a) => a.id === opened.id) ?? opened;
  useInputHandler(
    {
      onAction(action) {
        if (action === "back" || action === "details") onClose();
      },
      hints: () => [{ action: "back", label: "Back" }],
    },
    LAYER.overlay,
  );
  if (!app) return null;
  const hero = app.art.hero ?? app.art.capsule;
  return (
    <section className="bp-overlay bp-details" role="dialog" aria-label={app.title}>
      {hero && <img className="bp-details-hero" src={hero} alt="" />}
      <div className="bp-details-body">
        {app.art.logo ? <img className="bp-logo" src={app.art.logo} alt={app.title} /> : <h1 className="bp-title">{app.title}</h1>}
        <p className="bp-meta">
          <span>{app.gameTitle}</span>
          {app.installedVersion && <span>Installed {versionLabel(app.installedVersion)}</span>}
          {app.latestVersion && <span>Latest {versionLabel(app.latestVersion)}</span>}
        </p>
        <p className="bp-description">{app.entry.description}</p>
        {app.error && <p className="bp-error">{app.error}</p>}
      </div>
    </section>
  );
}

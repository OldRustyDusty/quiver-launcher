/** The focused game above the grid, and its hero art blurred behind everything (spec §8). */
import { useEffect, useState } from "react";
import type { BpApp } from "../bridge";
import { versionLabel } from "../../versions";

export function GameHeader({ app, consoleName }: { app: BpApp | null; consoleName: string }) {
  const [logoFailed, setLogoFailed] = useState<string | null>(null);
  if (!app) return <header className="bp-header" />;
  const logo = app.art.logo && logoFailed !== app.art.logo ? app.art.logo : null;
  const update = app.state === "updateAvailable" && app.installedVersion && app.latestVersion;
  return (
    <header className="bp-header">
      {logo ? <img className="bp-logo" src={logo} alt={app.title} onError={() => setLogoFailed(logo)} /> : <h1 className="bp-title">{app.title}</h1>}
      <p className="bp-meta">
        <span>{app.title}</span>
        {consoleName && <span>{consoleName}</span>}
        {update ? (
          <span className="bp-update">
            {versionLabel(app.installedVersion)} → {versionLabel(app.latestVersion)}
          </span>
        ) : app.installedVersion ? (
          <span>{versionLabel(app.installedVersion)}</span>
        ) : null}
      </p>
    </header>
  );
}

/** Crossfades (250 ms) from the last game's hero to this one's. */
export function Backdrop({ app }: { app: BpApp | null }) {
  const url = app ? (app.art.hero ?? app.art.capsule ?? null) : null;
  const [layers, setLayers] = useState<string[]>([]);
  useEffect(() => {
    if (!url) return;
    setLayers((l) => (l.at(-1) === url ? l : [...l.slice(-1), url]));
  }, [url]);
  return (
    <div className="bp-backdrop" aria-hidden="true">
      {layers.map((src) => (
        <img key={src} src={src} alt="" className={src === url ? "shown" : ""} decoding="async" />
      ))}
    </div>
  );
}

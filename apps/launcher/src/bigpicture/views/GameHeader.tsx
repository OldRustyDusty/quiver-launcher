/** The focused game: its logo (or name) and chips for its console, version and state; and its art behind everything. */
import { useEffect, useState } from "react";
import { ArrowUpCircle, Clock, Gamepad2, AlertTriangle } from "lucide-react";
import type { BpApp } from "../bridge";
import { versionLabel } from "../../versions";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
/** "Played today", "Played 3 days ago", "Played last month". */
export function playedLabel(at: number, now = Date.now()) {
  const days = Math.round((at - now) / 86_400_000);
  if (days > -1) return "Played today";
  if (days > -30) return `Played ${relative.format(days, "day")}`;
  const months = Math.round(days / 30);
  if (months > -12) return `Played ${relative.format(months, "month")}`;
  return `Played ${relative.format(Math.round(days / 365), "year")}`;
}

export function GameLogo({ app, className = "" }: { app: BpApp; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const logo = app.art.logo && failed !== app.art.logo ? app.art.logo : null;
  return logo ? (
    <img className={`bp-logo ${className}`} src={logo} alt={app.title} onError={() => setFailed(logo)} />
  ) : (
    <h1 className={`bp-title ${className}`}>{app.title}</h1>
  );
}

export function GameChips({ app, consoleName }: { app: BpApp; consoleName: string }) {
  return (
    <div className="bp-chips">
      {consoleName && (
        <span className="bp-chip">
          <Gamepad2 aria-hidden="true" />
          {consoleName}
        </span>
      )}
      {app.state === "updateAvailable" && app.installedVersion && app.latestVersion ? (
        <span className="bp-chip accent">
          <ArrowUpCircle aria-hidden="true" />
          {versionLabel(app.installedVersion)} → {versionLabel(app.latestVersion)}
        </span>
      ) : app.installedVersion ? (
        <span className="bp-chip">{versionLabel(app.installedVersion)}</span>
      ) : app.latestVersion ? (
        <span className="bp-chip">{versionLabel(app.latestVersion)}</span>
      ) : null}
      {app.state === "error" && (
        <span className="bp-chip danger">
          <AlertTriangle aria-hidden="true" />
          Download failed
        </span>
      )}
      {app.lastPlayed ? (
        <span className="bp-chip quiet">
          <Clock aria-hidden="true" />
          {playedLabel(app.lastPlayed)}
        </span>
      ) : null}
      {app.title !== app.gameTitle && <span className="bp-chip quiet">{app.gameTitle}</span>}
    </div>
  );
}

export function GameHeader({ app, consoleName }: { app: BpApp | null; consoleName: string }) {
  return (
    <header className="bp-header">
      {app && (
        <div className="bp-header-inner" key={app.id}>
          <GameLogo app={app} />
          <GameChips app={app} consoleName={consoleName} />
        </div>
      )}
    </header>
  );
}

/** The focused game's hero, blurred, crossfading (250 ms) from the last one. */
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

# CLAUDE.md — Quiver Launcher fork: Big Picture mode

You are working in Zack's personal fork of **Quiver Launcher** (`tgeorgiadis/quiver-launcher`, MIT, .NET 9 + Avalonia).
The fork adds a **controller-first, fullscreen "Big Picture" mode**. It has large 2:3 game tiles, console tabs,
and download/update/launch actions on the controller. The target is **Windows/Linux PC with an Xbox or PS5 (DualSense) controller**.

This file is the source of truth for scope and design decisions. If the code disagrees with an assumption here,
**stop and report it**. Don't quietly redesign around it.

---

## 0. Do this first: recon (read-only, no code changes)

Run these from the repo root and **write the answers into `docs/bigpicture/RECON.md`** before touching any code.
Several later design choices branch on these answers.

```bash
# 0.1 Avalonia version. 11.2+ gives XYFocus (used for dialogs/settings lists only)
rg -n 'PackageReference' QuiverLauncher.csproj lib/QuiverLauncher.Core/*.csproj
rg -n 'TargetFramework' --glob '*.csproj'

# 0.2 Project layout. Is Android a separate head project? (SDL must not break it)
fd -e csproj
fd -e sln

# 0.3 MVVM style. CommunityToolkit.Mvvm? ReactiveUI? hand-rolled INotifyPropertyChanged?
rg -n 'ObservableObject|ObservableProperty|RelayCommand|ReactiveObject|INotifyPropertyChanged' --type cs | head -40

# 0.4 Existing gamepad backend. SDL? XInput? Windows.Gaming.Input? Polling loop location?
rg -n -i 'gamepad|xinput|sdl|joystick|Windows\.Gaming\.Input|controller' --type cs | head -80

# 0.5 Where Download / Update / Launch / Change Version live (VM vs code-behind)
wc -l MainWindow.axaml.cs MainWindow.Mods.cs App.axaml.cs ViewModels/*.cs Services/*.cs
rg -n -i 'async.*(Download|Install|Update|Launch)\w*\(' --type cs | head -60

# 0.6 Per-app state model. Is there an enum/flags for installed / update available / downloading + progress?
rg -n -i 'enum\s+\w*(Status|State)' --type cs
rg -n -i 'progress' --type cs | head -40

# 0.7 Launch: does the launch path keep a Process handle / know when the game exits?
rg -n 'Process\.Start|ProcessStartInfo|WaitForExit|Exited' --type cs

# 0.8 Last-played tracking: does anything record launch time/count?
rg -n -i 'lastplayed|last_played|playcount|LastLaunch' --type cs

# 0.9 Catalog source per app: can we tell which catalog list (e.g. "N64 Recomps") an app came from?
rg -n -i 'remoteLocation|sourceId|CatalogSource|ListId' --type cs | head -40

# 0.10 Data directory resolution (where settings.json / apps.json live). Our sidecar goes beside them
rg -n -i 'settings\.json|apps\.json|XDG_DATA_HOME|Application Support' --type cs

# 0.11 Concurrency: can two downloads run at once? Is there a queue?
rg -n -i 'SemaphoreSlim|queue|Concurrent' --type cs | head -40

# 0.12 Baseline: build + fast tests must pass before any change
dotnet build QuiverLauncher.sln -c Debug
dotnet test QuiverLauncher.sln -c Release --filter "Category!=Slow"
```

`RECON.md` must answer, at minimum:

| # | Question | Why it matters |
|---|---|---|
| R1 | Avalonia version | XYFocus availability (≥ 11.2) |
| R2 | Android head project separate? | Whether the SDL package needs a TFM condition |
| R3 | MVVM library | Match it in all new VMs |
| R4 | Gamepad backend | Keep (SDL) or replace (XInput/WGI can't see DualSense natively) |
| R5 | Where action logic lives | Determines the Bridge design (§4) |
| R6 | Per-app state/progress model exists? | Reuse vs. derive `TileState` |
| R7 | Process handle on launch? | Game-session tracking (§11) |
| R8 | Last-played tracked? | Otherwise the sidecar owns it |
| R9 | App → catalog list traceable? | Console resolution fallback (§7) |
| R10 | Data dir resolver | Sidecar location |
| R11 | Download concurrency | Whether we add a serial queue |

---

## 1. Hard rules

1. **Separate fork, minimal upstream diff.** All fork code lives under `BigPicture/` (and `QuiverLauncher.Tests/BigPicture/`).
   Touching an upstream file is allowed only when unavoidable (startup hook, making a member accessible, exposing
   an event or Process handle). Log **every** touched upstream file and the reason in `docs/bigpicture/FORK_CHANGES.md`.
2. **Don't restructure upstream code.** If logic is stuck in code-behind, wrap it with an adapter (§4). Don't move it.
   Upstream releases often, and every refactor becomes a merge conflict.
3. **Don't change upstream data formats.** `apps.json`, `settings.json` and catalog list schemas stay byte-compatible.
   All fork state goes in the sidecar `bigpicture.json` (§6).
4. **Licenses: MIT / BSD / Apache-2.0 / zlib / CC0 / OFL only.** No GPL/LGPL code or assets. Before adding any
   dependency or asset pack, open its LICENSE file and record it in `docs/bigpicture/THIRD_PARTY.md`.
   Playnite (MIT, WPF) is a design reference. Port small pieces by hand with attribution only if needed.
5. **No embedded API keys.** SteamGridDB key is user-supplied, stored like Quiver stores its GitHub token.
6. **Desktop mode must keep working unchanged.** Upstream tests must stay green. Run the fast suite after every step.
7. **Android is out of scope but must still build.** Big Picture is only registered/offered when
   `OperatingSystem.IsWindows() || OperatingSystem.IsLinux()`.
8. **Every Big Picture screen must also work with a keyboard** (arrows/Enter/Esc/Tab/Q/E). This lets you develop and test it without a controller.
9. When unsure about scope, stop and ask. Don't invent features beyond this file.

---

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Platform target | PC (Windows first, Linux second), Xbox + DualSense controllers |
| Fork strategy | Separate fork, no upstreaming for now |
| Tile art | **Portrait 2:3** (600×900 source), matching Steam library grid |
| Library tabs | **Home**, **All**, one tab **per console that has ≥1 installed game**, then **Discover**, **Downloads** |
| Empty console | Tab is **hidden**. If the current tab becomes empty (last game uninstalled), move focus to **All** |
| What counts as "have a game" | **Installed** (incl. update-available/updating). Library entries not yet downloaded appear in **Discover**, not in console tabs |
| Update behavior | Setting `updateBehavior`: **`ask` (default)**, `off`, `auto` (§9) |
| Manual update | Always available: **X** on a tile, **Update all** on Home/Downloads |
| Controller input | SDL3 via `ppy.SDL3-CS` (pending R4 + license check) |
| Glyphs | Kenney Input Prompts (CC0), Xbox + PlayStation sets, auto-switched per controller |
| Mods UI in Big Picture | Not in v1. Details page offers "Manage mods in desktop mode" |
| Steam shortcut export | Not in v1 (later phase, ValveKeyValue) |

---

## 3. Architecture and folder layout

```
┌──────────────────────────────────────────────────────────────┐
│ BigPictureWindow (fullscreen)            MainWindow (upstream)│
├──────────────────────────────────────────────────────────────┤
│ BigPicture ViewModels: Shell, Tabs, Home, ConsoleGrid,        │
│ Discover, Downloads, Details, UpdatePrompt, OSK, Settings     │
├───────────────┬───────────────┬──────────────┬───────────────┤
│ Input         │ Navigation    │ Consoles     │ Art           │
│ SDL3 → action │ grid/shelf    │ resolver +   │ provider chain│
│ repeat, gate  │ focus model   │ tab builder  │ cache, decode │
├───────────────┴───────────────┴──────────────┴───────────────┤
│ Bridge (adapter over upstream)   Sidecar store   Session track│
├──────────────────────────────────────────────────────────────┤
│ Upstream Quiver: ViewModels, Services, QuiverLauncher.Core    │
└──────────────────────────────────────────────────────────────┘
```

```
BigPicture/
  BigPictureWindow.axaml(.cs)
  BigPictureBootstrap.cs          # DI/registration, --bigpicture flag handling, shell switching
  Bridge/
    IQuiverBridge.cs              # the ONLY way BigPicture touches upstream
    QuiverBridge.cs
  Input/
    InputAction.cs
    ControllerFamily.cs
    GamepadService.cs             # SDL thread: init, pump, hotplug, type detection
    KeyboardInputSource.cs        # Avalonia KeyDown → InputAction
    RepeatFilter.cs               # hold-to-repeat for d-pad / stick
    InputGate.cs                  # window active && no game in foreground
    InputRouter.cs                # dispatches actions to the top-most IInputHandler (dialog > view)
  Navigation/
    GridNavigator.cs              # console/All/Discover grids
    ShelfNavigator.cs             # Home shelves with per-row column memory
  Consoles/
    consoles.json                 # embedded resource
    ConsoleCatalog.cs
    ConsoleResolver.cs
    TabBuilder.cs
  Art/
    IArtProvider.cs
    ArtService.cs                 # chain + cache + decode-to-size
    OverrideArtProvider.cs
    CatalogArtProvider.cs         # optional gridUrl/heroUrl/logoUrl if ever present
    SteamGridDbClient.cs
    SteamGridDbArtProvider.cs
    FallbackTileRenderer.cs       # icon on gradient + title
  Data/
    SidecarModels.cs
    SidecarStore.cs
  Updates/
    UpdatePolicy.cs
  Launch/
    GameSessionTracker.cs
    ForegroundRestore.Windows.cs
  ViewModels/  (Shell, Tab, Home, ConsoleGrid, Discover, Downloads, Details, Tile, UpdatePrompt, Osk, ButtonHints, BpSettings)
  Views/       (one .axaml per VM above)
  Controls/
    GameTile.axaml(.cs)
    TabStrip.axaml(.cs)
    ButtonHintBar.axaml(.cs)
    OnScreenKeyboard.axaml(.cs)
  Assets/Glyphs/{xbox,playstation}/...
QuiverLauncher.Tests/BigPicture/...
docs/bigpicture/{RECON.md, FORK_CHANGES.md, THIRD_PARTY.md}
```

BigPicture lives **inside the main project** (it's simpler for Avalonia XAML compilation and access to upstream types), isolated by folder and namespace `QuiverLauncher.BigPicture.*`.

---

## 4. Bridge (adapter over upstream)

Every call from Big Picture into upstream goes through `IQuiverBridge`. If R5 says the logic lives in ViewModels,
the bridge is thin. If it lives in `MainWindow.axaml.cs`, the bridge calls the smallest possible extracted method.
Making a private method `internal`, or moving a method body into a service without changing its behavior, is the most you should do.
Log it in FORK_CHANGES.md.

```csharp
namespace QuiverLauncher.BigPicture.Bridge;

public interface IQuiverBridge
{
    IReadOnlyList<BridgeApp> GetLibrary();                  // apps.json entries + live state
    IReadOnlyList<BridgeCatalogApp> GetCatalogNotInLibrary();
    event EventHandler<BridgeAppChangedEventArgs> AppChanged; // state/progress/version changes
    event EventHandler LibraryChanged;                        // add/remove/install/uninstall

    Task AddToLibraryAsync(BridgeCatalogApp app, CancellationToken ct);
    Task DownloadAsync(string appKey, IProgress<double>? progress, CancellationToken ct);
    Task UpdateAsync(string appKey, IProgress<double>? progress, CancellationToken ct);
    Task<IReadOnlyList<BridgeRelease>> GetReleasesAsync(string appKey, CancellationToken ct);
    Task InstallVersionAsync(string appKey, string tag, CancellationToken ct);  // "Change Version"
    Task<BridgeLaunchResult> LaunchAsync(string appKey);       // must surface Process if available (R7)
    Task UninstallAsync(string appKey);
    Task CheckUpdatesAsync(CancellationToken ct);
    void OpenInstallFolder(string appKey);
}

public sealed record BridgeApp(
    string AppKey,              // "{repositorySource}:{repository}", e.g. "github:HarbourMasters/2ship2harkinian"
    string Name, string? Project, string? CustomDisplayName,
    IReadOnlyList<string> Tags, string? IconUrl, string? CatalogListName,
    BridgeAppState State, string? InstalledVersion, string? LatestVersion, double? Progress);

public enum BridgeAppState { NotInstalled, Downloading, Installed, UpdateAvailable, Updating, Error }
```

`AppKey` is the stable identity used everywhere in the fork (sidecar, art cache, focus memory).

**Asset ambiguity:** if upstream's asset selection can't pick a release file automatically, the bridge raises
`AssetChoiceRequired(appKey, candidates)`. Big Picture shows a controller picker and stores the choice
in the sidecar (`apps[key].assetPattern`) so it's never asked again.

---

## 5. Input

### 5.1 Semantic actions

```csharp
public enum InputAction
{
    Up, Down, Left, Right,
    Accept,      // A / Cross          (SOUTH)
    Back,        // B / Circle         (EAST)
    Secondary,   // X / Square         (WEST)
    Details,     // Y / Triangle       (NORTH)
    TabPrev, TabNext,       // LB / RB, L1 / R1
    PagePrev, PageNext,     // LT / RT, L2 / R2 (digital threshold)
    Search,      // View / Create      (BACK)
    Menu,        // Menu / Options     (START)
}
public enum ControllerFamily { Xbox, PlayStation, Generic }
```

Keyboard map: arrows → Up/Down/Left/Right, Enter → Accept, Esc/Backspace → Back, X → Secondary, Y → Details,
Q/E → TabPrev/TabNext, PageUp/PageDown → PagePrev/PageNext, `/` → Search, F10 → Menu.

**The Guide/PS button is never mapped** (Game Bar and Steam capture it).

### 5.2 Button map (canonical. Hint bar and docs must match)

| Context | A / ✕ | X / □ | Y / △ | B / ○ |
|---|---|---|---|---|
| Installed tile | Play (goes through update policy §9) | Update (if available) | Details | Back |
| Not-installed tile (Discover) | Add to library **and** download | — | Details | Back |
| Downloading tile | Open Downloads | Cancel (**hold** 1 s) | Details | Back |
| Error tile | Retry | — | Details (shows error) | Back |
| Home "Updates" shelf header | — | Update all | — | — |
| Dialogs | Confirm | per-dialog | per-dialog | Cancel |

Global: LB/RB switch tabs, LT/RT page jump (on All: jump to next letter), View/Create = search, Menu/Options = settings overlay.
Destructive actions (uninstall, cancel download) require **hold-to-confirm** with a fill animation on the glyph.

### 5.3 GamepadService (SDL3)

* Own a dedicated thread that does `SDL_Init`, the event pump and hotplug. Marshal actions with `Dispatcher.UIThread.Post`.
* Set `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS = "1"` before init. The window is Avalonia's, not SDL's, so SDL
  must not do its own focus filtering. **`InputGate` makes the decision instead.**
* DualSense works natively through SDL's HIDAPI driver (no Steam Input / DS4Windows required).
* Controller family: use `SDL_GetRealGamepadType` (so a Steam Input virtual pad wrapping a DualSense still shows
  PlayStation glyphs where possible). PS3/PS4/PS5 types map to PlayStation, Xbox360/XboxOne map to Xbox, everything else maps to Generic (Xbox glyphs).
* Glyph family follows the **last controller that sent input**.
* Multiple pads: any connected pad can navigate.

Sketch (verify exact binding signatures against `ppy.SDL3-CS`. Some APIs are pointer/unsafe-based):

```csharp
using static SDL.SDL3;
using SDL;

public sealed unsafe class GamepadService : IDisposable
{
    public event Action<InputAction, bool /*pressed*/>? Action;
    public event Action<ControllerFamily>? FamilyChanged;

    readonly Dictionary<SDL_JoystickID, nint> _pads = new();
    readonly Thread _thread;
    volatile bool _running = true;

    public GamepadService()
    {
        _thread = new Thread(Run) { IsBackground = true, Name = "BP-Gamepad" };
        _thread.Start();
    }

    void Run()
    {
        SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, "1");
        if (!SDL_Init(SDL_InitFlags.SDL_INIT_GAMEPAD)) { /* log SDL_GetError(); disable controller input */ return; }

        SDL_Event e;
        while (_running)
        {
            if (!SDL_WaitEventTimeout(&e, 16)) continue;
            switch ((SDL_EventType)e.type)
            {
                case SDL_EventType.SDL_EVENT_GAMEPAD_ADDED:
                    _pads[e.gdevice.which] = (nint)SDL_OpenGamepad(e.gdevice.which); break;
                case SDL_EventType.SDL_EVENT_GAMEPAD_REMOVED:
                    if (_pads.Remove(e.gdevice.which, out var p)) SDL_CloseGamepad((SDL_Gamepad*)p); break;
                case SDL_EventType.SDL_EVENT_GAMEPAD_BUTTON_DOWN:
                case SDL_EventType.SDL_EVENT_GAMEPAD_BUTTON_UP:
                    UpdateFamily(e.gbutton.which);
                    if (MapButton((SDL_GamepadButton)e.gbutton.button) is { } a)
                        Action?.Invoke(a, e.gbutton.down);
                    break;
                case SDL_EventType.SDL_EVENT_GAMEPAD_AXIS_MOTION:
                    HandleAxis(e.gaxis); // left stick → directions w/ hysteresis (press 0.55, release 0.35);
                    break;               // triggers → PagePrev/PageNext (press 0.6, release 0.3)
            }
        }
        foreach (var p in _pads.Values) SDL_CloseGamepad((SDL_Gamepad*)p);
        SDL_Quit();
    }

    static InputAction? MapButton(SDL_GamepadButton b) => b switch
    {
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_SOUTH => InputAction.Accept,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_EAST => InputAction.Back,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_WEST => InputAction.Secondary,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_NORTH => InputAction.Details,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_LEFT_SHOULDER => InputAction.TabPrev,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER => InputAction.TabNext,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_BACK => InputAction.Search,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_START => InputAction.Menu,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_DPAD_UP => InputAction.Up,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_DPAD_DOWN => InputAction.Down,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_DPAD_LEFT => InputAction.Left,
        SDL_GamepadButton.SDL_GAMEPAD_BUTTON_DPAD_RIGHT => InputAction.Right,
        _ => null
    };

    public void Dispose() { _running = false; _thread.Join(500); }
}
```

If R4 shows Quiver already uses SDL (2 or 3), reuse its device handling and add only what's missing (family
detection, background hint, action mapping) instead of running a second SDL instance.

### 5.4 RepeatFilter

Directional actions repeat while held. Initial delay is 380 ms, then repeats every 90 ms, speeding up to 45 ms after 1.5 s.
Non-directional actions never repeat. Hold-to-confirm uses press→release timing in the router, not repeats.

### 5.5 InputGate

```csharp
public sealed class InputGate
{
    public bool WindowActive { get; set; }     // BigPictureWindow.Activated / Deactivated
    public bool GameInForeground { get; set; } // GameSessionTracker
    public bool IsOpen => WindowActive && !GameInForeground;
}
```

Drop all actions while closed, and **clear held-button state on every transition**. Otherwise a button held
when the game exits will fire as a stuck repeat.

### 5.6 InputRouter

There is a stack of `IInputHandler`s: on-screen keyboard > dialogs > overlay > active view. Only the top handler gets actions.
Each handler exposes `IReadOnlyList<ButtonHint> Hints`, and the `ButtonHintBar` always renders the hints of the top handler.

---

## 6. Sidecar store (`bigpicture.json`)

This file lives in the same directory upstream resolves for `settings.json` (R10). Writes are atomic (temp file + rename) and debounced (500 ms).

```csharp
public sealed class BpSidecar
{
    public int Version { get; set; } = 1;
    public BpSettings Settings { get; set; } = new();
    public Dictionary<string, BpAppState> Apps { get; set; } = new(); // key = AppKey
}

public sealed class BpSettings
{
    public bool StartInBigPicture { get; set; }
    public bool OfferBigPictureOnControllerConnect { get; set; } = true;
    public UpdateBehavior UpdateBehavior { get; set; } = UpdateBehavior.Ask;
    public bool ShowHomeTab { get; set; } = true;
    public ConsoleTabOrder ConsoleTabOrder { get; set; } = ConsoleTabOrder.ManufacturerThenYear;
    public string? SteamGridDbApiKey { get; set; }
    public string? MonitorDeviceName { get; set; }
    public double UiScale { get; set; } = 1.0;            // multiplies the height-based auto scale
    public bool ReduceMotion { get; set; }
}
public enum UpdateBehavior { Ask, Off, Auto }
public enum ConsoleTabOrder { ManufacturerThenYear, GameCount, Alphabetical }

public sealed class BpAppState
{
    public string? ConsoleOverride { get; set; }          // console id from consoles.json
    public DateTimeOffset? LastPlayed { get; set; }
    public int PlayCount { get; set; }
    public DateTimeOffset? InstalledAt { get; set; }
    public string? SkippedVersion { get; set; }           // "Skip this version" in update prompt
    public string? AssetPattern { get; set; }             // remembered release-asset choice
    public BpArt Art { get; set; } = new();
}

public sealed class BpArt
{
    public string? GridOverride { get; set; }             // URL or local file path
    public string? HeroOverride { get; set; }
    public string? LogoOverride { get; set; }
    public int? SteamGridDbGameId { get; set; }           // pinned match (user-chosen or first good hit)
    public string? SearchTermOverride { get; set; }
}
```

If R8 shows upstream already tracks last-played, read from upstream and don't duplicate it.

---

## 7. Consoles

### 7.1 `consoles.json` (embedded resource)

Entries are ordered by manufacturer and then year. `aliases` are lowercase tag/list tokens that map to this console.

```json
{
  "manufacturerOrder": ["nintendo", "sega", "sony", "microsoft", "nec", "snk", "atari", "pc", "arcade"],
  "manufacturerTags": ["nintendo", "sega", "sony", "playstation-brand", "microsoft", "nec", "snk", "atari"],
  "consoles": [
    { "id": "nes",       "name": "NES",              "short": "NES",  "mfr": "nintendo", "year": 1983, "aliases": ["nes", "famicom"] },
    { "id": "snes",      "name": "Super Nintendo",   "short": "SNES", "mfr": "nintendo", "year": 1990, "aliases": ["snes", "super-nintendo", "super-famicom", "sfc"] },
    { "id": "n64",       "name": "Nintendo 64",      "short": "N64",  "mfr": "nintendo", "year": 1996, "aliases": ["n64", "nintendo-64", "nintendo64"] },
    { "id": "gc",        "name": "GameCube",         "short": "GC",   "mfr": "nintendo", "year": 2001, "aliases": ["gc", "gamecube", "ngc"] },
    { "id": "wii",       "name": "Wii",              "short": "Wii",  "mfr": "nintendo", "year": 2006, "aliases": ["wii"] },
    { "id": "wiiu",      "name": "Wii U",            "short": "Wii U","mfr": "nintendo", "year": 2012, "aliases": ["wiiu", "wii-u"] },
    { "id": "switch",    "name": "Switch",           "short": "Switch","mfr": "nintendo","year": 2017, "aliases": ["switch", "nx"] },
    { "id": "gb",        "name": "Game Boy",         "short": "GB",   "mfr": "nintendo", "year": 1989, "aliases": ["gb", "gameboy", "game-boy"] },
    { "id": "gbc",       "name": "Game Boy Color",   "short": "GBC",  "mfr": "nintendo", "year": 1998, "aliases": ["gbc", "gameboy-color"] },
    { "id": "gba",       "name": "Game Boy Advance", "short": "GBA",  "mfr": "nintendo", "year": 2001, "aliases": ["gba", "gameboy-advance"] },
    { "id": "nds",       "name": "Nintendo DS",      "short": "DS",   "mfr": "nintendo", "year": 2004, "aliases": ["nds", "ds"] },
    { "id": "3ds",       "name": "Nintendo 3DS",     "short": "3DS",  "mfr": "nintendo", "year": 2011, "aliases": ["3ds", "n3ds"] },
    { "id": "sms",       "name": "Master System",    "short": "SMS",  "mfr": "sega",     "year": 1986, "aliases": ["sms", "master-system"] },
    { "id": "genesis",   "name": "Genesis / Mega Drive", "short": "MD", "mfr": "sega",  "year": 1988, "aliases": ["genesis", "megadrive", "mega-drive", "md"] },
    { "id": "segacd",    "name": "Sega CD",          "short": "SCD",  "mfr": "sega",     "year": 1991, "aliases": ["segacd", "sega-cd", "mega-cd"] },
    { "id": "saturn",    "name": "Saturn",           "short": "SAT",  "mfr": "sega",     "year": 1994, "aliases": ["saturn"] },
    { "id": "dreamcast", "name": "Dreamcast",        "short": "DC",   "mfr": "sega",     "year": 1998, "aliases": ["dreamcast", "dc"] },
    { "id": "gamegear",  "name": "Game Gear",        "short": "GG",   "mfr": "sega",     "year": 1990, "aliases": ["gamegear", "game-gear", "gg"] },
    { "id": "ps1",       "name": "PlayStation",      "short": "PS1",  "mfr": "sony",     "year": 1994, "aliases": ["ps1", "psx", "playstation", "playstation-1"] },
    { "id": "ps2",       "name": "PlayStation 2",    "short": "PS2",  "mfr": "sony",     "year": 2000, "aliases": ["ps2", "playstation-2"] },
    { "id": "ps3",       "name": "PlayStation 3",    "short": "PS3",  "mfr": "sony",     "year": 2006, "aliases": ["ps3", "playstation-3"] },
    { "id": "psp",       "name": "PSP",              "short": "PSP",  "mfr": "sony",     "year": 2004, "aliases": ["psp"] },
    { "id": "vita",      "name": "PS Vita",          "short": "Vita", "mfr": "sony",     "year": 2011, "aliases": ["vita", "psvita", "ps-vita"] },
    { "id": "xbox",      "name": "Xbox",             "short": "Xbox", "mfr": "microsoft","year": 2001, "aliases": ["xbox", "og-xbox"] },
    { "id": "x360",      "name": "Xbox 360",         "short": "360",  "mfr": "microsoft","year": 2005, "aliases": ["xbox360", "xbox-360", "x360"] },
    { "id": "pce",       "name": "PC Engine / TG-16","short": "PCE",  "mfr": "nec",      "year": 1987, "aliases": ["pce", "pc-engine", "turbografx", "tg16"] },
    { "id": "neogeo",    "name": "Neo Geo",          "short": "NG",   "mfr": "snk",      "year": 1990, "aliases": ["neogeo", "neo-geo"] },
    { "id": "atari2600", "name": "Atari 2600",       "short": "2600", "mfr": "atari",    "year": 1977, "aliases": ["atari2600", "2600", "vcs"] },
    { "id": "pc",        "name": "PC (original)",    "short": "PC",   "mfr": "pc",       "year": 1981, "aliases": ["pc", "dos", "windows-original"] },
    { "id": "arcade",    "name": "Arcade",           "short": "Arcade","mfr": "arcade",  "year": 1970, "aliases": ["arcade"] }
  ],
  "special": [
    { "id": "apps",  "name": "Apps & Tools", "aliases": ["app", "tool", "tools", "utility", "emulator"] },
    { "id": "other", "name": "Other",        "aliases": [] }
  ]
}
```

**Before finalizing the alias lists**, sample the real tags and list names from the live community catalog
(`tgeorgiadis/quiver-community-app-catalog`, `community-app-catalog/*.json`) and add any tokens that are actually used.
Put the observed tag→console table in RECON.md.

### 7.2 Resolution order (first match wins)

1. `BpAppState.ConsoleOverride` (user-set in Details → "Console").
2. **Tags**: each tag is lowercased and normalized (`_`/space→`-`) and matched against console aliases.
   Tags in `manufacturerTags` are **ignored** ("nintendo" is a brand, not a console). If several consoles match,
   the first matching tag in the app's tag order wins.
3. **Catalog list name** (needs R9): tokenize the list name ("N64 Recomps" → `n64`, `recomps`) and match the tokens against aliases.
4. **Special**: any tag in `apps.aliases` → `apps`.
5. Otherwise → `other`.

`ConsoleResolver` is pure (no I/O) and fully unit-tested. Settings has an **"Unassigned games"** screen listing
everything resolved to `other` for quick reassignment with the controller.

### 7.3 Tab building

```csharp
public static IReadOnlyList<TabDescriptor> Build(
    IEnumerable<ResolvedApp> installed, ConsoleCatalog cat, BpSettings s, int downloadsActive)
{
    var tabs = new List<TabDescriptor>();
    if (s.ShowHomeTab) tabs.Add(TabDescriptor.Home);
    tabs.Add(TabDescriptor.All);

    var groups = installed.GroupBy(a => a.ConsoleId)
                          .Where(g => g.Any())                       // hidden when empty
                          .Select(g => (console: cat.Get(g.Key), count: g.Count()));

    groups = s.ConsoleTabOrder switch
    {
        ConsoleTabOrder.GameCount   => groups.OrderByDescending(x => x.count).ThenBy(x => x.console.Name),
        ConsoleTabOrder.Alphabetical=> groups.OrderBy(x => x.console.Name),
        _                           => groups.OrderBy(x => cat.ManufacturerRank(x.console))
                                             .ThenBy(x => x.console.Year),
    };
    // "other" and "apps" always sort last among console tabs
    tabs.AddRange(groups.OrderBy(x => x.console.IsSpecial)
                        .Select(x => TabDescriptor.Console(x.console, x.count)));

    tabs.Add(TabDescriptor.Discover);
    tabs.Add(TabDescriptor.Downloads(downloadsActive));
    return tabs;
}
```

Rebuild the tabs on `LibraryChanged`. Keep the selected tab by **id**. If it disappeared, select **All** and
keep the focus index clamped. Tab labels use `short` names when the strip would overflow, and full names otherwise.

---

## 8. Screens

Visual direction: dark, cinematic, 10-foot UI. The background is a blurred, darkened hero image of the focused game (crossfade 250 ms).
Use one accent color. Scale everything from window height, with **720p as the 1.0 baseline** × `UiScale`.

```
┌────────────────────────────────────────────────────────────────────┐
│ LB  Home  All  N64  GC  Dreamcast  PS1  Other  │ Discover  Downloads•2  RB  🔍 ⚙ │
├────────────────────────────────────────────────────────────────────┤
│  (blurred hero background of focused game)                         │
│  [LOGO or Title]   2 Ship 2 Harkinian · N64 · v1.1.2 → v1.2.0      │
│                                                                    │
│  ┏━━━━━┓ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐            │
│  ┃     ┃ │     │ │  ⬆  │ │     │ │ ▓▓░ │ │     │ │     │  2:3 tiles │
│  ┗━━━━━┛ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘            │
│  ┌─────┐ ┌─────┐ ┌─────┐ ...                                        │
├────────────────────────────────────────────────────────────────────┤
│                         Ⓐ Play  Ⓧ Update  Ⓨ Details  Ⓑ Back         │
└────────────────────────────────────────────────────────────────────┘
```

| Tab | Content | Navigation |
|---|---|---|
| **Home** | Shelves: *Recently played* (by `LastPlayed`), *Updates available* (header action: X = Update all), *Recently installed* | `ShelfNavigator` |
| **All** | Grid of all installed games, sorted A→Z (setting: recent / A→Z) | `GridNavigator`. LT/RT jump to next/prev letter |
| **Console** | Grid of installed games for that console | `GridNavigator`. LT/RT page |
| **Discover** | Grid of catalog apps **and** library-but-not-installed entries. Filter row at top: console chips + "In library / Not in library / All" | Up from first row focuses the filter row |
| **Downloads** | Queue list: active, queued, failed, completed this session. X on an item = cancel (hold) / retry | Vertical list (XYFocus OK) |
| **Details** (from Y) | Hero, logo, description, installed/latest version, buttons: Play, Update, Change version, Console, Change artwork, Open folder, Manage mods in desktop mode, Uninstall (hold) | XYFocus |
| **Settings overlay** (Menu) | Update behavior, start in Big Picture, Home tab on/off, console tab order, UI scale, reduce motion, SteamGridDB key (OSK), monitor, Unassigned games, Switch to desktop mode | XYFocus |

### 8.1 GameTile control

* Layers: art (or fallback), a gradient scrim at the bottom with the title (shown only when the art is the fallback or the tile is focused),
  a state badge in the top-right, and a progress bar along the bottom edge.
* Badges: ⬇ not installed, ⬆ update available, ⚠ error, spinner while queued.
* Focus: `scale(1.07)`, 3 px accent border plus outer glow, 120 ms `TransformOperationsTransition`.
  `ReduceMotion` disables scale and keeps the border.
* Focus is **VM-driven** (`TileViewModel.IsFocused` → `.focused` style class), not Avalonia keyboard focus.

```xml
<Border Classes="tile" Classes.focused="{Binding IsFocused}" CornerRadius="6" ClipToBounds="True">
  <Border.Transitions>
    <Transitions>
      <TransformOperationsTransition Property="RenderTransform" Duration="0:0:0.12" />
    </Transitions>
  </Border.Transitions>
  <!-- art / fallback / scrim / badge / progress -->
</Border>
<!-- Styles: Border.tile { RenderTransform: scale(1) }  Border.tile.focused { RenderTransform: scale(1.07); BorderBrush: {DynamicResource BpAccent} } -->
```

### 8.2 Navigators (pure, unit-tested)

```csharp
public sealed class GridNavigator
{
    public int Count { get; private set; }
    public int Columns { get; private set; }     // recomputed from viewport width / tile width
    public int Index { get; private set; }

    public void Reset(int count, int columns, int keepIndex = 0)
        => (Count, Columns, Index) = (count, Math.Max(1, columns), Math.Clamp(keepIndex, 0, Math.Max(0, count - 1)));

    public NavResult Move(InputAction a)
    {
        if (Count == 0) return NavResult.Edge(a);
        int i = Index;
        switch (a)
        {
            case InputAction.Left  when i % Columns > 0:          i--; break;
            case InputAction.Right when i % Columns < Columns - 1 && i + 1 < Count: i++; break;
            case InputAction.Up    when i - Columns >= 0:         i -= Columns; break;
            case InputAction.Down  when i + Columns < Count:      i += Columns; break;
            case InputAction.Down  when i / Columns < (Count - 1) / Columns: i = Count - 1; break; // partial last row
            default: return NavResult.Edge(a);    // caller decides (e.g. Up at top → filter row / tab strip)
        }
        Index = i; return NavResult.Moved(i);
    }
}
```

`ShelfNavigator` keeps `(row, col)` plus a `rememberedCol[row]`. Moving Up/Down restores the remembered
column, clamped to that row's length. Left at column 0 is an edge, and nothing wraps.

Each tab keeps its own navigator state in memory, so switching tabs and coming back returns to the same tile.
After a move, the view smooth-scrolls the focused tile into view, keeping it at least one tile away from the viewport edge.

### 8.3 On-screen keyboard

Grid layout: QWERTY + digits + `- _ . : / @`. Controls:
* A types the focused key, X = backspace, Y = space, LB/RB move the caret, Menu = submit, B = cancel.
* Used for search (results filter live in the current tab) and for the SteamGridDB key.
* The GitHub token stays a desktop-mode setting. The settings row says so.

---

## 9. Update behavior

```csharp
public sealed class UpdatePolicy(IQuiverBridge bridge, SidecarStore store, IDialogService dialogs)
{
    public async Task PlayAsync(BridgeApp app)
    {
        var s = store.Data.Settings;
        bool updatable = app.State == BridgeAppState.UpdateAvailable
                         && store.App(app.AppKey).SkippedVersion != app.LatestVersion;

        if (!updatable || s.UpdateBehavior == UpdateBehavior.Off) { await LaunchAsync(app); return; }

        if (s.UpdateBehavior == UpdateBehavior.Auto) { await UpdateThenLaunchAsync(app); return; }

        // Ask (default)
        var choice = await dialogs.UpdatePromptAsync(app);  // see table below
        switch (choice)
        {
            case UpdateChoice.UpdateAndPlay: await UpdateThenLaunchAsync(app); break;
            case UpdateChoice.PlayNow:       await LaunchAsync(app); break;
            case UpdateChoice.SkipVersion:   store.App(app.AppKey).SkippedVersion = app.LatestVersion; await LaunchAsync(app); break;
            case UpdateChoice.Cancel:        break;
        }
    }
    // UpdateThenLaunchAsync: shows progress overlay (B cancels → back to grid). On failure: dialog
    // "Update failed: {msg}" with A = Play current version, B = Back.
}
```

Update prompt dialog:

| Button | Action |
|---|---|
| A / ✕ | Update & play |
| X / □ | Play without updating |
| Y / △ | Skip this version (no prompt again until a newer version appears; the badge stays) |
| B / ○ | Cancel |

The prompt shows the version delta (`v1.1.2 → v1.2.0`) and the first ~6 lines of release notes if the bridge can supply them.
A manual update with X on a tile **ignores** `SkippedVersion` and `UpdateBehavior`.

---

## 10. Artwork

Tiles use **2:3 grid art (600×900)**. Details and the background use **hero art** (1920×620) and an optional **logo**.

Provider chain, first hit wins, run separately for grid, hero and logo:

1. `OverrideArtProvider`: sidecar `Art.*Override`.
2. `CatalogArtProvider`: reads `gridUrl` / `heroUrl` / `logoUrl` if a catalog entry ever carries them (future-proofing; upstream ignores unknown fields).
3. `SteamGridDbArtProvider`: only if the user has set a key.
4. Fallback:
   * grid: `FallbackTileRenderer` draws the app icon centered on a vertical gradient taken from the icon's two dominant colors, with the title in the bottom third. Render it once at 600×900 and cache it.
   * hero: the grid art blurred and stretched.
   * logo: none (show the title text).

SteamGridDB client (verify endpoints against current API docs before coding):

```
Base:   https://www.steamgriddb.com/api/v2
Auth:   Authorization: Bearer {key}
Search: GET /search/autocomplete/{urlencoded term}                  → data[].id, name
Grid:   GET /grids/game/{id}?dimensions=600x900&types=static&nsfw=false&humor=false
Hero:   GET /heroes/game/{id}?types=static&nsfw=false&humor=false
Logo:   GET /logos/game/{id}?types=static&nsfw=false&humor=false
```

* Search term: `SearchTermOverride ?? Name` (the canonical game name, not the project name).
* The first match is accepted automatically and its id stored in `SteamGridDbGameId`. Details → **Change artwork**
  lists the top 5 search results, then a carousel of grids/heroes for the chosen game. The pick is stored as an override URL.
* Pick the highest-scored static image (respect the API's ordering).
* Rate-limit to 4 concurrent requests and back off on 429. Cache failures for 24 h so missing games aren't re-queried.

Cache layout: `{dataDir}/Cache/bigpicture-art/{sha1(appKey)}/{grid|hero|logo}.{ext}` plus a `meta.json` (source URL, fetched-at).
Decode tiles with `Bitmap.DecodeToWidth(stream, tilePixelWidth)` on a background thread, and decode heroes at viewport width.
Keep an LRU of decoded bitmaps (around 150 tiles) and dispose evicted ones.

---

## 11. Window and game-session lifecycle

* `--bigpicture` CLI flag (handled in `Program.cs` → `BigPictureBootstrap`; log this upstream touch). The
  `StartInBigPicture` setting does the same thing. The desktop window gets a "Big Picture" button, and the Big Picture settings get "Switch to desktop".
  Only one shell is visible at a time, and both share the same upstream services instance.
* Borderless fullscreen on `MonitorDeviceName` (default: the monitor the desktop window is on).
* When a controller connects while in desktop mode and `OfferBigPictureOnControllerConnect` is on, show a non-modal toast:
  "Controller connected. Press Ⓐ for Big Picture".

**GameSessionTracker** (needs R7):

1. On launch: set `LastPlayed`, `PlayCount++`, and `InputGate.GameInForeground = true`.
2. Track exit:
   * If the bridge gives a `Process`, wait for it to exit.
   * **Launcher stubs:** if the process exits within 10 s, switch to **install-folder tracking**. Every 2 s, poll for any running
     process whose main module path is under the app's install dir. The session ends when none remain.
     Wrap `MainModule` access in try/catch, because access is denied for some processes.
3. On exit: set `GameInForeground = false`, clear held-input state, and **restore foreground**.

**ForegroundRestore.Windows.cs** (`[SupportedOSPlatform("windows")]`). Try these in order, and stop when `GetForegroundWindow()` equals our window:
1. `SetForegroundWindow(hwnd)`.
2. `AttachThreadInput` to the current foreground thread, then `BringWindowToTop`, `SetForegroundWindow`, and detach.
3. Minimize and restore the window.

Before writing this, read how Playnite restores focus after a game exits (reference only, MIT) and note what you
adopted in THIRD_PARTY.md. On Linux this is a no-op for now.

While a game is running, Big Picture also pauses background art fetching and hero animations.

---

## 12. Third-party components

| Component | Use | License (verify, record in THIRD_PARTY.md) |
|---|---|---|
| `ppy.SDL3-CS` (NuGet) | Gamepad input | MIT (bindings), SDL3 itself zlib |
| Kenney Input Prompts | Xbox / PlayStation glyphs | CC0 |
| Playnite (JosefNemec/Playnite) | Design reference: fullscreen layout, focus restore | MIT (reference only) |
| SteamGridDB API | Art (user key) | API terms. Images are user-submitted; fetched per user, never redistributed |
| A UI font (e.g. Inter) | Typography | OFL |

If R2 shows Android shares the main csproj, put the SDL package reference under a condition
so the Android TFM excludes it, and guard `GamepadService` registration with `OperatingSystem.IsWindows() || OperatingSystem.IsLinux()`.

---

## 13. Build order (each step builds, passes tests, and is committed separately)

Keep a local upstream remote and merge regularly:

```bash
git remote add upstream https://github.com/tgeorgiadis/quiver-launcher.git   # once
git fetch upstream && git merge upstream/main                                 # before each step
dotnet build QuiverLauncher.sln -c Debug
dotnet test QuiverLauncher.sln -c Release --filter "Category!=Slow"
```

| Step | Deliverable | Done when |
|---|---|---|
| **S0** | Recon → `RECON.md`, `FORK_CHANGES.md`, `THIRD_PARTY.md` created | All R1–R11 answered. Baseline build/tests green |
| **S1** | `IQuiverBridge` + `QuiverBridge` + bridge tests (headless) | Library list, state changes and progress events observed from the bridge, with no UI |
| **S2** | `SidecarStore` + `ConsoleCatalog` + `ConsoleResolver` + `TabBuilder` (pure) + tests | Resolver tests cover tags, manufacturer-tag exclusion, list-name fallback, override, `apps`, `other`. Tabs hide empty consoles |
| **S3** | Input: `InputAction`, keyboard source, `RepeatFilter`, `InputGate`, `InputRouter` + tests | Router/repeat/gate unit tests pass |
| **S4** | `BigPictureWindow` + `--bigpicture` + All tab using `GridNavigator`, tiles with **icon/fallback art only**, hint bar, keyboard input | Can browse All with the keyboard, A launches, Y opens a stub Details |
| **S5** | `GamepadService` (SDL3) + family detection + glyph switching | Xbox and DualSense (USB + Bluetooth) both navigate on Windows with **Steam closed**. Glyphs switch on input |
| **S6** | Console tabs + Home shelves (`ShelfNavigator`) + tab memory | Tabs appear/disappear as games install/uninstall. Focus memory per tab works |
| **S7** | `UpdatePolicy` + update prompt + X update + Update all | Ask/Off/Auto behave per §9. Skip-version persists |
| **S8** | Discover (add + download in one press, filter row) + Downloads tab + asset picker | A new port can be found, downloaded and launched without touching mouse/keyboard |
| **S9** | Art service: SteamGridDB, cache, decode-to-size, Change artwork, fallback renderer polish | 2:3 art on matched games. Scrolling stays smooth with 200+ tiles |
| **S10** | `GameSessionTracker` + Windows foreground restore + input gating while in game | Pressing buttons in-game never triggers Quiver. After exit, Quiver is foreground and controllable |
| **S11** | Details page complete, settings overlay, OSK + search, Unassigned games, controller-connect toast | Every setting in §6 is reachable by controller |
| **S12** | Polish: transitions, ReduceMotion, UI scale at 720p/1080p/1440p/4K, empty states, error states | Manual test checklist (§14) passes |

---

## 14. Test plan

**Unit (headless, `QuiverLauncher.Tests/BigPicture/`):**
* `ConsoleResolverTests`: precedence order, normalization, manufacturer tags ignored, multi-match order, list-name fallback.
* `TabBuilderTests`: Home toggle, empty consoles hidden, ordering modes, special tabs last, current-tab-removed → All.
* `GridNavigatorTests` / `ShelfNavigatorTests`: edges, partial last row, column memory, resize (column change keeps index).
* `RepeatFilterTests`: timing with a fake clock.
* `InputGateTests`: drops while closed, clears held state on transitions.
* `UpdatePolicyTests`: Ask/Off/Auto × skipped version × manual update.
* `SidecarStoreTests`: round-trip, atomic write, unknown fields preserved, version field.
* `SteamGridDbClientTests`: against recorded JSON fixtures (no live calls in CI).

**Manual checklist (Windows, 1080p TV and 1440p monitor):**
- [ ] Xbox Series pad (USB, Bluetooth) and DualSense (USB, Bluetooth) navigate. Glyphs match the pad that last sent input
- [ ] DualSense works with Steam closed and with Steam open (Steam Input enabled for desktop)
- [ ] Hot-plug while in Big Picture. Two pads at once
- [ ] Install a game for a new console → tab appears. Uninstall its last game → tab disappears, focus lands on All
- [ ] Update prompt: each of the 4 choices. Auto mode. Off mode. Failure path
- [ ] Discover → A → downloads → appears in its console tab → plays
- [ ] Holding A in-game does nothing in Quiver. After the game exits, Quiver is foreground and A works within 1 s
- [ ] Launcher-stub game (exits immediately, spawns child) is still tracked until the child exits
- [ ] 200+ tiles: no visible hitching when holding Right/Down
- [ ] Keyboard-only full pass

---

## 15. Explicitly out of scope (v1)

Android/Steam Deck tuning, mod browsing in Big Picture, Steam shortcut export, theming/skins, achievements/playtime
stats beyond `LastPlayed`/`PlayCount`, multi-console membership per game, cloud sync of the sidecar. Raise these as
follow-ups; don't build them.

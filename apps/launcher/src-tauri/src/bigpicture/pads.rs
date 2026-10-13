//! Big Picture's controllers, read with SDL3 while Big Picture is open (spec §5.3).
//!
//! Upstream reads controllers with gilrs, whose Windows backend
//! (Windows.Gaming.Input) stops delivering input once the window loses focus
//! and doesn't start again. SDL reads Xbox pads and DualSense (USB and
//! Bluetooth, through its HIDAPI driver) whatever has focus; Big Picture's own
//! gate decides when input counts. Presses go out as "bp-pad" events named as
//! gilrs names them ("South", "DPadUp", "LeftTrigger" for LB, "LeftTrigger2"
//! for LT…), with the pad's family for the glyphs; "bp-pads" lists the pads.
//!
//! Holding Start + Select on one pad for a second closes the game being played
//! (session.rs), for games with no way to quit. The reader watches for it
//! itself: the page may be held back while the game is in front.
use sdl3_sys::events::*;
use sdl3_sys::gamepad::*;
use sdl3_sys::hints::*;
use sdl3_sys::init::*;
use std::collections::{HashMap, HashSet};
use std::ffi::CStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct Press {
    key: &'static str,
    down: bool,
    /// "xbox", "playstation" or "generic": whose glyphs to show.
    family: &'static str,
    /// SDL's instance id: two pads holding the same direction are two sources.
    pad: u32,
}

/// The reader thread, while Big Picture is open.
#[derive(Default)]
pub struct Pads {
    running: Mutex<Option<(Arc<AtomicBool>, JoinHandle<()>)>>,
}

impl Pads {
    pub fn start(&self, app: AppHandle) {
        let mut running = self.running.lock().unwrap();
        if running.as_ref().is_some_and(|(_, thread)| !thread.is_finished()) {
            return;
        }
        let on = Arc::new(AtomicBool::new(true));
        let flag = on.clone();
        let thread = std::thread::Builder::new()
            .name("bp-pads".into())
            .spawn(move || read(app, flag))
            .expect("couldn't start the controller thread");
        *running = Some((on, thread));
    }

    pub fn stop(&self) {
        if let Some((on, thread)) = self.running.lock().unwrap().take() {
            on.store(false, Ordering::Relaxed);
            let _ = thread.join();
        }
    }
}

/// PS3/PS4/PS5 pads get PlayStation glyphs, Xbox pads Xbox's, everything else the Xbox ones too ("generic").
/// The real type: a DualSense behind Steam Input's virtual pad still says PS5 where SDL can tell.
fn family_of(kind: SDL_GamepadType) -> &'static str {
    if kind == SDL_GAMEPAD_TYPE_PS3 || kind == SDL_GAMEPAD_TYPE_PS4 || kind == SDL_GAMEPAD_TYPE_PS5 {
        "playstation"
    } else if kind == SDL_GAMEPAD_TYPE_XBOX360 || kind == SDL_GAMEPAD_TYPE_XBOXONE {
        "xbox"
    } else {
        "generic"
    }
}

/// gilrs's names, so Big Picture maps both the same way. Guide (PS) is left out: Game Bar and Steam use it.
fn button_key(button: u8) -> Option<&'static str> {
    let b = SDL_GamepadButton(button as i32);
    Some(match b {
        _ if b == SDL_GAMEPAD_BUTTON_SOUTH => "South",
        _ if b == SDL_GAMEPAD_BUTTON_EAST => "East",
        _ if b == SDL_GAMEPAD_BUTTON_WEST => "West",
        _ if b == SDL_GAMEPAD_BUTTON_NORTH => "North",
        _ if b == SDL_GAMEPAD_BUTTON_LEFT_SHOULDER => "LeftTrigger",
        _ if b == SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER => "RightTrigger",
        _ if b == SDL_GAMEPAD_BUTTON_BACK => "Select",
        _ if b == SDL_GAMEPAD_BUTTON_START => "Start",
        _ if b == SDL_GAMEPAD_BUTTON_DPAD_UP => "DPadUp",
        _ if b == SDL_GAMEPAD_BUTTON_DPAD_DOWN => "DPadDown",
        _ if b == SDL_GAMEPAD_BUTTON_DPAD_LEFT => "DPadLeft",
        _ if b == SDL_GAMEPAD_BUTTON_DPAD_RIGHT => "DPadRight",
        _ => return None,
    })
}

/// A stick or trigger past its press point is down until it falls back past its release point (spec §5.3).
fn past(value: f32, was_down: bool, press: f32, release: f32) -> bool {
    if was_down {
        value > release
    } else {
        value > press
    }
}

/// The controls an axis drives: (key, which side), with their press and release points.
fn axis_keys(axis: u8) -> &'static [(&'static str, f32, f32, f32)] {
    // (key, sign, press, release); SDL's Y axis is positive downwards.
    let a = SDL_GamepadAxis(axis as i32);
    if a == SDL_GAMEPAD_AXIS_LEFTX {
        &[("LeftStickLeft", -1.0, 0.55, 0.35), ("LeftStickRight", 1.0, 0.55, 0.35)]
    } else if a == SDL_GAMEPAD_AXIS_LEFTY {
        &[("LeftStickUp", -1.0, 0.55, 0.35), ("LeftStickDown", 1.0, 0.55, 0.35)]
    } else if a == SDL_GAMEPAD_AXIS_LEFT_TRIGGER {
        &[("LeftTrigger2", 1.0, 0.6, 0.3)]
    } else if a == SDL_GAMEPAD_AXIS_RIGHT_TRIGGER {
        &[("RightTrigger2", 1.0, 0.6, 0.3)]
    } else {
        &[]
    }
}

/// How long Start + Select are held to close the game.
const CLOSE_HOLD: Duration = Duration::from_secs(1);

/// Whether one pad holds both Start and Select.
fn holds_close_combo(held: &HashSet<(u32, &'static str)>) -> bool {
    held.iter().any(|&(pad, key)| key == "Start" && held.contains(&(pad, "Select")))
}

fn read(app: AppHandle, on: Arc<AtomicBool>) {
    // SAFETY: every SDL call is on this one thread, between SDL_Init and SDL_Quit, and
    // the gamepads opened here are closed here.
    unsafe {
        // The window is Tauri's, not SDL's: SDL mustn't drop input when it's behind. Big Picture's gate decides.
        SDL_SetHint(SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS, c"1".as_ptr());
        if !SDL_Init(SDL_INIT_GAMEPAD) {
            let error = CStr::from_ptr(sdl3_sys::error::SDL_GetError()).to_string_lossy().into_owned();
            let _ = app.emit("bp-pads-error", format!("Controllers are unavailable: {error}"));
            return;
        }
        let mut pads: HashMap<u32, (*mut SDL_Gamepad, &'static str, String)> = HashMap::new();
        let mut held: HashSet<(u32, &'static str)> = HashSet::new();
        let publish = |pads: &HashMap<u32, (*mut SDL_Gamepad, &'static str, String)>| {
            let list: Vec<String> = pads.values().map(|(_, _, name)| name.clone()).collect();
            let _ = app.emit("bp-pads", list);
        };
        let send = |held: &mut HashSet<(u32, &'static str)>, pad: u32, key: &'static str, down: bool, family: &'static str| {
            // Only changes: a stick resting past its point isn't a new press.
            if (down && held.insert((pad, key))) || (!down && held.remove(&(pad, key))) {
                let _ = app.emit("bp-pad", Press { key, down, family, pad });
            }
        };

        let mut event: SDL_Event = std::mem::zeroed();
        // Since when Start + Select have been held, and whether that hold has closed a game already.
        let mut combo: Option<(Instant, bool)> = None;
        while on.load(Ordering::Relaxed) {
            let got = SDL_WaitEventTimeout(&mut event, 50);
            if !holds_close_combo(&held) {
                combo = None;
            } else if let Some((since, done)) = combo.as_mut() {
                if !*done && since.elapsed() >= CLOSE_HOLD && super::session::CLOSE_COMBO.load(Ordering::Relaxed) && super::session::close_game() {
                    *done = true;
                }
            } else {
                combo = Some((Instant::now(), false));
            }
            if !got {
                continue;
            }
            let kind = event.r#type;
            if kind == SDL_EVENT_GAMEPAD_ADDED.0 {
                let id = event.gdevice.which;
                let pad = SDL_OpenGamepad(id);
                if !pad.is_null() {
                    let name = SDL_GetGamepadName(pad);
                    let name = if name.is_null() { "Controller".into() } else { CStr::from_ptr(name).to_string_lossy().into_owned() };
                    pads.insert(id.0, (pad, family_of(SDL_GetRealGamepadType(pad)), name));
                    publish(&pads);
                }
            } else if kind == SDL_EVENT_GAMEPAD_REMOVED.0 {
                let id = event.gdevice.which.0;
                if let Some((pad, family, _)) = pads.remove(&id) {
                    // Let go of whatever it held, so nothing stays pressed.
                    for (p, key) in held.clone() {
                        if p == id {
                            send(&mut held, id, key, false, family);
                        }
                    }
                    SDL_CloseGamepad(pad);
                    publish(&pads);
                }
            } else if kind == SDL_EVENT_GAMEPAD_BUTTON_DOWN.0 || kind == SDL_EVENT_GAMEPAD_BUTTON_UP.0 {
                let b = event.gbutton;
                if let (Some(key), Some((_, family, _))) = (button_key(b.button), pads.get(&b.which.0)) {
                    send(&mut held, b.which.0, key, b.down, family);
                }
            } else if kind == SDL_EVENT_GAMEPAD_AXIS_MOTION.0 {
                let a = event.gaxis;
                let Some((_, family, _)) = pads.get(&a.which.0) else { continue };
                let family = *family;
                let value = a.value as f32 / 32767.0;
                for &(key, sign, press, release) in axis_keys(a.axis) {
                    let down = past(value * sign, held.contains(&(a.which.0, key)), press, release);
                    send(&mut held, a.which.0, key, down, family);
                }
            }
        }
        for (pad, _, _) in pads.into_values() {
            SDL_CloseGamepad(pad);
        }
        SDL_Quit();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sticks_and_triggers_press_and_release_at_different_points() {
        assert!(!past(0.5, false, 0.55, 0.35));
        assert!(past(0.6, false, 0.55, 0.35));
        assert!(past(0.4, true, 0.55, 0.35), "held until it falls back past the release point");
        assert!(!past(0.3, true, 0.55, 0.35));
    }

    #[test]
    fn the_close_combo_is_start_and_select_on_one_pad() {
        let held = |keys: &[(u32, &'static str)]| keys.iter().copied().collect::<HashSet<_>>();
        assert!(holds_close_combo(&held(&[(1, "Start"), (1, "Select"), (1, "South")])));
        assert!(!holds_close_combo(&held(&[(1, "Start"), (2, "Select")])));
        assert!(!holds_close_combo(&held(&[(1, "Start")])));
    }

    #[test]
    fn maps_buttons_as_gilrs_names_them_and_leaves_out_guide() {
        assert_eq!(button_key(SDL_GAMEPAD_BUTTON_SOUTH.0 as u8), Some("South"));
        assert_eq!(button_key(SDL_GAMEPAD_BUTTON_LEFT_SHOULDER.0 as u8), Some("LeftTrigger"));
        assert_eq!(button_key(SDL_GAMEPAD_BUTTON_GUIDE.0 as u8), None);
    }

    #[test]
    fn picks_glyphs_by_the_real_pad_type() {
        assert_eq!(family_of(SDL_GAMEPAD_TYPE_PS5), "playstation");
        assert_eq!(family_of(SDL_GAMEPAD_TYPE_XBOXONE), "xbox");
        assert_eq!(family_of(SDL_GAMEPAD_TYPE_NINTENDO_SWITCH_PRO), "generic");
    }
}

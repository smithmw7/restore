# Restore

A first VR app built with a web stack. Restore uses Three.js, WebXR, Rapier physics, and [three-pinata](https://github.com/dgreenheck/three-pinata) to turn a room of objects into a destruction playground.

## Play on your Quest over USB

You need Node.js 20.19+ or 22.12+, Android SDK Platform Tools (`adb`), and a Quest with Developer Mode enabled. Connect a USB data cable and accept **Allow USB debugging** inside the headset if prompted.

From this folder:

```sh
npm install
npm run quest
```

The launcher builds Restore, serves the production build on port **5207**, forwards that port over USB, and opens `http://127.0.0.1:5207` in Meta Quest Browser. Put on your headset and choose **Enter VR**. Accept the browser's VR and hand tracking permission prompts if shown.

Keep the terminal and USB connection open while playing. This runs locally from your computer. The project has not been packaged as an APK or submitted to a store.

To reopen an existing build without rebuilding:

```sh
npm run quest -- --no-build
```

The launcher checks the page title and app identity before reusing an existing server. It never stops an unrelated process. If another app occupies port 5207, stop that server yourself before launching Restore.

## Controls

- **Break:** Point and tap the trigger or pinch. You can also touch an intact object with a controller tip or fingertip.
- **Gather:** Hold the trigger or pinch on any broken piece. Move it near matching pieces to pull them together. The green rings show the magnetic range. For distant hand grabs, pull your pinched hand toward you to bring the piece closer, or push it away to extend your reach. Controller thumbstick forward/back adjusts the held ray distance.
- **Drop:** Let go. Joined pieces stay joined, and you can pick up any part to continue.
- **Place:** Once the object is whole, carry it near its original pedestal. Release when the label says **Release to place** to ease it home.
- **Reset:** Use the scene's Restore All button, or either controller grip while your hands are free.
- **Leave VR:** Use the headset's system menu or the browser's exit VR control.

On desktop, click intact objects to break them. Hold and drag a shard to gather; scroll while holding to adjust depth. Drag empty space to orbit, Space or R resets the room, and F toggles fullscreen. Hand tracking must be enabled on the headset for pinch controls.

## Development and troubleshooting

Breaking uses 12 recordings copied from your Ultimate SFX Bundle, with two variants per material: glass, concrete, rock, wood, light metal, and heavy metal. The sounds are predecoded before play, alternate to avoid identical repeated hits, and come from the object's position in VR. The Sound button mutes current sounds as well as new ones.

The 12 breaking clips use a shared **-22.39 LUFS** normalization target, measured within 0.06 LU, with true peaks at or below **-2.10 dBTP**. Fixed gain preserves their transients. Leading silence is trimmed to less than 3.3 ms; all 12 mono 48 kHz WAVs total about 948 KB. Your original library files are unchanged. Exact sources and measurements are in [the audio report](docs/audio-normalization.json).

Repair adds 18 normalized recordings from your library: Armor On pickup cues, Heavy Kicks for releases, two crossfaded stone-dragging loops, and material-specific footsteps for contacts and magnetic snaps. Pickup clips sit around -22.39 LUFS, drops -22.8, contact clips -26.8, and the drag textures -35. The maximum measured true peak is -2.10 dBTP. The loop follows movement at a maximum 12% gain, fades on release, and stops within 15 ms of completion. Idle holds are silent. [The repair audio report](docs/repair-audio-normalization.json) records sources, hashes, gains, and measurements. Source recordings are untouched.

Run `npm run audio:prepare-repair` to reproduce the repair sounds. `npm run test:repair` checks gathering, partial assembly, release, docking, collision events, and cleanup without a browser. `npm run test:repair-browser` exercises the complete loop with real desktop pointer input against the running preview. Set `RESTORE_URL` to test another owned preview port.

Run `npm run audio:prepare` to reproduce the assets with FFmpeg, or `npm run test:audio` against the running preview to verify decoding, material routing, variation, and muting.

```sh
npm run dev       # Local development with live updates
npm run build     # Generate dist/
npm run preview   # Preview dist/ on port 5207
npm run test:smoke # With the server running; uses installed Google Chrome
```

Run one server at a time on this port. `npm run quest` can reuse a verified Restore development or preview server; that server remains owned by its original terminal. Close it first when you want the launcher to serve the new production build itself.

If ADB is missing, install [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools). The launcher searches your `PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and `~/Library/Android/sdk/platform-tools/adb`. You can set `ADB_PATH` to a different executable location.

If the device is **unauthorized**, put on the headset and approve USB debugging. If it is **offline**, wake the headset and reconnect USB. If more than one authorized Android device is connected, select the headset explicitly:

```sh
ANDROID_SERIAL=YOUR_HEADSET_SERIAL npm run quest
```

The launcher uses numeric loopback because this headset's Horizon launcher rejects the `localhost` hostname. If Browser remains invisible after launch, close and reopen Browser; a stale background debugging tab does not prove that its headset window opened.

If the page cannot be reached after disconnecting USB or restarting the headset, reconnect and run `npm run quest` again. If the Browser does not come to the foreground, open Meta Quest Browser manually and visit `http://127.0.0.1:5207` while the launcher is running.

To inspect the headset's browser, open desktop Chrome at `chrome://inspect/#devices`, find the Restore tab, and choose **inspect**. WebXR needs a secure context. USB forwarding makes the page local to the headset, so HTTP localhost is suitable for development. Plain HTTP on your computer's LAN IP does not have the same secure-context treatment.

## Why WebXR first

Meta recommends testing a WebXR experience in Quest Browser before PWA packaging. A browser session requires a user gesture, which is why Restore has an **Enter VR** button. Hand joint access is requested through the WebXR session's `hand-tracking` feature, rather than a web app manifest permission alone.

An installable app can be added later through Meta's Bubblewrap / Trusted Web Activity packaging route with a hosted HTTPS URL, signing, and Digital Asset Links. None of that is needed to play this USB demo. A generic Android WebView wrapper should not be assumed to provide the Quest Browser's immersive runtime.

References:

- [Meta: Debug Browser content and USB port forwarding](https://developers.meta.com/horizon/documentation/web/browser-remote-debugging/)
- [Meta: System deep linking](https://developers.meta.com/horizon/documentation/native/ps-system-deep-linking/)
- [Meta: WebXR hands](https://developers.meta.com/horizon/documentation/web/webxr-hands/)
- [W3C: WebXR Hand Input Module](https://www.w3.org/TR/webxr-hand-input-1/)
- [W3C: Secure Contexts](https://www.w3.org/TR/secure-contexts/)
- [Meta: Getting started with WebXR PWAs](https://developers.meta.com/horizon/documentation/web/pwa-webxr-gs/)
- [Meta: PWA packaging overview](https://developers.meta.com/horizon/documentation/web/pwa-overview/)
- [three-pinata source project](https://github.com/dgreenheck/three-pinata)

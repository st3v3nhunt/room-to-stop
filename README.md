# Room to Stop

A free 3D browser game that shows how speed, road surface and reaction time change how far a car travels before it stops. Built with Three.js, TypeScript and Vite, and hosted on GitHub Pages.

## Play

Pick a game, a vehicle (car, motorbike or lorry), a road surface (dry, wet or icy) and a speed (20 to 70 mph). What changed? picks its own speeds and roads for each level.

- **Hazard stop:** drive, and when a hazard appears, brake as fast as you can: press Space or click on a computer, or tap anywhere on a phone. The game measures your real reaction time, then plays a side-on replay with your thinking and braking distances painted on the road, next to where an alert driver would have stopped.
- **Predict the stop:** a driver sees a hazard at a white line, reacts in the Highway Code's 0.67 s and brakes hard. Before it plays out, drag a marker along the road (or use the slider, +/- buttons or arrow keys) to where you think the car will stop. You score up to 1,000 points for how close you were: full marks within 5% (or 1 m), falling to zero at 60% out. The results show how fast the car was still going at your marker if you guessed short.
- **What changed?:** watch a car stop, then the game changes the speed, the road surface, both, or swaps the car for a lorry or motorbike. Predict the new stopping distance with the marker, and how fast the car will still be going as it passes the green line where it stopped before. Half the 1,000 points are for the distance (scored like Predict the stop) and half for the speed (full marks within 2 mph, zero at 15 mph out). The results show which part of the stop grew and why.

Sound is made in the browser with the Web Audio API, so there are no audio files: an engine note for each vehicle that rises with speed, road noise, rain and spray in the wet, tyre squeal, hiss or scrape while braking, a lorry's air brakes, and short music in the menu only. Hazards make no sound, so reaction times come from what you see. The mute button in the top-right corner is always on screen and is remembered on the device.

## Develop

```sh
npm install
npm run dev      # local server with hot reload
npm test         # physics unit tests (checked against the Highway Code table)
npm run build    # type-check and build to dist/
```

## How it works

- `src/physics.ts`: stopping distance maths and scoring, with no graphics. Dry grip is tuned so a car in good condition reproduces the Highway Code table (23 m at 30 mph, 96 m at 70 mph) with a 0.67 s reaction. Wet roads double the braking distance and icy roads make it ten times longer, matching the Highway Code multipliers.
- `src/world.ts` and `src/models.ts`: the low-poly road, scenery, weather, car and hazards, all built from primitives (no asset files).
- `src/main.ts`: the menu and both level types. In the hazard stop, reaction time is measured from the frame that first shows the hazard to the timestamp of the brake input event. Braking before the hazard appears, or within 0.1 s of it, is a false start. In Predict the stop the whole stop is fixed before it starts, so it plays out the same on every device.
- Vehicles: a car reproduces the Highway Code table. A motorbike gets 92% of a car's grip when dry, 80% when wet and 70% on ice (less rubber on the road). A lorry gets 72% (85% on ice, where every vehicle is limited by the ice) and its air brakes take 0.4 s to bite, travelled at full speed and counted in the braking distance. These factors are estimates tuned to the design doc ("similar or slightly longer", "noticeably longer"), not published figures.
- `src/changes.ts`: picks What changed? levels. A change always makes the stop longer (faster, a worse road, or both), and icy roads stay at 40 mph or less so the stop is readable.
- `src/sound.ts`: the synthesised sounds and menu music. Audio starts on the first tap or key press, as browsers require.
- `src/results.ts`: the stop breakdown, score, a "what if" comparison and a one-line takeaway.

## Deploy

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, under **Pages**, set **Source** to **GitHub Actions** once.

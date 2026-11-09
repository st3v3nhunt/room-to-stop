# Room to Stop

A free 3D browser game that shows how speed, road surface and reaction time change how far a car travels before it stops. Built with Three.js, TypeScript and Vite, and hosted on GitHub Pages.

## Play

Pick a game, a road surface (dry, wet or icy) and a speed (20 to 70 mph).

- **Hazard stop:** drive, and when a hazard appears, brake as fast as you can: press Space or click on a computer, or tap anywhere on a phone. The game measures your real reaction time, then plays a side-on replay with your thinking and braking distances painted on the road, next to where an alert driver would have stopped.
- **Predict the stop:** a driver sees a hazard at a white line, reacts in the Highway Code's 0.67 s and brakes hard. Before it plays out, drag a marker along the road (or use the slider, +/- buttons or arrow keys) to where you think the car will stop. You score up to 1,000 points for how close you were: full marks within 5% (or 1 m), falling to zero at 60% out. The results show how fast the car was still going at your marker if you guessed short.

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
- `src/results.ts`: the stop breakdown, score, a "what if" comparison and a one-line takeaway.

## Deploy

Every push to `main` builds and deploys to GitHub Pages through `.github/workflows/deploy.yml`. In the repository settings, under **Pages**, set **Source** to **GitHub Actions** once.

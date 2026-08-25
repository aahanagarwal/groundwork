/**
 * Copies MapLibre's worker bundle into public/.
 *
 * MapLibre spawns its GeoJSON tiler in a web worker. Under Turbopack the
 * worker's module URL does not resolve in dev - the request falls through to
 * the app router and comes back as HTML, so the worker silently fails to boot
 * ("Failed to load module script: non-JavaScript MIME type text/html").
 *
 * The failure mode is nasty because it is partial: raster tiles keep rendering
 * on the main thread, so the map looks fine, while every GeoJSON source stays
 * empty - which in this app means the drive-time polygon, the whole point of
 * the map, silently does not draw.
 *
 * Serving the worker ourselves from public/ sidesteps the bundler entirely.
 * The worker imports ./maplibre-gl-shared.mjs, so both files must land in the
 * same directory. Re-run after upgrading maplibre-gl; `npm run dev` does it
 * automatically via predev.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl.css"));
const out = path.join(process.cwd(), "public", "maplibre");

mkdirSync(out, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(dist, file), path.join(out, file));
  console.log(`copied ${file} -> public/maplibre/`);
}

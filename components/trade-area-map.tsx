"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Point MapLibre at a worker we serve ourselves.
 *
 * MapLibre tiles GeoJSON sources inside a web worker. Under Turbopack the
 * worker's own module URL does not resolve in dev: the request falls through
 * to the app router and returns HTML, the worker never boots, and the failure
 * is partial in the worst way — raster tiles keep painting on the main thread
 * so the map looks healthy, while every GeoJSON source stays empty. In this
 * app that means the drive-time polygon, the entire reason the map exists,
 * quietly does not draw.
 *
 * scripts/copy-maplibre-worker.mjs puts the worker and its shared chunk in
 * public/maplibre/ (wired to predev/prebuild), so this bypasses the bundler.
 */
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

/**
 * THE TRADE AREA MAP
 *
 * One job, and the dossier is explicit about it: show the real drive shed
 * against the circle an ad tool would have bought, so the gap is not an
 * argument but a picture.
 *
 * The circle is a dashed outline with no fill — it is the claim being refuted,
 * not a layer of information. The polygon is filled ultramarine because it is
 * the thing being measured. That is the whole visual argument.
 *
 * Two effects, and the split is load-bearing rather than stylistic:
 *
 *   1. Create the map exactly once, guarded on the ref. Without that guard,
 *      React's development double-invoke leaves orphaned map instances sharing
 *      one container, and the live instance's events never reach the code that
 *      draws — which is precisely the bug this file was written around.
 *   2. Draw the overlay when the map is ready or the geometry changes,
 *      idempotently. Readiness comes from `load`, `idle`, and an immediate
 *      `loaded()` check, because a raster style can finish before React
 *      attaches a listener. `isStyleLoaded()` is deliberately NOT a gate — it
 *      reports false while tiles are still fetching, which silently skips the
 *      one call meant to do the work.
 *
 * No CSS filter on the canvas either: desaturating the basemap would mute the
 * ultramarine polygon along with it, and that polygon is the one thing here
 * that must not be muted. Carto Positron is near-greyscale already, which is
 * why it was chosen.
 */

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  kind: "closure" | "competitor" | "permit" | "site";
  label: string;
  /** Pins outside the polygon draw hollow — considered, then discarded. */
  insidePolygon: boolean;
}

const COLORS = {
  ink: "#14201C",
  survey: "#2C5F52",
  ultra: "#2438C8",
  signal: "#EBDD3C",
};

export function TradeAreaMap({
  center,
  polygon,
  naiveCircle,
  parcel,
  pins = [],
  minutes,
  naiveRadiusMiles,
}: {
  center: { lat: number; lng: number };
  polygon: GeoJSON.Polygon | null;
  naiveCircle: GeoJSON.Polygon | null;
  parcel?: GeoJSON.Geometry | null;
  pins?: MapPin[];
  minutes: number;
  naiveRadiusMiles: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [showCircle, setShowCircle] = useState(true);
  const [ready, setReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  /** Set by the draw effect so the resize observer can re-fit the view. */
  const refit = useRef<(() => void) | null>(null);

  // --- 1. Create the map, once ---------------------------------------------
  // Empty deps on purpose: one address per page, so the centre never changes
  // for the life of this component. Re-creating the map on every prop identity
  // change is what stacked orphaned instances on the same container.
  useEffect(() => {
    if (map.current || !container.current) return;

    const instance = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png",
              "https://b.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}@2x.png",
            ],
            tileSize: 256,
            attribution:
              '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
      center: [center.lng, center.lat],
      zoom: 11.4,
      attributionControl: { compact: true },
    });

    map.current = instance;

    // Development-only handle. Verifying that an overlay actually reached the
    // map otherwise means squinting at a screenshot, and a faint fill over a
    // grey basemap is exactly the thing a screenshot cannot settle.
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__groundworkMap = instance;
    }

    // Readiness must NOT depend on the basemap.
    //
    // `load` and `idle` both wait on tiles, so when the tile CDN is
    // unreachable — bad venue wifi, a dropped connection, a blocked host —
    // neither ever fires and the overlay silently never draws. That holds the
    // drive-time polygon, the entire reason this map exists, hostage to a
    // third-party CDN.
    //
    // `styledata` fires as soon as the style JSON is parsed, which is all that
    // is actually required to add a source and a layer. So the polygon draws
    // on a blank ground when the basemap can't load, and the map still makes
    // its argument offline.
    const markReady = () => setReady(true);
    if (instance.loaded()) markReady();
    instance.on("styledata", markReady);
    instance.on("load", markReady);
    instance.on("idle", markReady);

    instance.on("error", (event) => {
      const message = event?.error?.message ?? "";
      // A failed basemap tile is not worth shouting about — it is expected
      // offline, and the overlay is unaffected. Say it once.
      if (/basemaps\.cartocdn|Failed to fetch/.test(message)) {
        setBasemapFailed(true);
        return;
      }
      console.error("[map]", message || event);
    });

    // The map is created before the surrounding grid has settled its final
    // height, so MapLibre measures a container smaller than the one it ends up
    // in — and then fits bounds to the wrong size and never revisits it. The
    // symptom is a map at the wrong zoom with nothing visible in frame.
    // Watching the container and re-fitting is the fix; guessing at a timeout
    // is not.
    const observer = new ResizeObserver(() => {
      instance.resize();
      refit.current?.();
    });
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 2. Draw the overlay --------------------------------------------------
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    const addOnce = (
      id: string,
      geometry: GeoJSON.Geometry,
      layers: maplibregl.LayerSpecification[],
    ) => {
      if (instance.getSource(id)) return;
      instance.addSource(id, {
        type: "geojson",
        data: { type: "Feature", geometry, properties: {} },
      });
      for (const layer of layers) instance.addLayer(layer);
    };

    // Circle first, so the polygon draws over it.
    if (naiveCircle) {
      addOnce("naive", naiveCircle, [
        {
          id: "naive-line",
          type: "line",
          source: "naive",
          paint: {
            "line-color": COLORS.ink,
            "line-width": 1.5,
            "line-dasharray": [3, 3],
            "line-opacity": 0.65,
          },
        },
      ]);
    }

    if (polygon) {
      addOnce("shed", polygon, [
        {
          id: "shed-fill",
          type: "fill",
          source: "shed",
          paint: { "fill-color": COLORS.ultra, "fill-opacity": 0.2 },
        },
        {
          id: "shed-line",
          type: "line",
          source: "shed",
          paint: { "line-color": COLORS.ultra, "line-width": 2.5 },
        },
      ]);
    }

    if (parcel) {
      addOnce("parcel", parcel, [
        {
          id: "parcel-line",
          type: "line",
          source: "parcel",
          paint: { "line-color": COLORS.survey, "line-width": 2 },
        },
      ]);
    }

    // Markers are recreated per run, so they get their own cleanup.
    const markers: maplibregl.Marker[] = [];

    const siteEl = document.createElement("div");
    siteEl.style.cssText = `width:13px;height:13px;background:${COLORS.signal};border:2px solid ${COLORS.ink};border-radius:50%;`;
    siteEl.title = "This address";
    markers.push(
      new maplibregl.Marker({ element: siteEl })
        .setLngLat([center.lng, center.lat])
        .addTo(instance),
    );

    for (const pin of pins) {
      const el = document.createElement("div");
      const color = pin.kind === "closure" ? COLORS.ultra : COLORS.survey;
      el.style.cssText =
        `width:11px;height:11px;border:2px solid ${color};` +
        `border-radius:${pin.kind === "competitor" ? "50%" : "2px"};` +
        `background:${pin.insidePolygon ? color : "transparent"};`;
      markers.push(
        new maplibregl.Marker({ element: el })
          .setLngLat([pin.lng, pin.lat])
          .setPopup(new maplibregl.Popup({ offset: 12 }).setText(pin.label))
          .addTo(instance),
      );
    }

    // Fit to the circle so the contrast is the first thing visible.
    const target = naiveCircle ?? polygon;
    const fit = () => {
      if (!target) return;
      const coords = target.coordinates[0] as [number, number][];
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]),
      );
      instance.fitBounds(bounds, { padding: 32, duration: 0 });
    };
    fit();
    refit.current = fit;

    return () => {
      refit.current = null;
      markers.forEach((m) => m.remove());
    };
  }, [ready, polygon, naiveCircle, parcel, pins, center.lat, center.lng]);

  // Toggling the circle is a deliberate interaction — it is how a sceptic
  // checks that the polygon isn't a circle with extra steps.
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready || !instance.getLayer("naive-line")) return;
    instance.setLayoutProperty(
      "naive-line",
      "visibility",
      showCircle ? "visible" : "none",
    );
  }, [showCircle, ready]);

  return (
    <div className="relative h-full w-full">
      <div ref={container} className="h-full w-full" />

      {basemapFailed ? (
        <div className="pointer-events-none absolute bottom-3 right-3 max-w-[240px] border border-stone bg-paper/95 px-2.5 py-1.5 font-mono text-[10.5px] leading-snug text-stone">
          Street map unavailable — no connection. The drive area and the circle
          are drawn from stored geometry and are unaffected.
        </div>
      ) : null}

      <div className="pointer-events-none absolute left-3 top-3 border-[1.5px] border-ink bg-paper/95 px-3 py-2.5">
        <div className="label mb-1.5">Trade area</div>
        <div className="flex items-center gap-2 font-mono text-[11.5px]">
          <span className="inline-block h-2.5 w-4 border-2 border-[#2438C8] bg-[#2438C8]/20" />
          <span>
            {minutes}-minute drive — derived from measured drive times
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[11.5px] text-ink/60">
          <span className="inline-block h-0 w-4 border-t-2 border-dashed border-ink/60" />
          <span>
            {naiveRadiusMiles}-mile radius — what an ad tool would buy
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setShowCircle((v) => !v)}
        className="absolute bottom-9 left-3 border-[1.5px] border-ink bg-paper px-3 py-1.5 font-mono text-[11px] uppercase tracking-widest hover:bg-limestone">
        {showCircle ? "Hide" : "Show"} the circle
      </button>
    </div>
  );
}

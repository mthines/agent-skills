---
title: Maps and Geo — Library Selection for Spatial Data
impact: HIGH
tags:
  - maps
  - geographic
  - choropleth
  - mapbox
  - maplibre
  - leaflet
  - deck-gl
---

# Maps and Geo

Geographic visualization sits outside the standard chart library list — most chart libraries either skip maps entirely or ship a thin choropleth.
Pick a dedicated mapping stack when geography is the answer to the question.

## Decision table — web

| Need                                                              | Default                       | Why                                                                                        |
| ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| Static choropleth, low-detail world / country map                 | **react-simple-maps**         | SVG, ~30 kB, no API key; perfect for marketing pages and reports.                          |
| Interactive choropleth, custom basemap, vector tiles, no token    | **MapLibre GL JS**            | Open-source fork of Mapbox GL JS; runs on your own tiles or free OSM-based tiles.          |
| Production app, point clusters, geocoding, Mapbox basemaps        | **Mapbox GL JS**              | Mature, performant, requires access token; Mapbox Studio for styling.                      |
| Big-data point clouds, heatmaps, hexbin layers, WebGL throughput  | **deck.gl**                   | GPU-accelerated layers; pairs with Mapbox / MapLibre as a basemap.                         |
| 2D raster tile map, simple markers / polylines, smallest bundle   | **Leaflet (`react-leaflet`)** | ~40 kB, raster tiles, easy. Older API.                                                     |
| Any 3D terrain, globe view, satellite imagery                     | **Mapbox GL JS** or **CesiumJS** | Mapbox for product surfaces; CesiumJS for scientific globe.                                |
| Statistical / scientific maps inside notebooks                    | **Plotly.js (mapbox / geo)**  | Inline with other Plotly charts; high bundle cost — accept only if Plotly is already in.   |

## Decision table — mobile (Expo / React Native)

| Need                                                  | Default                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Native map with markers, custom callouts              | **`react-native-maps`** (Expo prebuild)                  |
| Vector tiles, custom styling, Mapbox features         | **`@rnmapbox/maps`**                                     |
| Open-source vector tiles (no Mapbox token)            | **`@maplibre/maplibre-react-native`**                    |
| Simple in-screen mini-map / pin                       | Static map image via Mapbox Static API or Google Static Maps |

`react-native-maps` is the safest default; it works in Expo dev clients and ships the platform-native map (Apple Maps on iOS, Google Maps on Android).

## Map vs choropleth — pick deliberately

| Question                                       | Right primitive                                                |
| ---------------------------------------------- | -------------------------------------------------------------- |
| "How does X vary by region?"                   | Choropleth                                                      |
| "Where are these events?"                      | Symbol / dot map (with clustering)                              |
| "How dense are events here vs there?"          | Hexbin or heatmap layer (deck.gl `HexagonLayer`, `HeatmapLayer`)|
| "How does a flow move between places?"         | Arc / flow map (deck.gl `ArcLayer`)                             |
| "What is the path of this trip?"               | Polyline / path map                                             |
| "What is the elevation / terrain?"             | 3D terrain or contour layer                                     |

## Choropleth pitfalls

- **Area bias**: large regions dominate the eye. Wyoming looks more important than New Jersey on a vote map. Fix: use a **cartogram** or **hex-grid map** (`@hyperobjekt/hexgrid` for US states; D3 + TopoJSON for custom).
- **Per-capita normalization**: always normalize raw counts by population for "rate of X" maps.
- **Projection choice**: Mercator distorts area badly at high latitudes. Prefer **Albers Equal Area** for US-only, **Robinson** or **Equal Earth** for world maps.
- **Color scale**: sequential for one-direction (low → high), diverging for "above / below midpoint" (vote share above 50%, profit vs loss).

## react-simple-maps example

```tsx
import { ComposableMap, Geographies, Geography } from "react-simple-maps";

const colorScale = scaleQuantize<string>().domain([0, 100]).range([
  "hsl(217 91% 95%)", "hsl(217 91% 80%)", "hsl(217 91% 65%)",
  "hsl(217 91% 50%)", "hsl(217 91% 35%)",
]);

<ComposableMap projection="geoAlbersUsa">
  <Geographies geography={topoUrl}>
    {({ geographies }) =>
      geographies.map((geo) => {
        const v = data[geo.id] ?? 0;
        return (
          <Geography
            key={geo.rsmKey}
            geography={geo}
            fill={colorScale(v)}
            stroke="hsl(var(--border))"
          />
        );
      })
    }
  </Geographies>
</ComposableMap>;
```

## MapLibre GL with deck.gl overlay

```tsx
import { Map } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { HexagonLayer } from "@deck.gl/aggregation-layers";

const layer = new HexagonLayer({
  id: "events",
  data: events,
  getPosition: (d) => [d.lng, d.lat],
  radius: 200,
  elevationScale: 4,
  extruded: true,
});

<DeckGL initialViewState={view} controller layers={[layer]}>
  <Map mapStyle="https://demotiles.maplibre.org/style.json" />
</DeckGL>;
```

deck.gl reads on the GPU; this scales to millions of points.

## react-native-maps example

```tsx
<MapView style={{ flex: 1 }} initialRegion={region} provider={PROVIDER_GOOGLE}>
  {points.map((p) => (
    <Marker key={p.id} coordinate={{ latitude: p.lat, longitude: p.lng }}>
      <Callout>{p.label}</Callout>
    </Marker>
  ))}
</MapView>
```

For clustered markers, use `react-native-maps-super-cluster` or `@react-native-mapbox-gl/maps` cluster layers. Hand-rolling clustering on the JS thread janks at > 200 markers.

## Accessibility

- Maps are visual. **Always** pair them with a text alternative: a sortable table of regions and values, an `aria-label` summary, or a "View as table" toggle.
- Choropleth color encoding must include a **direct label** on hover/focus showing the region name and value.
- Pan/zoom controls must be keyboard-reachable: `Tab` to controls, arrow keys to pan, `+/-` to zoom.

## Performance

- Vector tiles > raster tiles for any zoom-heavy product surface.
- For > 5k points, switch to deck.gl layers; markers per-DOM-node die at scale.
- Cache geometry: TopoJSON > GeoJSON for size; `simplify` (`@turf/simplify`) for low-zoom polygons.
- Tile servers: Mapbox / MapTiler for managed, self-host with `tegola` / `tilemaker` for sovereignty.

## Anti-patterns

- Choropleth without per-capita normalization.
- Mercator for global maps (Greenland is not the size of Africa).
- Raw point overlay > 1k markers — cluster or hex.
- Ignoring keyboard pan/zoom (WCAG 2.1.1).
- Using a map when a bar chart would answer the question (state ranks vs. raw geography).

## Checklist

- [ ] Map primitive matches the question (choropleth / dot / hex / flow).
- [ ] Choropleth values normalized (per capita, per area).
- [ ] Projection chosen deliberately (Albers, Equal Earth, etc.).
- [ ] Color scale matches data direction (sequential vs diverging).
- [ ] Text-alternative table provided.
- [ ] Pan/zoom keyboard-reachable.
- [ ] Mobile uses `react-native-maps` or `@rnmapbox/maps`, not WebView.
- [ ] > 1k points use clustering or deck.gl.

import type { Position } from '../domain/climate-event.ts';
import landCoordinates from '../data/geography/land-dots.json';

export type GlobeView = { longitude: number; latitude: number };
export const INITIAL_VIEW: GlobeView = { longitude: -25, latitude: 18 };
const radians = Math.PI / 180;

export function constrainView(view: GlobeView): GlobeView {
  return {
    longitude: ((view.longitude + 180) % 360 + 360) % 360 - 180,
    latitude: Math.max(-80, Math.min(80, view.latitude)),
  };
}

/** Orthographic projection; points on the rear hemisphere have negative depth. */
export function project(position: Position, view: GlobeView, radius = 220) {
  const longitude = (position[0] - view.longitude) * radians;
  const latitude = position[1] * radians;
  const center = view.latitude * radians;
  const depth = Math.sin(center) * Math.sin(latitude)
    + Math.cos(center) * Math.cos(latitude) * Math.cos(longitude);
  return {
    x: 260 + radius * Math.cos(latitude) * Math.sin(longitude),
    y: 260 - radius * (Math.cos(center) * Math.sin(latitude)
      - Math.sin(center) * Math.cos(latitude) * Math.cos(longitude)),
    depth,
    visible: depth > 0.015,
  };
}

// Pre-sampled Natural Earth land polygons: illustrative geography, not boundaries.
export const landDots: Position[] = landCoordinates.map(([longitude, latitude]) => [longitude, latitude]);

const gridLines: Position[][] = [];
for (let latitude = -60; latitude <= 60; latitude += 30) {
  const line: Position[] = [];
  for (let longitude = -180; longitude <= 180; longitude += 3) line.push([longitude, latitude]);
  gridLines.push(line);
}
for (let longitude = -180; longitude < 180; longitude += 30) {
  const line: Position[] = [];
  for (let latitude = -90; latitude <= 90; latitude += 3) line.push([longitude, latitude]);
  gridLines.push(line);
}

export function graticule(view: GlobeView): { id: string; path: string }[] {
  return gridLines.map((line) => {
    let drawing = false;
    const path = line.map((position) => {
      const point = project(position, view);
      if (!point.visible) { drawing = false; return ''; }
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command}${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    }).join(' ');
    return { id: line[0].join(','), path };
  });
}

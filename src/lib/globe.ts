import { EventCategory, type Position } from '../domain/climate-event.ts';

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

// Hand-drawn, simplified outlines. Decorative geography, not boundaries.
const continents: readonly (readonly Position[])[] = [
  [[-168, 72], [-140, 70], [-125, 60], [-105, 72], [-78, 80], [-55, 52], [-65, 45],
    [-80, 25], [-87, 20], [-80, 8], [-96, 17], [-117, 32], [-126, 50], [-155, 58]],
  [[-80, 12], [-60, 8], [-50, -1], [-35, -7], [-40, -23], [-54, -36], [-68, -55],
    [-75, -40], [-70, -18], [-81, -5]],
  [[-53, 60], [-43, 59], [-20, 76], [-30, 83], [-52, 82], [-62, 72]],
  [[-11, 36], [-10, 44], [0, 50], [5, 58], [20, 71], [40, 70], [60, 76],
    [100, 77], [140, 70], [179, 66], [170, 55], [145, 48], [140, 35], [122, 25],
    [108, 8], [100, 1], [95, 18], [80, 7], [70, 23], [55, 25], [45, 12],
    [35, 30], [26, 40], [15, 38], [10, 44], [2, 36]],
  [[-17, 33], [10, 37], [32, 31], [43, 12], [51, 12], [42, -5], [34, -25],
    [18, -35], [11, -20], [8, 1], [-16, 13]],
  [[113, -22], [129, -12], [140, -11], [153, -25], [150, -38], [133, -34], [115, -35]],
  [[44, -13], [51, -15], [48, -26], [44, -24]],
  [[130, 31], [142, 46], [145, 43], [141, 34]],
  [[95, 5], [106, -6], [119, -8], [116, -2], [106, 0]],
  [[166, -34], [179, -39], [173, -47], [166, -46], [172, -40]],
];

function inside([longitude, latitude]: Position, polygon: readonly Position[]) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x, y] = polygon[i], [previousX, previousY] = polygon[j];
    if ((y > latitude) !== (previousY > latitude)
      && longitude < (previousX - x) * (latitude - y) / (previousY - y) + x) result = !result;
  }
  return result;
}

export const landDots: Position[] = [];
for (let latitude = -82; latitude <= 82; latitude += 2.5) {
  const step = 2.5 / Math.max(0.25, Math.cos(latitude * radians));
  for (let longitude = -180; longitude < 180; longitude += step) {
    const point: Position = [longitude, latitude];
    if (latitude < -70 || continents.some((polygon) => inside(point, polygon))) landDots.push(point);
  }
}

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

/** Colors distinguish categories only; they never encode severity. */
export function categoryColor(category: EventCategory): string {
  switch (category) {
    case EventCategory.Wildfire: case EventCategory.Heat: return '#ff9a76';
    case EventCategory.Storm: return '#baa3ff';
    case EventCategory.Flood: case EventCategory.Ice: case EventCategory.Snow: return '#80d4ed';
    case EventCategory.Drought: case EventCategory.Dust: return '#ebce7b';
    case EventCategory.Volcano: case EventCategory.Earthquake: return '#f6a5c9';
    default: return '#8be0b4';
  }
}

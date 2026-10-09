import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { EventCategory, type ClimateEvent } from '../domain/climate-event.ts';
import {
  constrainView, graticule, INITIAL_VIEW, landDots, project, type GlobeView,
} from '../lib/globe.ts';
import Icon from './Icon.tsx';

const categoryColors: Record<EventCategory, string> = {
  [EventCategory.Wildfire]: '#c76b24',
  [EventCategory.Storm]: '#7956a5',
  [EventCategory.Flood]: '#2878b8',
  [EventCategory.Drought]: '#94643e',
  [EventCategory.Heat]: '#c43e3e',
  [EventCategory.Temperature]: '#b34d7a',
  [EventCategory.Ice]: '#248b9b',
  [EventCategory.Volcano]: '#963b2f',
  [EventCategory.Earthquake]: '#8b597b',
  [EventCategory.Landslide]: '#66513c',
  [EventCategory.Dust]: '#9b7b28',
  [EventCategory.Snow]: '#5e86ac',
  [EventCategory.Other]: '#6b7065',
};

// Use the first specific category consistently for multi-category event markers.
function markerCategory(event: ClimateEvent): EventCategory {
  return event.categories.find((category) => category !== EventCategory.Other) ?? EventCategory.Other;
}

interface Props {
  events: readonly ClimateEvent[];
  selectedId: string | null;
  view: GlobeView;
  onRotate: (view: GlobeView) => void;
  onSelect: (event: ClimateEvent | null) => void;
}

export default function Globe({ events, selectedId, view, onRotate, onSelect }: Props) {
  const id = useId();
  const dragRef = useRef<{ pointerId: number; x: number; y: number; view: GlobeView; scale: number } | null>(null);
  const visibleEvents = events.map((event) => ({ event, point: project(event.location.marker, view) }))
    .filter(({ point }) => point.visible);
  const categories = [...new Set(events.map(markerCategory))].sort();
  const rotate = (longitude: number, latitude: number) => onRotate(constrainView({
    longitude: view.longitude + longitude, latitude: view.latitude + latitude,
  }));

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.target !== event.currentTarget) return;
    const step = event.shiftKey ? 30 : 10;
    switch (event.key) {
      case 'ArrowLeft': rotate(-step, 0); break;
      case 'ArrowRight': rotate(step, 0); break;
      case 'ArrowUp': rotate(0, step); break;
      case 'ArrowDown': rotate(0, -step); break;
      case 'Home': onRotate(INITIAL_VIEW); break;
      case 'Escape': onSelect(null); break;
      default: return;
    }
    event.preventDefault();
  }

  function startDrag(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || dragRef.current
      || (event.target as Element).closest('[data-event-marker]')) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, view,
      scale: 520 / event.currentTarget.getBoundingClientRect().width };
  }

  function moveDrag(event: PointerEvent<SVGSVGElement>) {
    const start = dragRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    onRotate(constrainView({
      longitude: start.view.longitude - (event.clientX - start.x) * start.scale * 0.28,
      latitude: start.view.latitude + (event.clientY - start.y) * start.scale * 0.28,
    }));
  }

  function endDrag(event: PointerEvent<SVGSVGElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="globe-explorer">
    <svg className="globe" viewBox="0 0 520 520" role="group" tabIndex={0}
      aria-label="Interactive event globe" aria-describedby={`${id}-help`}
      onKeyDown={onKeyDown} onPointerDown={startDrag} onPointerMove={moveDrag}
      onDragStart={(event) => event.preventDefault()}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
      <defs>
        <radialGradient id={`${id}-ocean`} cx="36%" cy="28%" r="75%">
          <stop offset="0" stopColor="#ffffff" /><stop offset="0.6" stopColor="#f0f1ea" />
          <stop offset="1" stopColor="#d7dad1" />
        </radialGradient>
      </defs>
      <g aria-hidden="true" pointerEvents="none">
        <circle cx="260" cy="260" r="237" className="orbit" />
        <circle cx="260" cy="260" r="220" fill={`url(#${id}-ocean)`} stroke="#c6cac0" strokeWidth="0.5" />
        {graticule(view).map(({ id, path }) => <path key={id} d={path} className="graticule" />)}
        {landDots.map((position) => {
          const point = project(position, view);
          // Stable precision avoids server/browser trigonometry differences during hydration.
          return point.visible ? <circle key={position.join(',')} cx={point.x.toFixed(2)} cy={point.y.toFixed(2)}
            r={(0.55 + point.depth * 0.65).toFixed(2)} fill="#626a58" opacity={(0.3 + point.depth * 0.5).toFixed(2)} /> : null;
        })}
        <path d="M260 20v8M260 492v8M20 260h8M492 260h8" className="axis-tick" />
        <text x="260" y="12" textAnchor="middle" className="globe-label">N</text>
        <text x="260" y="516" textAnchor="middle" className="globe-label">S</text>
      </g>
      {visibleEvents.map(({ event, point }) => <g key={event.id} data-event-marker="true"
        className={`event-marker${selectedId === event.id ? ' is-selected' : ''}`}
        style={{ color: categoryColors[markerCategory(event)] }}
        transform={`translate(${point.x}, ${point.y})`} role="button" tabIndex={0}
        aria-label={`${event.title}. ${event.categories.join(', ')}. Show event summary.`}
        aria-pressed={selectedId === event.id}
        onMouseEnter={() => onSelect(event)} onFocus={() => onSelect(event)} onClick={() => onSelect(event)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault(); onSelect(event);
          } else if (keyEvent.key === 'Escape') { onSelect(null); }
        }}>
        <title>{event.title}</title>
        <circle className="marker-target" r="14" fill="transparent" />
        <circle className="marker-ring" r="9" fill="none" />
        <circle className="marker-core" r="4" strokeWidth="1.5" />
      </g>)}
    </svg>
    <div className="globe-controls" role="group" aria-label="Rotate globe">
      <button className="icon-button" aria-label="Rotate west" onClick={() => rotate(-25, 0)}><Icon name="arrow-left" /></button>
      <button className="icon-button" aria-label="Rotate north" onClick={() => rotate(0, 15)}><Icon name="arrow-up" /></button>
      <button className="text-button reset-view" onClick={() => onRotate(INITIAL_VIEW)}>Reset view</button>
      <button className="icon-button" aria-label="Rotate south" onClick={() => rotate(0, -15)}><Icon name="arrow-down" /></button>
      <button className="icon-button" aria-label="Rotate east" onClick={() => rotate(25, 0)}><Icon name="arrow-right" /></button>
    </div>
    <p className="globe-help" id={`${id}-help`}>Drag to explore <span aria-hidden="true">·</span> Arrow keys to rotate<span className="sr-only">. Home to reset. Press Escape to close a selection.</span></p>
    <p className="hemisphere-note">{visibleEvents.length} / {events.length} markers in view<span className="sr-only">. Explore every event in the list below.</span></p>
    {categories.length > 0 && <ul className="globe-legend" aria-label="Event marker colors">
      {categories.map((category) => <li key={category}>
        <span className="legend-dot" style={{ backgroundColor: categoryColors[category] }} aria-hidden="true" />
        {category}
      </li>)}
    </ul>}
  </div>;
}


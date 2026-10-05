import { useId, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import type { ClimateEvent } from '../domain/climate-event.ts';
import {
  categoryColor, constrainView, graticule, INITIAL_VIEW, landDots, project, type GlobeView,
} from '../lib/globe.ts';

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
    event.currentTarget.focus();
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
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { dragRef.current = null; }}>
      <defs>
        <radialGradient id={`${id}-ocean`} cx="36%" cy="28%" r="80%">
          <stop offset="0" stopColor="#1d3944" /><stop offset="0.65" stopColor="#102831" />
          <stop offset="1" stopColor="#08141c" />
        </radialGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="80%" stopColor="#79dcbb" stopOpacity="0" />
          <stop offset="89%" stopColor="#79dcbb" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#79dcbb" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g aria-hidden="true" pointerEvents="none">
        <circle cx="260" cy="260" r="253" fill={`url(#${id}-halo)`} />
        <circle cx="260" cy="260" r="232" className="orbit" />
        <circle cx="260" cy="260" r="220" fill={`url(#${id}-ocean)`} stroke="#567d83" strokeOpacity="0.55" />
        {graticule(view).map(({ id, path }) => <path key={id} d={path} className="graticule" />)}
        {landDots.map((position) => {
          const point = project(position, view);
          return point.visible ? <circle key={position.join(',')} cx={point.x} cy={point.y} r="1.7"
            fill="#97c6b9" opacity={0.3 + point.depth * 0.43} /> : null;
        })}
        <text x="260" y="17" textAnchor="middle" className="globe-label">N</text>
        <text x="260" y="511" textAnchor="middle" className="globe-label">S</text>
      </g>
      {visibleEvents.map(({ event, point }) => <g key={event.id} data-event-marker="true"
        className={`event-marker${selectedId === event.id ? ' is-selected' : ''}`}
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
        <circle r="13" fill="transparent" />
        <circle className="marker-ring" r="9" fill="none" stroke={categoryColor(event.categories[0])} strokeOpacity="0.4" />
        <circle r="4.5" fill={categoryColor(event.categories[0])} stroke="#0b171d" strokeWidth="1.5" />
      </g>)}
    </svg>
    <div className="globe-controls" role="group" aria-label="Rotate globe">
      <button className="icon-button" aria-label="Rotate west" onClick={() => rotate(-25, 0)}>&#8592;</button>
      <button className="icon-button" aria-label="Rotate north" onClick={() => rotate(0, 15)}>&#8593;</button>
      <button className="button button-secondary reset-view" onClick={() => onRotate(INITIAL_VIEW)}>Reset view</button>
      <button className="icon-button" aria-label="Rotate south" onClick={() => rotate(0, -15)}>&#8595;</button>
      <button className="icon-button" aria-label="Rotate east" onClick={() => rotate(25, 0)}>&#8594;</button>
    </div>
    <p className="globe-help muted" id={`${id}-help`}>Drag to explore · Arrow keys to rotate · Home to reset</p>
    <p className="hemisphere-note">{visibleEvents.length} of {events.length} markers in view. Explore every event in the list.</p>
  </div>;
}


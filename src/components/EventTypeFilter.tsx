import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Icon from './Icon.tsx';

interface Props {
  value: string;
  categories: readonly string[];
  onChange: (value: string) => void;
}

export default function EventTypeFilter({ value, categories, onChange }: Props) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [opensUp, setOpensUp] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const options = [{ value: 'all', label: 'All event types' }, ...categories.map((category) => ({ value: category, label: category }))];
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === activeValue));
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: globalThis.PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const menu = rootRef.current?.querySelector<HTMLUListElement>('.category-menu');
    const option = document.getElementById(`${id}-option-${activeIndex}`);
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [open, activeIndex, id]);

  function openMenu(next: string) {
    const bounds = rootRef.current?.getBoundingClientRect();
    if (bounds) {
      const spaceBelow = window.innerHeight - bounds.bottom;
      setOpensUp(spaceBelow < Math.min(options.length * 44 + 12, 280) && bounds.top > spaceBelow);
    }
    setActiveValue(next);
    setOpen(true);
  }

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') {
      if (open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (open) { event.preventDefault(); choose(options[activeIndex].value); }
      return;
    }
    let nextIndex: number | undefined;
    if (event.key === 'ArrowDown') nextIndex = open ? Math.min(activeIndex + 1, options.length - 1) : Math.max(0, options.findIndex((option) => option.value === value));
    else if (event.key === 'ArrowUp') nextIndex = open ? Math.max(activeIndex - 1, 0) : Math.max(0, options.findIndex((option) => option.value === value));
    else if (event.key === 'Home' && open) nextIndex = 0;
    else if (event.key === 'End' && open) nextIndex = options.length - 1;
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const start = open ? activeIndex + 1 : 0;
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset) % options.length;
        if (options[index].label.toLowerCase().startsWith(event.key.toLowerCase())) { nextIndex = index; break; }
      }
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      if (open) setActiveValue(options[nextIndex].value);
      else openMenu(options[nextIndex].value);
    }
  }

  return <div className={`category-filter${value !== 'all' ? ' has-filter' : ''}`} ref={rootRef}>
    <button id="event-category" type="button" className="category-trigger" role="combobox"
      aria-label="Filter by event type" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`}
      aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
      onKeyDown={onKeyDown} onBlur={() => setOpen(false)}
      onClick={() => { if (open) setOpen(false); else openMenu(value); }}>
      <span>{selected.label}</span><Icon name="chevron-down" />
    </button>
    {open && <ul id={`${id}-options`} className={`category-menu${opensUp ? ' opens-up' : ''}`} role="listbox" aria-label="Event types">
      {options.map((option, index) => <li key={option.value} id={`${id}-option-${index}`}
        className={`category-option${index === activeIndex ? ' is-active' : ''}`}
        role="option" aria-selected={option.value === value}
        onPointerMove={() => setActiveValue(option.value)}
        onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option.value)}>
        <span>{option.label}</span>{option.value === value && <Icon name="check" />}
      </li>)}
    </ul>}
  </div>;
}

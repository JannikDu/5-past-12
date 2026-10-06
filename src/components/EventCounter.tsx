import { useEffect, useState } from 'react';

export default function EventCounter({ count, loading, unavailable }: {
  count: number; loading: boolean; unavailable: boolean;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (loading || unavailable) return;
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 950;
    let frame = 0;
    let start: number | null = null;
    function animate(now: number) {
      start ??= now;
      const progress = duration === 0 ? 1 : Math.min((now - start) / duration, 1);
      setDisplay(Math.round(count * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [count, loading, unavailable]);

  return <div className={`event-counter${loading ? ' is-loading' : ''}`}>
    <span className="counter-value" aria-hidden="true">{unavailable ? '—' : loading ? '00' : String(display).padStart(2, '0')}</span>
    <span className="counter-label" aria-hidden="true">{unavailable ? 'feed unavailable' : loading ? 'finding events' : 'events found'}</span>
    <span className="sr-only" role="status">{unavailable ? 'Live reports are unavailable.' : loading ? 'Loading event reports.' : `${count} events found.`}</span>
    {loading && <span className="counter-progress" aria-hidden="true" />}
  </div>;
}

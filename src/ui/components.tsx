// Shared UI primitives (docs/design.md §5). This is the ONLY module allowed to render raw
// <button>, <input>, <select>, <textarea> or <dialog>; tests/ui-guards.test.ts enforces it.
// Text is always rendered as text nodes; nothing here accepts HTML.

import { APP } from '../app-meta';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';

// ---------- icons: one original outline family, 1.75 stroke on a 24 grid ----------
const PATHS = {
  settings: 'M10.3 3.2h3.4l.5 2.4c.6.2 1.2.5 1.7.9l2.3-.8 1.7 2.9-1.8 1.6c.1.6.1 1.2 0 1.8l1.8 1.6-1.7 2.9-2.3-.8c-.5.4-1.1.7-1.7.9l-.5 2.4h-3.4l-.5-2.4c-.6-.2-1.2-.5-1.7-.9l-2.3.8-1.7-2.9 1.8-1.6a5.6 5.6 0 0 1 0-1.8L3.9 8.6l1.7-2.9 2.3.8c.5-.4 1.1-.7 1.7-.9l.7-2.4ZM12 14.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-1.9L20 20',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  plus: 'M12 5v14M5 12h14',
  hop: 'M4 17c2.5-6 5.5-9 8-9s4 2 4 4-1.5 4-4 4M14 8c1-2.5 3-4 6-4',
  play: 'M8 5.8v12.4a1 1 0 0 0 1.5.86l10-6.2a1 1 0 0 0 0-1.72l-10-6.2A1 1 0 0 0 8 5.8Z',
  pause: 'M8.7 5.5v13M15.3 5.5v13',
  stop: 'M8 6.5h8a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 16V8A1.5 1.5 0 0 1 8 6.5Z',
  note: 'M5 19h4l10-10-4-4L5 15v4ZM13.5 6.5l4 4',
  timer: 'M12 20.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM12 9v4l2.5 2M10 2.8h4',
  list: 'M9 7h11M9 12h11M9 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01',
  export: 'M12 4v11M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15',
  copy: 'M10 8h8.5A1.5 1.5 0 0 1 20 9.5V18a1.5 1.5 0 0 1-1.5 1.5H10A1.5 1.5 0 0 1 8.5 18V9.5A1.5 1.5 0 0 1 10 8ZM5 15V6a1.5 1.5 0 0 1 1.5-1.5H15',
  panel: 'M6.5 4.5h11a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3ZM14 4.5v15',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  chevron: 'm6.5 9.5 5.5 5.5 5.5-5.5',
} as const;
export type IconName = keyof typeof PATHS;

const SOLID: Partial<Record<IconName, true>> = { play: true, stop: true };

export function Icon({ name, filled }: { name: IconName; filled?: boolean }) {
  const solid = filled || SOLID[name];
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={solid ? 'currentColor' : 'none'} stroke="currentColor" stroke-width={name === 'pause' ? 3.2 : 1.75} stroke-linecap="round" stroke-linejoin="round">
      <path d={PATHS[name]} />
    </svg>
  );
}

// ---------- buttons ----------
type BtnProps = Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'size'> & {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md';
  busy?: boolean;
  block?: boolean;
  /** Keeps the button focusable (unlike `disabled`) so focus survives state changes. */
  inert?: boolean;
  btnRef?: Ref<HTMLButtonElement>;
};

export function Button({ variant = 'secondary', size = 'md', busy, block, inert, btnRef, class: cls, onClick, children, ...rest }: BtnProps) {
  return (
    <button type="button" ref={btnRef} {...rest}
      class={['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', cls].filter(Boolean).join(' ')}
      aria-busy={busy || undefined} aria-disabled={inert || busy || undefined}
      onClick={(e) => { if (!inert && !busy) onClick?.(e); }}>
      {children}
    </button>
  );
}

export function IconButton({ label, icon, pressed, filled, onClick, variant, ...rest }: {
  label: string; icon: IconName; pressed?: boolean; filled?: boolean; onClick: () => void; variant?: 'primary' | 'plain';
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'onClick' | 'icon'>) {
  return (
    <button type="button" class={`icon-btn${variant ? ` ${variant}` : ''}`} aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} {...rest}>
      <Icon name={icon} filled={filled} />
    </button>
  );
}

// ---------- fields ----------
type FieldBase = { label: string; hideLabel?: boolean; hint?: string };

export function TextField({ label, hideLabel, hint, multiline, inputRef, ...rest }: FieldBase & {
  multiline?: boolean; inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'label' | 'ref'>) {
  const id = useId();
  return (
    <div class="field">
      <label class={hideLabel ? 'vh' : 'field-label'} for={id}>{label}</label>
      {multiline
        ? <textarea id={id} class="input" ref={inputRef as Ref<HTMLTextAreaElement>} aria-describedby={hint ? `${id}-h` : undefined} {...(rest as JSX.TextareaHTMLAttributes<HTMLTextAreaElement>)} />
        : <input id={id} class="input" ref={inputRef as Ref<HTMLInputElement>} aria-describedby={hint ? `${id}-h` : undefined} {...(rest as JSX.InputHTMLAttributes<HTMLInputElement>)} />}
      {hint && <span id={`${id}-h`} class="xs muted">{hint}</span>}
    </div>
  );
}

/**
 * The one dropdown: a styled select-only combobox (WAI-ARIA APG pattern) in place of the native <select>, whose open
 * list Chrome draws itself and cannot be themed. Keyboard: Enter, Space or arrows open; arrows, Home and End move;
 * typing jumps to a matching option; Enter picks; Escape closes without closing a surrounding dialog; Tab leaves.
 */
export function Select<T extends string>({ label, hideLabel, value, options, onChange }: FieldBase & {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  const last = options.length - 1;

  const show = (i = current) => { setActive(i); setOpen(true); };
  const choose = (i: number) => {
    setOpen(false);
    btn.current?.focus();
    const o = options[i];
    if (o && o.value !== value) onChange(o.value);
  };
  // Layout effect: the outside-click listener must exist before the list is painted, or a fast click is missed.
  useLayoutEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const jump = (ch: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 600 ? typed.current.text + ch : ch, at: now };
    const q = typed.current.text.toLowerCase();
    const from = open ? active : current;
    const order = [...options.keys()].map((k) => (from + 1 + k) % options.length);
    const hit = order.find((i) => options[i]!.label.toLowerCase().startsWith(q)) ?? order.find((i) => options[i]!.label.toLowerCase().startsWith(q[0]!));
    if (hit !== undefined) show(hit);
  };
  const onKey = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (open) setActive(Math.min(last, active + 1)); else show(); break;
      case 'ArrowUp': e.preventDefault(); if (open) setActive(Math.max(0, active - 1)); else show(); break;
      case 'Home': if (open) { e.preventDefault(); setActive(0); } break;
      case 'End': if (open) { e.preventDefault(); setActive(last); } break;
      case 'Enter': case ' ': e.preventDefault(); if (open) choose(active); else show(); break;
      // preventDefault stops the browser's dialog "cancel", so Escape closes only this list.
      case 'Escape': if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } break;
      case 'Tab': setOpen(false); break;
      default: if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); jump(e.key); }
    }
  };
  return (
    <div class="field" ref={wrap}>
      <span class={hideLabel ? 'vh' : 'field-label'} id={`${id}-label`}>{label}</span>
      <div class="dropdown">
        <button ref={btn} type="button" class="input dropdown-btn" role="combobox" aria-haspopup="listbox" aria-expanded={open}
          aria-controls={`${id}-list`} aria-labelledby={`${id}-label`} aria-activedescendant={open ? `${id}-o${active}` : undefined}
          onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKey}>
          <span class="dropdown-value">{options[current]?.label}</span>
          <Icon name="chevron" />
        </button>
        {open && (
          <ul ref={list} id={`${id}-list`} role="listbox" class="dropdown-menu" aria-labelledby={`${id}-label`}>
            {options.map((o, i) => (
              <li key={o.value} id={`${id}-o${i}`} data-i={i} role="option" aria-selected={o.value === value}
                class={`dropdown-opt${i === active ? ' is-active' : ''}`}
                onPointerMove={() => i !== active && setActive(i)} onPointerDown={(e) => e.preventDefault()} onClick={() => choose(i)}>
                <span>{o.label}</span>{o.value === value && <Icon name="check" />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

// type="text" with role="searchbox": Chrome draws its own clear button on type="search", which would
// duplicate ours.
export function SearchBox({ value, onInput, onKeyDown, inputRef, label }: {
  value: string; onInput: (v: string) => void; onKeyDown?: (e: KeyboardEvent) => void;
  inputRef?: Ref<HTMLInputElement>; label: string;
}) {
  return (
    <div class="search" role="search">
      <Icon name="search" />
      <input ref={inputRef} class="input" type="text" role="searchbox" enterkeyhint="search" aria-label={label} placeholder={label} value={value}
        autocomplete="off" spellcheck={false}
        onInput={(e) => onInput((e.currentTarget as HTMLInputElement).value)} onKeyDown={onKeyDown} />
      {value && <IconButton label="Clear search" icon="close" onClick={() => onInput('')} />}
    </div>
  );
}

// ---------- filter group ----------
export function FilterGroup<T extends string>({ label, options, value, onChange }: {
  label: string; options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <div class="filters" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" class="filter" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}{o.count !== undefined && <span class="muted num"> {o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- status text: always text + symbol, never colour alone ----------
export type StatusKind = 'running' | 'paused' | 'local' | 'review' | 'sample' | 'warning' | 'error' | 'neutral';
export function StatusText({ kind, children, pill }: { kind: StatusKind; children: ComponentChildren; pill?: boolean }) {
  return (
    <span class={`status status-${kind}${pill ? ' mode' : ''}`}>
      <span class="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// ---------- header ----------
export function AppHeader({ status, children, title }: { status?: ComponentChildren; children?: ComponentChildren; title?: string }) {
  return (
    <header class="header">
      <div class="brand"><BrandMark /><span>{title ?? APP.brand}</span></div>
      <div class="grow row">{status}</div>
      {children}
    </header>
  );
}

// ---------- banner / empty ----------
export function Banner({ tone, children, onDismiss }: { tone: 'error' | 'warning' | 'info'; children: ComponentChildren; onDismiss?: () => void }) {
  return (
    <div class={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div class="grow">{children}</div>
      {onDismiss && <IconButton label="Dismiss message" icon="close" onClick={onDismiss} />}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ComponentChildren; action?: ComponentChildren }) {
  return (
    <div class="empty">
      <p><strong>{title}</strong></p>
      {children && <p class="muted small">{children}</p>}
      {action}
    </div>
  );
}

// ---------- dialog: native modal, Escape closes, focus returns to the opener ----------
export function Dialog({ open, title, onClose, children, actions }: {
  open: boolean; title: string; onClose: () => void; children: ComponentChildren; actions: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    el.current = d;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
    } else if (!open && d.open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
      opener.current = null;
    }
  }, [open]);
  // A dialog is often unmounted by its owner rather than closed. Close it first (a modal makes the
  // opener inert, so focus() would be ignored), then return focus. Preact clears `ref` before effect
  // cleanup, so the element is kept in `el`.
  const el = useRef<HTMLDialogElement | null>(null);
  useEffect(() => () => {
    if (el.current?.open) el.current.close();
    (opener.current as HTMLElement | null)?.focus?.();
  }, []);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <div class="dialog-body">
          <h2 id={titleId} class="dialog-title">{title}</h2>
          {children}
          <div class="dialog-actions">{actions}</div>
        </div>
      )}
    </dialog>
  );
}

export function Disclosure({ expanded, onToggle, children }: { expanded: boolean; onToggle: () => void; children: ComponentChildren }) {
  return <button type="button" class="disclosure" aria-expanded={expanded} onClick={onToggle}>{children}</button>;
}

export function Meter({ ratio, level }: { ratio: number; level: string }) {
  return <div class={`meter meter-${level}`} aria-hidden="true"><span style={{ width: `${Math.round(ratio * 100)}%` }} /></div>;
}

// ---------- control-room pieces ----------

/** Round control with a visible text label underneath (Note / Pause / Stop). */
export function RoundControl({ label, icon, ariaLabel, primary, busy, onClick }: {
  label: string; icon: IconName; ariaLabel?: string; primary?: boolean; busy?: boolean; onClick: () => void;
}) {
  return (
    <div class="ctl">
      <button type="button" class={`icon-btn${primary ? ' primary' : ''}`} aria-label={ariaLabel ?? label}
        aria-busy={busy || undefined} onClick={() => { if (!busy) onClick(); }}>
        <Icon name={icon} />
      </button>
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

/** Per-work play / pause. Stays focusable while busy so keyboard focus survives the switch. */
export function PlayButton({ label, live, busy, onClick, ...rest }: {
  label: string; live: boolean; busy?: boolean; onClick: () => void;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button type="button" class={`tbtn${live ? ' live' : ''}`} aria-label={label} title={label}
      aria-busy={busy || undefined} onClick={() => { if (!busy) onClick(); }} {...rest}>
      <Icon name={live ? 'pause' : 'play'} />
    </button>
  );
}

export function Avatar({ name }: { name: string }) {
  const letters = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  return <span class="avatar" aria-hidden="true">{letters || '?'}</span>;
}

export function BrandMark() {
  return <span class="mark" aria-hidden="true"><Icon name="hop" /></span>;
}

/** 270-degree budget dial with tick marks. `ratio` null draws ticks only (no budget known). */
export function Dial({ ratio, tone, children, ends }: {
  ratio: number | null; tone: 'live' | 'over' | 'idle'; children: ComponentChildren; ends?: [string, string];
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const cx = 118, cy = 112, r = 88, start = 135, sweep = 270;
  const pt = (deg: number, rr: number) => { const a = (deg * Math.PI) / 180; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const; };
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = pt(a0, r), [x1, y1] = pt(a1, r);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const end = ratio === null ? start : start + sweep * Math.max(0, Math.min(1, ratio));
  const lit = tone === 'over' ? 'var(--danger-arc)' : 'var(--accent)';
  const ticks = Array.from({ length: 55 }, (_, i) => {
    const deg = start + (sweep * i) / 54, major = i % 9 === 0;
    const [x0, y0] = pt(deg, r + 9), [x1, y1] = pt(deg, r + (major ? 17 : 13));
    return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} style={{ stroke: ratio !== null && deg <= end ? lit : 'var(--tick)' }} stroke-width={major ? 1.6 : 1} stroke-linecap="round" />;
  });
  const [kx, ky] = pt(end, r);
  return (
    <div class="dial">
      <svg viewBox="0 0 236 206" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`iri${id}`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--lilac-200)' }} /><stop offset=".55" style={{ stopColor: 'var(--aqua-200)' }} /><stop offset="1" style={{ stopColor: 'var(--cream-200)' }} />
          </linearGradient>
        </defs>
        {ticks}
        <path d={arc(start, start + sweep)} fill="none" style={{ stroke: 'var(--track)' }} stroke-width="3" stroke-linecap="round" />
        {ratio !== null && ratio > 0 && <path d={arc(start, end)} fill="none" style={{ stroke: tone === 'over' ? 'var(--danger-arc)' : `url(#iri${id})` }} stroke-width="3.5" stroke-linecap="round" />}
        {ratio !== null && <circle cx={kx} cy={ky} r="6" style={{ fill: tone === 'over' ? 'var(--danger-arc)' : 'var(--cream-200)' }} />}
      </svg>
      <div class="dial-center">{children}</div>
      {ends && <div class="dial-ends" aria-hidden="true"><span>{ends[0]}</span><span>{ends[1]}</span></div>}
    </div>
  );
}

/** Small progress ring for the popup. */
export function Ring({ ratio, children }: { ratio: number | null; children: ComponentChildren }) {
  const c = 2 * Math.PI * 38;
  return (
    <div class="ring">
      <svg viewBox="0 0 88 88" aria-hidden="true" focusable="false">
        <circle cx="44" cy="44" r="38" fill="none" style={{ stroke: 'var(--track)' }} stroke-width="4" />
        {ratio !== null && <circle cx="44" cy="44" r="38" fill="none" style={{ stroke: 'var(--accent)' }} stroke-width="4" stroke-linecap="round"
          stroke-dasharray={c} stroke-dashoffset={c * (1 - Math.max(0, Math.min(1, ratio)))} transform="rotate(-90 44 44)" />}
      </svg>
      <span class="t">{children}</span>
    </div>
  );
}

/** Daily totals as rounded bars, today lit with its value. Real data only, never invented. */
export function WeekBars({ days, large, label }: { days: { label: string; ms: number; today: boolean; value: string }[]; large?: boolean; label: string }) {
  const max = Math.max(...days.map((d) => d.ms), 1);
  return (
    <div class={`bars${large ? ' lg' : ''}`} role="img" aria-label={`${label}: ${days.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
      {days.map((d) => (
        <div class="bar-col" key={d.label}>
          <div class="bar-fill">
            <div class={`bar${d.today ? ' today' : ''}`} style={{ height: `${Math.max(4, (d.ms / max) * 100)}%` }}>
              {d.today && d.ms >= 60_000 && <span class="bar-tip">{d.value}</span>}
            </div>
          </div>
          <span class={`bar-day${d.today ? ' today' : ''}`}>{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Round navigation rail for the full-tab pages. */
export function Rail({ current, items }: { current: string; items: { id: string; label: string; icon: IconName; onClick: () => void }[] }) {
  return (
    <nav class="rail glass" aria-label="Sections">
      <BrandMark />
      {items.map((it) => (
        <button key={it.id} type="button" class="icon-btn" aria-label={it.label} title={it.label}
          aria-current={it.id === current ? 'page' : undefined} onClick={it.onClick}>
          <Icon name={it.icon} />
        </button>
      ))}
    </nav>
  );
}

/** A day in the Review day strip. */
export function DayButton({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: ComponentChildren; label: string }) {
  return <button type="button" class="day" aria-pressed={pressed} aria-label={label} onClick={onClick}>{children}</button>;
}

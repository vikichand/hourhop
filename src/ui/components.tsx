// Shared UI primitives (docs/design.md §5). This is the ONLY module allowed to render raw
// <button>, <input>, <select>, <textarea> or <dialog>; tests/ui-guards.test.ts enforces it.
// Text is always rendered as text nodes; nothing here accepts HTML.

import { APP } from '../app-meta';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';

// ---------- icons: one original outline family, 1.75 stroke on a 24 grid ----------
const PATHS = {
  settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7.4-2.1.1-1.4-.1-1.4 2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.4-1.4L14.2 2h-4.4l-.4 2.7A7.6 7.6 0 0 0 7 6.1l-2.4-1-2 3.4 2 1.6-.1 1.4.1 1.4-2 1.6 2 3.4 2.4-1c.7.6 1.5 1 2.4 1.4l.4 2.7h4.4l.4-2.7c.9-.4 1.7-.8 2.4-1.4l2.4 1 2-3.4-2-1.6Z',
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-1.9L20 20',
  close: 'M6 6l12 12M18 6 6 18',
  star: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z',
  plus: 'M12 5v14M5 12h14',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  hop: 'M4 17c2.5-6 5.5-9 8-9s4 2 4 4-1.5 4-4 4M14 8c1-2.5 3-4 6-4M17 20h3',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, filled }: { name: IconName; filled?: boolean }) {
  return (
    <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
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

export function IconButton({ label, icon, pressed, filled, onClick, ...rest }: {
  label: string; icon: IconName; pressed?: boolean; filled?: boolean; onClick: () => void;
} & Omit<JSX.HTMLAttributes<HTMLButtonElement>, 'onClick' | 'icon'>) {
  return (
    <button type="button" class="icon-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick} {...rest}>
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

export function Select<T extends string>({ label, hideLabel, value, options, onChange }: FieldBase & {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div class="field">
      <label class={hideLabel ? 'vh' : 'field-label'} for={id}>{label}</label>
      <select id={id} class="input" value={value} onChange={(e) => onChange((e.currentTarget as HTMLSelectElement).value as T)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
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

export function SearchBox({ value, onInput, onKeyDown, inputRef, label }: {
  value: string; onInput: (v: string) => void; onKeyDown?: (e: KeyboardEvent) => void;
  inputRef?: Ref<HTMLInputElement>; label: string;
}) {
  return (
    <div class="search" role="search">
      <Icon name="search" />
      <input ref={inputRef} class="input" type="search" aria-label={label} placeholder={label} value={value}
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
    <span class={`status status-${kind}${pill ? ' pill' : ''}`}>
      <span class="status-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

// ---------- header ----------
export function AppHeader({ status, children, title }: { status?: ComponentChildren; children?: ComponentChildren; title?: string }) {
  return (
    <header class="header">
      <div class="brand"><Icon name="hop" /><span>{title ?? APP.brand}</span></div>
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

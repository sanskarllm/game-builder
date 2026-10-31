import type { ReactNode } from 'react';

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange(v: number): void;
  format?(v: number): string;
}) {
  const { label, value, min, max, step = 0.01, onChange, format } = props;
  return (
    <label className="field">
      <div className="slider-head">
        <span>{label}</span>
        <b>{format ? format(value) : value.toFixed(2)}</b>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </label>
  );
}

export function ColorField(props: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="color-field">
      <input type="color" value={props.value} onChange={(e) => props.onChange(e.target.value)} />
      {props.label}
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange(v: T): void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={o.value} type="button" className={o.value === props.value ? 'active' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Group(props: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="group">
      <h4 className="group-title">
        {props.title}
        {props.action}
      </h4>
      {props.children}
    </section>
  );
}

export function SectionHeader(props: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="section-header">
      <div>
        <h1>{props.title}</h1>
        <p>{props.subtitle}</p>
      </div>
      {props.actions && <div className="row">{props.actions}</div>}
    </header>
  );
}

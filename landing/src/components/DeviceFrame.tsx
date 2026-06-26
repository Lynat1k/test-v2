import type { ReactNode } from 'react';

type Props = {
  src: string;
  alt: string;
  /** label shown in the faux window toolbar */
  chip?: string;
  /** small badge on the top-right, e.g. "LIVE" or "GIF" */
  badge?: ReactNode;
  /** eager-load (hero); others lazy-load */
  priority?: boolean;
  className?: string;
};

/**
 * Glass "app window" that frames a real product screenshot:
 * traffic-light dots + a mono toolbar label, then the image inside
 * an inset bezel. Keeps every screenshot reading as the live terminal.
 */
export function DeviceFrame({ src, alt, chip, badge, priority, className = '' }: Props) {
  return (
    <div className={`glass rounded-2xl p-2 sm:p-2.5 ${className}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex items-center gap-1.5">
          <i className="w-2.5 h-2.5 rounded-full bg-ask/70" />
          <i className="w-2.5 h-2.5 rounded-full bg-gold/70" />
          <i className="w-2.5 h-2.5 rounded-full bg-bid/70" />
        </span>
        {chip && <span className="tnum text-[11px] text-muted/80 ml-2 truncate">{chip}</span>}
        {badge && <span className="ml-auto">{badge}</span>}
      </div>
      <div className="rounded-xl overflow-hidden border border-white/10 bg-bg-deep">
        <img
          src={src}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="w-full block"
        />
      </div>
    </div>
  );
}

export function LiveBadge({ label = 'LIVE' }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 tnum text-[10px] text-bid pr-1">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full rounded-full bg-bid opacity-70" style={{ animation: 'poc-glow 2s infinite' }} />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-bid" />
      </span>
      {label}
    </span>
  );
}

'use client';

import { CSSProperties, ReactNode, useState } from 'react';

type HoverPillIconButtonProps = {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  buttonStyle?: CSSProperties;
  containerStyle?: CSSProperties;
};

export default function HoverPillIconButton({
  label,
  onClick,
  children,
  disabled = false,
  buttonStyle,
  containerStyle,
}: HoverPillIconButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const showPill = !disabled && (hovered || focused);

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...containerStyle,
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        disabled={disabled}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={buttonStyle}
      >
        {children}
      </button>
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(100% + 8px)',
          left: '50%',
          transform: `translate(-50%, ${showPill ? '0' : '4px'})`,
          opacity: showPill ? 1 : 0,
          pointerEvents: 'none',
          transition: 'opacity 0.16s ease, transform 0.16s ease',
          padding: '4px 8px',
          borderRadius: 999,
          background: 'rgba(10,10,12,0.94)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: 'var(--fg-primary)',
          fontSize: 10,
          fontFamily: 'var(--font-serif)',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          boxShadow: '0 10px 24px rgba(0,0,0,0.28)',
          zIndex: 40,
        }}
      >
        {label}
      </div>
    </div>
  );
}

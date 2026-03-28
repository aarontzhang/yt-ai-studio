'use client';

import { useId } from 'react';

export default function AutocutMark({
  size = 20,
  withTile = true,
}: {
  size?: number;
  withTile?: boolean;
}) {
  const id = useId();
  const chevronId = `${id}-chevron`;
  const leftClipId = `${id}-left-flush-clip`;
  const rightClipId = `${id}-right-chevron-left-flush`;

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {withTile && <rect x="1" y="1" width="22" height="22" rx="6" fill="#0A0A0A" />}
      <defs>
        <path id={chevronId} d="M0 0L4.6 3.2L0 6.4" />
        <clipPath id={leftClipId}>
          <rect x="5.35" y="4.1" width="14.6" height="16" />
        </clipPath>
        <clipPath id={rightClipId}>
          <rect x="11.15" y="8.2" width="8.8" height="8.1" />
        </clipPath>
      </defs>
      <g
        clipPath={`url(#${leftClipId})`}
        transform="translate(1.45 0.2)"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      >
        <use href={`#${chevronId}`} transform="translate(4.7 4.9)" />
        <use href={`#${chevronId}`} transform="translate(4.7 12.7)" />
      </g>
      <g
        clipPath={`url(#${rightClipId})`}
        transform="translate(1.45 0.2)"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="1.4"
        strokeLinecap="butt"
        strokeLinejoin="miter"
      >
        <use href={`#${chevronId}`} transform="translate(10.45 8.8)" />
      </g>
    </svg>
  );
}

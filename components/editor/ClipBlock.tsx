'use client';

import { VideoClip } from '@/lib/types';
import { formatTime } from '@/lib/timelineUtils';

interface ClipBlockProps {
  clip: VideoClip;
  left: number;    // px position
  width: number;   // px width
  height: number;
  top: number;
  isSelected: boolean;
  isTagged: boolean;
  onSelect: (e: React.MouseEvent) => void;
  index: number;
  title: string;
}

const CLIP_COLOR = {
  bg: 'rgba(59,130,246,0.35)',
  border: 'rgba(96,165,250,0.6)',
  hi: 'rgba(96,165,250,0.9)',
};

export default function ClipBlock({
  clip, left, width, height, top, isSelected, isTagged,
  onSelect, index, title,
}: ClipBlockProps) {
  const clipNumber = index + 1;
  const color = CLIP_COLOR;

  // Timeline duration = sourceDuration / speed
  const timelineDuration = clip.sourceDuration / clip.speed;
  const isMicroClip = width < 52;

  return (
    <div
      className="clip-block"
      title={title}
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        background: color.bg,
        borderRadius: 4,
        border: `1.5px solid ${isSelected ? 'var(--accent)' : isTagged ? 'rgba(125,211,252,0.9)' : color.border}`,
        outline: isSelected ? '1.5px solid rgba(255,255,255,0.2)' : undefined,
        outlineOffset: isSelected ? '1px' : undefined,
        boxSizing: 'border-box',
        overflow: 'hidden',
        cursor: 'pointer',
        userSelect: 'none',
        boxShadow: isTagged ? '0 0 0 1px rgba(125,211,252,0.3)' : 'none',
      }}
      onClick={onSelect}
    >
      {isMicroClip && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04))',
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Label */}
      <div style={{
        position: 'absolute',
        left: isMicroClip ? 6 : 10,
        right: isMicroClip ? 6 : 10,
        top: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        pointerEvents: 'none',
        overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 6,
          minWidth: 0,
          maxWidth: '100%',
          width: '100%',
        }}>
        <span style={{
          fontSize: 10,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.85)',
          fontFamily: 'var(--font-serif)',
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flexShrink: 1,
        }}>
          {isMicroClip ? clipNumber : `Clip ${clipNumber}`}
        </span>

        {/* Speed badge */}
        {!isMicroClip && clip.speed !== 1.0 && width > 76 && (
          <span style={{
            fontSize: 9,
            fontWeight: 700,
            color: 'rgba(255,220,50,1)',
            fontFamily: 'var(--font-serif)',
            display: 'inline-flex',
            alignItems: 'center',
            lineHeight: 1,
            background: 'rgba(0,0,0,0.35)',
            padding: '1px 4px',
            borderRadius: 2,
            flexShrink: 0,
          }}>
            {clip.speed}×
          </span>
        )}

        {/* Filter badge */}
        {!isMicroClip && clip.filter && clip.filter.type !== 'none' && width > 94 && (
          <span style={{
            fontSize: 9,
            color: 'rgba(167,139,250,0.9)',
            fontFamily: 'var(--font-serif)',
            display: 'inline-flex',
            alignItems: 'center',
            lineHeight: 1,
            background: 'rgba(139,92,246,0.2)',
            padding: '1px 4px',
            borderRadius: 2,
            flexShrink: 0,
          }}>
            {clip.filter.type[0].toUpperCase()}
          </span>
        )}

        {!isMicroClip && width > 118 && (
          <span style={{
            fontSize: 9,
            color: 'rgba(255,255,255,0.55)',
            fontFamily: 'var(--font-serif)',
            display: 'inline-flex',
            alignItems: 'center',
            lineHeight: 1,
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
            {formatTime(timelineDuration)}
          </span>
        )}
        </div>
      </div>
    </div>
  );
}

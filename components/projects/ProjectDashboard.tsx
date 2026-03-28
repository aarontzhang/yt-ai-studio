'use client';

import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';
import type { Project } from '@/app/projects/page';
import StorageQuotaBanner from '@/components/storage/StorageQuotaBanner';
import type { StorageQuotaSnapshot } from '@/lib/storageQuota';

interface Props {
  projects: Project[];
  loading: boolean;
  storageQuota: StorageQuotaSnapshot | null;
  storageQuotaLoading: boolean;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${(bytes / 1e6).toFixed(0)} MB`;
}

function VideoThumbnail({ src }: { src: string | null }) {
  const [thumbnail, setThumbnail] = useState<{ src: string; dataUrl: string } | null>(null);
  const [videoReadySrc, setVideoReadySrc] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;

    const onSeeked = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 480;
        canvas.height = 270;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, 480, 270);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        setThumbnail({ src, dataUrl });
      } catch {
        // CORS-tainted canvases can't export, so the inline video fallback
        // below seeks to the first frame and renders that directly.
      }
      video.src = '';
    };

    const onLoadedMetadata = () => {
      // Seek to first real frame (slightly past 0 for black-frame safety)
      video.currentTime = 0.001;
    };

    video.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    video.src = src;

    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.src = '';
    };
  }, [src]);

  useEffect(() => {
    if (!src || thumbnail?.src === src) return;

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;

    const seekToFirstFrame = () => {
      if (cancelled) return;
      try {
        video.currentTime = 0.001;
      } catch {
        setVideoReadySrc(src);
      }
    };

    const onSeeked = () => {
      if (cancelled) return;
      video.pause();
      setVideoReadySrc(src);
    };

    const onLoadedData = () => {
      if (cancelled) return;
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        seekToFirstFrame();
      }
    };

    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('seeked', onSeeked);

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      seekToFirstFrame();
    } else {
      video.load();
    }

    return () => {
      cancelled = true;
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [src, thumbnail]);

  if (!src) {
    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,255,255,0.03)',
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.2">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </div>
    );
  }

  if (thumbnail?.src === src) {
    return (
      <Image
        src={thumbnail.dataUrl}
        alt=""
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 320px"
        style={{ objectFit: 'cover' }}
      />
    );
  }

  // CORS fallback: render video element directly — browser shows first frame
  return (
    <video
      ref={videoRef}
      src={src}
      preload="auto"
      muted
      playsInline
      style={{
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
        opacity: videoReadySrc === src ? 1 : 0,
        transition: 'opacity 0.12s ease',
      }}
    />
  );
}

function ProjectCard({
  project: p,
  onOpen,
  onDelete,
  onRename,
}: {
  project: Project;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(p.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const commitRename = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== p.name) onRename(p.id, trimmed);
    else setNameValue(p.name);
    setEditing(false);
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-panel)',
        borderRadius: 10,
        border: `1px solid ${hovered ? 'rgba(255,255,255,0.14)' : 'var(--border)'}`,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered ? '0 8px 24px rgba(0,0,0,0.35)' : 'none',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Thumbnail */}
      <div
        onClick={() => onOpen(p.id)}
        style={{
          aspectRatio: '16/9',
          background: '#0d0d0d',
          overflow: 'hidden',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <VideoThumbnail src={p.thumbnailUrl ?? null} />
        {/* Play hint on hover */}
        {hovered && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              background: 'rgba(255,255,255,0.15)',
              backdropFilter: 'blur(6px)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="white">
                <polygon points="5 3 19 12 5 21 5 3"/>
              </svg>
            </div>
          </div>
        )}
        {/* Delete button */}
        <button
          onClick={e => { e.stopPropagation(); onDelete(p.id); }}
          title="Delete project"
          style={{
            position: 'absolute', top: 8, right: 8,
            width: 26, height: 26,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(4px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
            color: 'rgba(255,255,255,0.6)',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
        </button>
      </div>

      {/* Info */}
      <div
        style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}
        onClick={() => !editing && onOpen(p.id)}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { setNameValue(p.name); setEditing(false); }
            }}
            onClick={e => e.stopPropagation()}
            autoFocus
            style={{
              fontSize: 13, fontWeight: 500, color: 'var(--fg-primary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--accent)',
              borderRadius: 4, padding: '2px 6px',
              width: '100%', outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <p style={{
              fontSize: 13, fontWeight: 500, color: 'var(--fg-primary)',
              margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {p.name}
            </p>
            <button
              onClick={e => { e.stopPropagation(); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
              title="Rename"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2, borderRadius: 3,
                color: 'var(--fg-faint)', flexShrink: 0,
                opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
                display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--fg-secondary)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--fg-faint)'; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        )}
        <p style={{ fontSize: 11, color: 'var(--fg-muted)', margin: 0 }}>
          {formatDate(p.updated_at)}{p.video_size ? ` · ${formatSize(p.video_size)}` : ''}
        </p>
        {p.video_filename && (
          <p
            style={{
              fontSize: 11,
              color: 'var(--fg-faint)',
              margin: '2px 0 0',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={p.video_filename}
          >
            {p.video_filename}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ProjectDashboard({
  projects,
  loading,
  storageQuota,
  storageQuotaLoading,
  onNew,
  onOpen,
  onDelete,
  onRename,
}: Props) {
  return (
    <div style={{ padding: '32px 32px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--fg-primary)', margin: 0, letterSpacing: '-0.02em' }}>
          Projects
        </h1>
        <button
          onClick={onNew}
          className="iridescent-button"
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 500,
            background: '#ffffff',
            color: '#0c0c0c',
            border: '1px solid rgba(255,255,255,0.92)',
            borderRadius: 7, cursor: 'pointer',
            padding: '7px 16px',
            boxShadow: '0 6px 18px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.92)',
            transition: 'transform 0.15s, filter 0.15s, box-shadow 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Project
        </button>
      </div>

      {(storageQuota?.warningLevel === 'warning' || storageQuota?.warningLevel === 'critical' || storageQuota?.warningLevel === 'limit') && (
        <div style={{ marginBottom: 20, maxWidth: 520 }}>
          <StorageQuotaBanner
            quota={storageQuota}
            loading={storageQuotaLoading}
            title="Account storage"
          />
        </div>
      )}

      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', opacity: 0.4 }}>
              <div style={{ aspectRatio: '16/9', background: 'var(--bg-panel)' }} />
              <div style={{ padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ height: 12, width: '60%', background: 'var(--bg-elevated)', borderRadius: 4 }} />
                <div style={{ height: 10, width: '40%', background: 'var(--bg-elevated)', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div style={{ paddingTop: 80, textAlign: 'center', color: 'var(--fg-muted)' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5">
              <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
            </svg>
          </div>
          <p style={{ fontSize: 14, marginBottom: 6, color: 'var(--fg-secondary)' }}>No projects yet</p>
          <p style={{ fontSize: 13 }}>Click New Project to get started</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
          {projects.map(p => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} onDelete={onDelete} onRename={onRename} />
          ))}
        </div>
      )}
    </div>
  );
}

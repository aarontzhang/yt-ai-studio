'use client';

import { useEditorStore } from '@/lib/useEditorStore';

export default function SaveIndicator() {
  const saveStatus = useEditorStore(s => s.saveStatus);
  const currentProjectId = useEditorStore(s => s.currentProjectId);

  if (!currentProjectId || saveStatus === 'idle') return null;

  const label = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save failed';
  const color = saveStatus === 'saving' ? 'var(--fg-muted)' : saveStatus === 'saved' ? 'var(--accent-strong)' : '#f87171';

  return (
    <span style={{ fontSize: 11, color, transition: 'color 0.3s', display: 'flex', alignItems: 'center', gap: 4 }}>
      {saveStatus === 'saved' && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      )}
      {label}
    </span>
  );
}

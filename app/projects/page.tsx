'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ProjectDashboard from '@/components/projects/ProjectDashboard';
import { useAuth } from '@/components/auth/AuthProvider';
import UserProfileMenu from '@/components/auth/UserProfileMenu';
import AutocutMark from '@/components/branding/AutocutMark';
import { useStorageQuota } from '@/lib/useStorageQuota';
import { capture } from '@/lib/analytics';

export interface Project {
  id: string;
  name: string;
  video_filename: string | null;
  video_size: number | null;
  video_path: string | null;
  thumbnailUrl: string | null;
  created_at: string;
  updated_at: string;
}

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const router = useRouter();
  const { quota, loading: quotaLoading, refresh: refreshQuota } = useStorageQuota(Boolean(user));

  const loadProjects = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/projects', { cache: 'no-store' });
      if (!response.ok) {
        setProjects([]);
        return;
      }

      const data = await response.json();
      setProjects(Array.isArray(data) ? data : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProjects();
  }, []);

  const handleNew = async () => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Untitled Project', edit_state: {} }),
    });
    if (!res.ok) return;

    const { id } = await res.json();
    capture('project_created', { project_id: id });
    router.push(`/editor?project=${id}`);
  };

  const handleOpen = (id: string) => {
    const project = projects.find(p => p.id === id);
    capture('project_opened', { project_id: id, has_video: Boolean(project?.video_path) });
    router.push(`/editor?project=${id}`);
  };

  const handleDelete = async (id: string) => {
    capture('project_deleted', { project_id: id });
    const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    if (!response.ok) {
      await loadProjects();
      return;
    }

    setProjects(prev => prev.filter(p => p.id !== id));
    await refreshQuota();
  };

  const handleRename = async (id: string, name: string) => {
    await fetch(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    capture('project_renamed', { project_id: id });
    setProjects(prev => prev.map(p => p.id === id ? { ...p, name } : p));
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{
        height: 52, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', padding: '0 24px', gap: 12,
      }}>
        <AutocutMark size={24} />
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg-primary)', letterSpacing: '-0.02em' }}>Autocut</span>
        <div style={{ flex: 1 }} />
        {user && <UserProfileMenu user={user} dashboardLabel="Go to Dashboard" />}
      </div>

      <ProjectDashboard
        projects={projects}
        loading={loading}
        storageQuota={quota}
        storageQuotaLoading={quotaLoading}
        onNew={handleNew}
        onOpen={handleOpen}
        onDelete={handleDelete}
        onRename={handleRename}
      />
    </div>
  );
}

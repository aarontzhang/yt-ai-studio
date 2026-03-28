'use client';

import { Suspense, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import EditorLayout from '@/components/editor/EditorLayout';

function EditorPageContent() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get('project');
  const router = useRouter();

  useEffect(() => {
    if (!projectId) router.replace('/projects');
  }, [projectId, router]);

  if (!projectId) return null;
  return <EditorLayout projectId={projectId} />;
}

export default function EditorPage() {
  return (
    <Suspense>
      <EditorPageContent />
    </Suspense>
  );
}

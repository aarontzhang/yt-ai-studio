import { redirect } from 'next/navigation';

export default function ProjectsPage() {
  redirect('/content');
}

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

import YTShell from '@/components/shell/YTShell';

export default function ContentPage() {
  return (
    <YTShell>
      {/* Phase 2: ChannelContentPage component renders here */}
      <div className="text-yt-primary font-yt text-2xl font-normal">
        Channel content
      </div>
      <p className="text-yt-secondary font-yt text-sm mt-2">
        Phase 2 will render the full channel content page here.
      </p>
    </YTShell>
  );
}

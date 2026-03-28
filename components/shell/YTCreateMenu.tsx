'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface YTCreateMenuProps {
  onUploadClick?: () => void;
}

export default function YTCreateMenu({ onUploadClick }: YTCreateMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="flex items-center gap-1.5 px-4 rounded-yt-button border border-yt-border
                     text-yt-primary text-sm font-yt font-medium hover:bg-yt-hover
                     focus-visible:outline-2 focus-visible:outline-[#3ea6ff] focus-visible:outline-offset-2
                     transition-colors"
          style={{ height: '36px' }}
          aria-label="Create"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
          </svg>
          Create
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-[200] min-w-[180px] rounded-yt-dropdown bg-yt-elevated
                     shadow-[0_8px_24px_rgba(0,0,0,0.4)] border border-yt-border
                     py-2 outline-none animate-in fade-in-0 zoom-in-95"
        >
          <DropdownMenu.Item
            onSelect={onUploadClick}
            className="flex items-center px-4 py-2.5 text-sm text-yt-primary font-yt
                       hover:bg-yt-hover cursor-pointer outline-none
                       focus:bg-yt-hover"
          >
            Upload videos
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex items-center px-4 py-2.5 text-sm text-yt-primary font-yt
                       hover:bg-yt-hover cursor-pointer outline-none
                       focus:bg-yt-hover"
          >
            Go live
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

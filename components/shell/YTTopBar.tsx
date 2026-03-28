'use client';

import Link from 'next/link';
import YTCreateMenu from './YTCreateMenu';

interface YTTopBarProps {
  onUploadClick?: () => void;
}

export default function YTTopBar({ onUploadClick }: YTTopBarProps) {
  return (
    <header
      role="banner"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between
                 bg-yt-base border-b border-yt-border shrink-0 px-4"
      style={{ height: 'var(--yt-topbar-height)' }}
    >
      {/* Left: hamburger + logo */}
      <div className="flex items-center gap-4">
        {/* Hamburger — non-functional */}
        <button
          className="p-2 rounded-full hover:bg-yt-hover text-yt-primary
                     focus-visible:outline-2 focus-visible:outline-[#3ea6ff]"
          aria-label="Menu"
          onClick={() => {}}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z" />
          </svg>
        </button>

        {/* Logo: links to /content */}
        <Link href="/content" className="flex items-center gap-1.5" aria-label="YouTube Studio home">
          {/* YouTube play button logo mark — red rectangle with white triangle */}
          <svg
            width="28"
            height="20"
            viewBox="0 0 28 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="28" height="20" rx="4" fill="#FF0000" />
            <path d="M11 5.5L20 10L11 14.5V5.5Z" fill="white" />
          </svg>
          <span className="text-yt-primary font-yt font-medium text-sm leading-none tracking-[-0.01em]">
            Studio
          </span>
        </Link>
      </div>

      {/* Center: search bar — non-functional */}
      <div className="flex-1 mx-8 max-w-lg">
        <div
          className="flex items-center border border-yt-border-input rounded-[20px] px-4 bg-yt-overlay"
          style={{ height: '40px' }}
        >
          {/* Search icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="text-yt-muted mr-2 shrink-0"
            aria-hidden="true"
          >
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            type="text"
            placeholder="Search across your channel"
            readOnly
            className="bg-transparent text-sm text-yt-secondary placeholder:text-yt-muted
                       outline-none w-full font-yt cursor-default"
            tabIndex={-1}
          />
        </div>
      </div>

      {/* Right: info + notifications + Create + avatar */}
      <div className="flex items-center gap-2">
        {/* Info icon — non-functional */}
        <button
          className="p-2 rounded-full hover:bg-yt-hover text-yt-primary
                     focus-visible:outline-2 focus-visible:outline-[#3ea6ff]"
          aria-label="Help"
          onClick={() => {}}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
        </button>

        {/* Notifications — non-functional */}
        <button
          className="p-2 rounded-full hover:bg-yt-hover text-yt-primary
                     focus-visible:outline-2 focus-visible:outline-[#3ea6ff]"
          aria-label="Notifications"
          onClick={() => {}}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
          </svg>
        </button>

        {/* Create button — opens dropdown */}
        <YTCreateMenu onUploadClick={onUploadClick} />

        {/* Avatar */}
        <button
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center
                     focus-visible:outline-2 focus-visible:outline-[#3ea6ff]"
          style={{ background: 'linear-gradient(135deg, #4285F4, #34A853)' }}
          aria-label="Account"
          onClick={() => {}}
        >
          <span className="text-white font-yt text-xs font-medium">F</span>
        </button>
      </div>
    </header>
  );
}

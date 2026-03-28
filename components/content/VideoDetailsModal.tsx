'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const STEPS = ['Details', 'Video elements', 'Initial check', 'Visibility'] as const;

interface VideoDetailsModalProps {
  open: boolean;
  onClose: () => void;
  videoTitle?: string;
}

/* ─── Stepper track ──────────────────────────────────────────── */
function StepperTrack({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center border-b border-yt-border" style={{ padding: '0 24px' }}>
      {STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        return (
          <React.Fragment key={step}>
            {i > 0 && (
              <div className="flex-1 mx-2" style={{ height: 4, background: '#3d3d3d', borderRadius: 2 }}>
                <div
                  style={{
                    height: '100%', borderRadius: 2,
                    background: isCompleted ? '#ffffff' : 'transparent',
                    transition: 'background 300ms ease',
                  }}
                />
              </div>
            )}
            <div className="flex flex-col items-center relative" style={{ padding: '12px 24px' }}>
              <span
                className="font-yt"
                style={{
                  fontSize: 14, fontWeight: 500,
                  color: isActive ? '#ffffff' : '#aaaaaa',
                  letterSpacing: '0.2px',
                }}
              >
                {step}
              </span>
              <div
                className="mt-2"
                style={{
                  width: isActive ? 12 : 8,
                  height: isActive ? 12 : 8,
                  borderRadius: '50%',
                  background: isCompleted ? 'transparent' : isActive ? '#ffffff' : '#3d3d3d',
                  border: isCompleted ? '2px solid #ffffff' : isActive ? '2px solid #ffffff' : 'none',
                  transition: 'all 200ms ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {isCompleted && (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#ffffff" width="14" height="14">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                  </svg>
                )}
              </div>
              {isActive && (
                <span
                  className="absolute bottom-0 left-0 right-0"
                  style={{ height: 2, background: '#ffffff' }}
                />
              )}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ─── Details step ───────────────────────────────────────────── */
function DetailsStep() {
  const [title, setTitle] = useState('');
  return (
    <div style={{ padding: '24px' }}>
      {/* Title input with floating label */}
      <div className="relative" style={{ marginBottom: 24 }}>
        <label
          className="font-yt absolute left-4 transition-all pointer-events-none"
          style={{
            top: title ? 8 : 16,
            fontSize: title ? 11 : 14,
            color: '#aaaaaa',
          }}
        >
          Title (required) <span className="text-yt-muted">ⓘ</span>
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={100}
          className="w-full font-yt text-yt-primary bg-transparent border border-yt-border-input focus:border-yt-blue focus:border-2"
          style={{
            fontSize: 14,
            padding: title ? '24px 16px 8px' : '16px',
            borderRadius: 4,
            outline: 'none',
            caretColor: '#3ea6ff',
          }}
        />
        <span
          className="absolute right-4 bottom-2 font-yt text-yt-secondary"
          style={{ fontSize: 12 }}
        >
          {title.length}/100
        </span>
      </div>

      {/* Description */}
      <div className="relative" style={{ marginBottom: 24 }}>
        <label className="font-yt absolute left-4 top-4 text-yt-secondary pointer-events-none" style={{ fontSize: 14 }}>
          Description <span className="text-yt-muted">ⓘ</span>
        </label>
        <textarea
          className="w-full font-yt text-yt-primary bg-transparent border border-yt-border-input focus:border-yt-blue focus:border-2"
          style={{
            minHeight: 120,
            fontSize: 14,
            padding: '36px 16px 12px',
            borderRadius: 4,
            resize: 'vertical',
            outline: 'none',
            caretColor: '#3ea6ff',
          }}
          placeholder="Tell viewers about your video (type @ to mention a channel)"
        />
      </div>

      {/* Thumbnail */}
      <div style={{ marginBottom: 24 }}>
        <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Thumbnail</h3>
        <div className="flex items-center gap-3 bg-yt-overlay rounded" style={{ padding: '12px 16px' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <span className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>
            You can change the thumbnail in the YouTube mobile app
          </span>
        </div>
      </div>

      {/* Playlists */}
      <div style={{ marginBottom: 24 }}>
        <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Playlists</h3>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 12 }}>
          Add your video to one or more playlists to organize your content for viewers.{' '}
          <span className="text-yt-link cursor-pointer">Learn more</span>
        </p>
        <button
          className="font-yt text-yt-primary bg-transparent border border-yt-border-input flex items-center justify-between cursor-pointer"
          style={{ padding: '12px 16px', borderRadius: 4, width: 200, fontSize: 14 }}
        >
          Select
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      </div>

      {/* Audience */}
      <div style={{ marginBottom: 24 }}>
        <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Audience</h3>
        <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
          Is this video made for kids? (required)
        </p>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 12, lineHeight: '20px' }}>
          Regardless of your location, you&apos;re legally required to comply with the Children&apos;s Online Privacy Protection Act (COPPA) and/or other laws. You&apos;re required to tell us whether your videos are made for kids.{' '}
          <span className="text-yt-link cursor-pointer">What&apos;s content made for kids?</span>
        </p>

        {/* Info banner */}
        <div className="flex gap-3 bg-yt-overlay rounded" style={{ padding: '12px 16px', marginBottom: 16 }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary shrink-0 mt-0.5">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
          </svg>
          <p className="font-yt text-yt-secondary" style={{ fontSize: 14, lineHeight: '20px' }}>
            Features like personalized ads and notifications won&apos;t be available on videos made for kids. Videos that are set as made for kids by you are more likely to be recommended alongside other kids&apos; videos.{' '}
            <span className="text-yt-link cursor-pointer">Learn more</span>
          </p>
        </div>

        {/* Radio buttons */}
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="audience" className="w-5 h-5" style={{ accentColor: '#3ea6ff' }} />
            <span className="font-yt text-yt-primary" style={{ fontSize: 14 }}>Yes, it&apos;s made for kids</span>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="audience" defaultChecked className="w-5 h-5" style={{ accentColor: '#3ea6ff' }} />
            <span className="font-yt text-yt-primary" style={{ fontSize: 14 }}>No, it&apos;s not made for kids</span>
          </label>
        </div>

        {/* Age restriction accordion */}
        <button className="flex items-center gap-2 mt-4 w-full text-left font-yt text-yt-primary bg-transparent border-none cursor-pointer" style={{ fontSize: 14, fontWeight: 500, padding: '12px 0' }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary transition-transform duration-200">
            <path d="M7 10l5 5 5-5z" />
          </svg>
          Age restriction (advanced)
        </button>
      </div>

      {/* Show more button */}
      <button
        className="font-yt cursor-pointer"
        style={{
          background: 'transparent',
          color: '#3ea6ff',
          fontSize: 14,
          fontWeight: 500,
          padding: '8px 16px',
          borderRadius: 18,
          border: 'none',
        }}
      >
        Show more
      </button>
      <p className="font-yt text-yt-secondary mt-2" style={{ fontSize: 12 }}>
        Paid promotion, collaboration, subtitles, and more
      </p>
    </div>
  );
}

/* ─── Video Elements step ────────────────────────────────────── */
function VideoElementsStep() {
  return (
    <div style={{ padding: '24px' }}>
      <h2 className="font-yt text-yt-primary" style={{ fontSize: 24, fontWeight: 400, marginBottom: 8 }}>Video elements</h2>
      <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 24, lineHeight: '20px' }}>
        Use cards and an end screen to show viewers related videos, websites, and calls to action.{' '}
        <span className="text-yt-link cursor-pointer">Learn more</span>
      </p>

      {/* Add related video */}
      <div className="flex items-center justify-between border border-yt-border-subtle rounded-lg" style={{ padding: '20px 24px', marginBottom: 16 }}>
        <div className="flex items-center gap-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32" className="text-yt-secondary">
            <path d="M8 5v14l11-7z" />
          </svg>
          <div>
            <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>Add related video</p>
            <p className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>Connect another of your videos to your video</p>
          </div>
        </div>
        <button
          className="font-yt cursor-pointer"
          style={{
            background: '#3ea6ff', color: '#0f0f0f',
            fontSize: 14, fontWeight: 500, padding: '8px 16px',
            borderRadius: 18, border: 'none',
          }}
        >
          Add
        </button>
      </div>

      {/* Add subtitles */}
      <div className="flex items-center justify-between border border-yt-border-subtle rounded-lg" style={{ padding: '20px 24px' }}>
        <div className="flex items-center gap-4">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="32" height="32" className="text-yt-secondary">
            <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-6 14H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H8v-2h12v2zm0-4H4V8h16v2z" />
          </svg>
          <div>
            <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>Add subtitles</p>
            <p className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>Reach a broader audience by adding subtitles to your video</p>
          </div>
        </div>
        <button
          className="font-yt cursor-pointer"
          style={{
            background: '#3ea6ff', color: '#0f0f0f',
            fontSize: 14, fontWeight: 500, padding: '8px 16px',
            borderRadius: 18, border: 'none',
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ─── Initial Check step ─────────────────────────────────────── */
function InitialCheckStep() {
  return (
    <div style={{ padding: '24px' }}>
      <h2 className="font-yt text-yt-primary" style={{ fontSize: 24, fontWeight: 400, marginBottom: 8 }}>Initial check</h2>
      <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 24, lineHeight: '20px' }}>
        We&apos;ll check for issues that could restrict your video&apos;s visibility.{' '}
        <span className="text-yt-link cursor-pointer">Learn more</span>
      </p>

      {/* Copyright */}
      <div className="border-b border-yt-border-subtle" style={{ paddingBottom: 20, marginBottom: 20 }}>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Copyright</h3>
            <p className="font-yt text-yt-secondary" style={{ fontSize: 14, lineHeight: '20px' }}>
              Your Short&apos;s visibility is not affected. The copyright-protected content detected doesn&apos;t affect your Short.{' '}
              <span className="text-yt-link cursor-pointer">Learn more</span>
            </p>
          </div>
          <button
            className="font-yt cursor-pointer shrink-0 ml-4"
            style={{
              background: 'transparent', color: '#3ea6ff',
              fontSize: 14, fontWeight: 500, padding: '8px 16px',
              borderRadius: 18, border: '1px solid #3d3d3d',
            }}
          >
            See details
          </button>
        </div>
      </div>

      {/* Community Guidelines */}
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Community Guidelines</h3>
            <div className="flex items-center gap-2">
              <p className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>
                Checking for early issues with some of our policies
              </p>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="text-yt-muted">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {/* Spinner */}
            <div
              className="animate-spin rounded-full border-2 border-yt-border-subtle"
              style={{ width: 20, height: 20, borderTopColor: '#3ea6ff' }}
            />
            <span className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>5 minutes left</span>
          </div>
        </div>
      </div>

      {/* Send feedback */}
      <button
        className="font-yt cursor-pointer mt-8"
        style={{
          background: 'transparent', color: '#3ea6ff',
          fontSize: 14, fontWeight: 500, padding: 0,
          border: 'none',
        }}
      >
        Send feedback
      </button>
    </div>
  );
}

/* ─── Visibility step ────────────────────────────────────────── */
function VisibilityStep() {
  const [visibility, setVisibility] = useState('unlisted');

  return (
    <div style={{ padding: '24px' }}>
      <h2 className="font-yt text-yt-primary" style={{ fontSize: 24, fontWeight: 400, marginBottom: 8 }}>Visibility</h2>
      <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 24 }}>
        Choose when to publish and who can see your video
      </p>

      {/* Info banner */}
      <div className="flex gap-3 bg-yt-overlay rounded" style={{ padding: '12px 16px', marginBottom: 24 }}>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary shrink-0 mt-0.5">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" />
        </svg>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>
          We recommend keeping this video private and not sharing it until checks are complete.
        </p>
      </div>

      {/* Save or publish section */}
      <div className="border border-yt-border-subtle rounded-lg" style={{ padding: '20px 24px', marginBottom: 24 }}>
        <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>Save or publish</h3>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 14, marginBottom: 16 }}>
          Make your video <strong>public</strong>, <strong>unlisted</strong>, or <strong>private</strong>
        </p>

        {/* Radio buttons */}
        <div className="flex flex-col gap-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio" name="visibility" value="private"
              checked={visibility === 'private'}
              onChange={() => setVisibility('private')}
              className="mt-1 w-5 h-5" style={{ accentColor: '#3ea6ff' }}
            />
            <div>
              <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>Private</p>
              <p className="font-yt text-yt-secondary" style={{ fontSize: 12 }}>Only you and people you choose can watch your video</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio" name="visibility" value="unlisted"
              checked={visibility === 'unlisted'}
              onChange={() => setVisibility('unlisted')}
              className="mt-1 w-5 h-5" style={{ accentColor: '#3ea6ff' }}
            />
            <div>
              <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>Unlisted</p>
              <p className="font-yt text-yt-secondary" style={{ fontSize: 12 }}>Anyone with the video link can watch your video</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="radio" name="visibility" value="public"
              checked={visibility === 'public'}
              onChange={() => setVisibility('public')}
              className="mt-1 w-5 h-5" style={{ accentColor: '#3ea6ff' }}
            />
            <div>
              <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500 }}>Public</p>
              <p className="font-yt text-yt-secondary" style={{ fontSize: 12 }}>Everyone can watch your video</p>
            </div>
          </label>
        </div>
      </div>

      {/* Schedule accordion */}
      <div className="border border-yt-border-subtle rounded-lg" style={{ padding: '16px 24px', marginBottom: 24 }}>
        <button className="flex items-center justify-between w-full font-yt text-yt-primary bg-transparent border-none cursor-pointer" style={{ fontSize: 14, fontWeight: 500 }}>
          <div>
            <p style={{ margin: 0 }}>Schedule</p>
            <p className="font-yt text-yt-secondary" style={{ fontSize: 12, fontWeight: 400, margin: '4px 0 0' }}>
              Select a date to make your video <strong>public</strong>.
            </p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24" className="text-yt-secondary transition-transform duration-200">
            <path d="M7 10l5 5 5-5z" />
          </svg>
        </button>
      </div>

      {/* Before you publish checklist */}
      <div style={{ marginTop: 24 }}>
        <h3 className="font-yt text-yt-primary" style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>
          Before you publish, check the following:
        </h3>

        <div style={{ marginBottom: 16 }}>
          <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            Do kids appear in this video?
          </p>
          <p className="font-yt text-yt-secondary" style={{ fontSize: 14, lineHeight: '20px' }}>
            Make sure you follow our policies to protect minors from harm, exploitation, bullying, and violations of labor law.{' '}
            <span className="text-yt-link cursor-pointer">Learn more</span>
          </p>
        </div>

        <div>
          <p className="font-yt text-yt-primary" style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
            Looking for overall content guidance?
          </p>
          <p className="font-yt text-yt-secondary" style={{ fontSize: 14, lineHeight: '20px' }}>
            Our Community Guidelines can help you avoid trouble and ensure that YouTube remains a safe and vibrant community.{' '}
            <span className="text-yt-link cursor-pointer">Learn more</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/* ─── Right sidebar — video preview ──────────────────────────── */
function VideoPreviewSidebar({ videoTitle }: { videoTitle: string }) {
  return (
    <div
      className="border-l border-yt-border overflow-y-auto"
      style={{ width: '40%', padding: 24 }}
    >
      {/* Video player placeholder */}
      <div
        className="bg-yt-overlay rounded relative flex items-center justify-center"
        style={{ width: '100%', aspectRatio: '16/9', marginBottom: 16 }}
      >
        <span className="font-yt text-yt-secondary" style={{ fontSize: 14 }}>Processing will begin shortly</span>
      </div>

      {/* Video link */}
      <div style={{ marginBottom: 16 }}>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 12, marginBottom: 4 }}>Video link</p>
        <div className="flex items-center gap-2">
          <span className="font-yt text-yt-link" style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            https://youtube.com/shorts/S9...
          </span>
          <button className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1 shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filename */}
      <div>
        <p className="font-yt text-yt-secondary" style={{ fontSize: 12, marginBottom: 4 }}>Filename</p>
        <p className="font-yt text-yt-primary" style={{ fontSize: 14 }}>{videoTitle || 'video'}.mov</p>
      </div>
    </div>
  );
}

/* ─── Main modal ─────────────────────────────────────────────── */
export default function VideoDetailsModal({ open, onClose, videoTitle = 'Untitled' }: VideoDetailsModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === STEPS.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      onClose();
    } else {
      setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    }
  };

  const handleBack = () => {
    setCurrentStep((s) => Math.max(s - 1, 0));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent
        className="p-0 gap-0 border-yt-border bg-yt-elevated overflow-hidden"
        style={{ width: 960, maxWidth: '95vw', maxHeight: '90vh', borderRadius: 12 }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{ padding: '16px 24px', borderBottom: 'none' }}
        >
          <h2
            className="font-yt text-yt-primary"
            style={{ fontSize: 20, fontWeight: 400, margin: 0 }}
          >
            {videoTitle}
          </h2>
          <div className="flex items-center gap-3">
            <span
              className="font-yt text-yt-secondary bg-yt-overlay rounded-yt-chip"
              style={{ fontSize: 12, padding: '4px 12px', border: '1px solid #3d3d3d' }}
            >
              Saved as private
            </span>
            {/* PiP icon */}
            <button className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1" aria-label="Picture-in-picture">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
                <path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z" />
              </svg>
            </button>
            {/* Close button */}
            <button
              onClick={onClose}
              className="text-yt-secondary hover:text-yt-primary bg-transparent border-none cursor-pointer p-1"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stepper */}
        <StepperTrack currentStep={currentStep} />

        {/* Content area — 2-column layout */}
        <div className="flex" style={{ height: 'calc(90vh - 200px)', minHeight: 400 }}>
          {/* Left column — scrollable */}
          <div className="flex-1 overflow-y-auto">
            {currentStep === 0 && <DetailsStep />}
            {currentStep === 1 && <VideoElementsStep />}
            {currentStep === 2 && <InitialCheckStep />}
            {currentStep === 3 && <VisibilityStep />}
          </div>

          {/* Right column — video preview */}
          <VideoPreviewSidebar videoTitle={videoTitle} />
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t border-yt-border"
          style={{ padding: '12px 24px' }}
        >
          {/* Left — status */}
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-yt-secondary">
              <path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z" />
            </svg>
            <span className="font-yt bg-yt-overlay rounded px-1 text-yt-secondary" style={{ fontSize: 11, fontWeight: 700 }}>SD</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20" className="text-[#2ba640]">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="font-yt text-yt-secondary" style={{ fontSize: 13 }}>
              Checks running ... Copyright-protected content found.
            </span>
          </div>

          {/* Right — navigation buttons */}
          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={handleBack}
                className="font-yt cursor-pointer"
                style={{
                  background: 'transparent', color: '#3ea6ff',
                  fontSize: 14, fontWeight: 500, padding: '8px 16px',
                  borderRadius: 18, border: '1px solid #3d3d3d',
                }}
              >
                Back
              </button>
            )}
            <button
              onClick={handleNext}
              className="font-yt cursor-pointer"
              style={{
                background: '#3ea6ff', color: '#0f0f0f',
                fontSize: 14, fontWeight: 500, padding: '8px 16px',
                borderRadius: 18, border: 'none',
              }}
            >
              {isLastStep ? 'Save' : 'Next'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

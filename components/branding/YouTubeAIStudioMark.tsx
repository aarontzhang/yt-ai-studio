'use client';

/**
 * YouTube AI Studio logo mark.
 * Red rounded-rect with a white Gemini sparkle.
 */
export default function YouTubeAIStudioMark({
  size = 20,
}: {
  size?: number;
}) {
  const h = size;
  const w = size * 1.3; // aspect ratio of the icon viewBox (130:100)

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 130 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="5" y="8" width="120" height="84" rx="20" fill="#FF0000" />
      <path
        d="M 65,26 C 65,39 52,50 41,50 C 52,50 65,61 65,74 C 65,61 78,50 89,50 C 78,50 65,39 65,26 Z"
        fill="white"
      />
    </svg>
  );
}

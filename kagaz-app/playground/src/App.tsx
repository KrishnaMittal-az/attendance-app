// Waiting screen: shown before the first build and after Reset.
// Claude Code replaces this file with the app drawn in the sketch.

function SketchDoodle({ className = "" }: { className?: string }) {
  const graphite = "#78716c";
  return (
    <svg viewBox="0 0 260 230" className={className} aria-hidden="true" fill="none">
      <g transform="rotate(-3 130 115)" strokeLinecap="round" strokeLinejoin="round">
        {/* paper sheet + shadow */}
        <path
          d="M48 22H162L184 44V200Q184 206 178 206H48Q42 206 42 200V28Q42 22 48 22Z"
          transform="translate(5 7)"
          fill="#1c1917"
          opacity="0.07"
        />
        <path
          d="M48 22H162L184 44V200Q184 206 178 206H48Q42 206 42 200V28Q42 22 48 22Z"
          fill="#fffdf8"
          stroke="#d6d3d1"
          strokeWidth="1.5"
        />
        <path d="M162 22V38Q162 44 168 44H184Z" fill="#efe9dc" stroke="#d6d3d1" strokeWidth="1.5" />

        {/* pencil wireframe of an app */}
        <g stroke={graphite} strokeWidth="2.2">
          <rect x="56" y="48" width="96" height="20" rx="5" />
          <path d="M64 58q5-4 10 0t10 0t10 0" strokeWidth="2" />
          <circle cx="141" cy="58" r="4" />

          <circle cx="64" cy="88" r="5.5" />
          <path d="M61.2 88l2.2 2.4l4.2-5" stroke="#d97706" />
          <path d="M78 88q16-3 32 0t28 0" />
          <circle cx="64" cy="110" r="5.5" />
          <path d="M78 110q14-3 28 0t16 0" />
          <circle cx="64" cy="132" r="5.5" />
          <path d="M78 132q16-3 32 0t22 0" />

          <rect x="56" y="152" width="58" height="20" rx="10" fill="#fde68a" fillOpacity="0.55" />
          <path d="M81 162h8M85 158v8" />

          {/* the stroke the pencil is drawing right now */}
          <path d="M60 188q10-5 20 0t20 0t20 0t20 0" stroke="#a8a29e" />
        </g>

        {/* pencil, tip resting at the end of the stroke */}
        <g transform="translate(140 188) rotate(-38)">
          <path d="M0 0L24 9H130V-9H24Z" transform="translate(1 6)" fill="#1c1917" opacity="0.06" />
          <path d="M24 -9L0 0L24 9Z" fill="#f2d7ad" />
          <path d="M9 -3.4L0 0L9 3.4Z" fill="#44403c" />
          <path d="M28 -9H24Q20 -6 24 -3Q20 0 24 3Q20 6 24 9H28Z" fill="#fbbf24" />
          <rect x="27" y="-9" width="77" height="18" fill="#fbbf24" />
          <path d="M28 -3H104M28 3H104" stroke="#f59e0b" strokeWidth="1.2" />
          <rect x="104" y="-9" width="12" height="18" fill="#d6d3d1" />
          <path d="M108 -9V9M112 -9V9" stroke="#a8a29e" strokeWidth="1.2" />
          <path d="M116 -9H126Q131 -9 131 -4V4Q131 9 126 9H116Z" fill="#fda4af" />
        </g>

        {/* little motion marks */}
        <g stroke="#f59e0b" strokeWidth="2" opacity="0.7">
          <path d="M126 204l-6 5" />
          <path d="M138 206l-1 7" />
          <path d="M150 203l5 5" />
        </g>
      </g>
    </svg>
  );
}

export default function App() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#faf7f0] px-6 py-12 text-stone-800">
      {/* dotted notebook paper that fades out towards the edges */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(#e4ddcd_1.2px,transparent_1.2px)] [background-size:24px_24px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_20%,#faf7f0_80%)]"
      />

      <div className="relative flex max-w-2xl flex-col items-center text-center 2xl:max-w-4xl">
        <SketchDoodle className="h-auto w-56 sm:w-64 lg:w-80 2xl:w-96" />

        <h1 className="mt-8 text-3xl font-semibold tracking-tight text-stone-800 sm:text-4xl lg:text-5xl 2xl:text-6xl">
          Waiting for a sketch…
        </h1>
        <p className="mt-4 max-w-md text-base leading-relaxed text-balance text-stone-500 sm:text-lg lg:max-w-xl lg:text-xl 2xl:max-w-2xl 2xl:text-2xl">
          Draw an app on paper, snap a photo&nbsp;— Claude Code will build it right here.
        </p>

        <div className="mt-10 flex items-center gap-3" role="status" aria-label="Waiting for a sketch">
          <span className="size-2.5 rounded-full bg-amber-500 motion-safe:animate-pulse lg:size-3" />
          <span className="size-2.5 rounded-full bg-amber-500 motion-safe:animate-pulse [animation-delay:300ms] lg:size-3" />
          <span className="size-2.5 rounded-full bg-amber-500 motion-safe:animate-pulse [animation-delay:600ms] lg:size-3" />
        </div>
      </div>
    </main>
  );
}

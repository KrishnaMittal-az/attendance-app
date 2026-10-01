import { IconAlert } from "./icons";

export function ErrorBanner({
  message,
  hint = "Try again, or press Reset to start fresh.",
}: {
  message: string;
  hint?: string;
}) {
  return (
    <div role="alert" className="flex shrink-0 animate-fade-in gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-2.5">
      <IconAlert className="mt-0.5 size-5 shrink-0 text-red-300" />
      <div className="min-w-0">
        <p className="line-clamp-2 break-words text-[0.9375rem] font-medium leading-snug text-red-200" title={message}>
          {message}
        </p>
        <p className="mt-0.5 text-sm text-red-200/60">{hint}</p>
      </div>
    </div>
  );
}

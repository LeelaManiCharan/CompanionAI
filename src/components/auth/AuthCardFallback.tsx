import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Static placeholder while an auth form reads its URL parameters. */
export function AuthCardFallback() {
  const bar = "relative overflow-hidden rounded-md bg-surface-2/60";
  const sheen =
    "before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer " +
    "before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent";
  return (
    <Card aria-busy="true" className="px-6 py-7 shadow-elevated sm:px-8">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className={cn(bar, sheen, "h-3 w-20")} />
        <div className={cn(bar, sheen, "h-6 w-40")} />
        <div className={cn(bar, sheen, "mt-4 h-10 w-full")} />
        <div className={cn(bar, sheen, "h-10 w-full")} />
        <div className={cn(bar, sheen, "mt-2 h-11 w-full")} />
      </div>
    </Card>
  );
}

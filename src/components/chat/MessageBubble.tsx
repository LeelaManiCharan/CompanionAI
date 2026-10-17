import type { Message } from "@/core/models";
import { cn } from "@/lib/cn";
import { clockTime, fullDateTime } from "./format";

/** Small companion avatar: the Bot_Name initial on soft green. */
export function BotAvatar({
  botName,
  size = "sm",
  className,
}: {
  botName: string;
  size?: "sm" | "lg";
  className?: string;
}) {
  const initial = botName.trim().charAt(0).toUpperCase() || "C";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full border border-primary/15 bg-accent",
        "font-semibold text-primary-deep",
        size === "lg" ? "size-14 text-[20px]" : "size-7 text-[12px]",
        className,
      )}
    >
      {initial}
    </span>
  );
}

export type MessageBubbleProps = {
  message: Message;
  botName: string;
  /** First message of a run from the same sender (adds a little space above). */
  groupStart: boolean;
  /** Last message of a run from the same sender (shows avatar, tail, and timestamp). */
  groupEnd: boolean;
};

/**
 * One Message. Companion on the left (white, hairline border, avatar), user on
 * the right (dark green, white text). Whitespace is preserved as typed (20.23).
 */
export function MessageBubble({ message, botName, groupStart, groupEnd }: MessageBubbleProps) {
  const isUser = message.role === "user";
  return (
    <li
      className={cn(
        "flex items-end gap-2.5",
        isUser ? "justify-end" : "justify-start",
        groupStart && "pt-1",
        groupEnd ? "mb-4" : "mb-1",
      )}
    >
      {!isUser ? (
        groupEnd ? (
          <BotAvatar botName={botName} className="mb-[22px] self-end" />
        ) : (
          <span aria-hidden="true" className="w-7 shrink-0" />
        )
      ) : null}

      <div className={cn("flex min-w-0 max-w-[85%] flex-col sm:max-w-[72%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-[14px] px-3.5 py-2.5 text-[15px] leading-[1.55]",
            "whitespace-pre-wrap [overflow-wrap:anywhere]",
            isUser
              ? "bg-primary text-white shadow-[0_1px_1px_rgb(15_61_34/0.25)]"
              : "border border-border bg-bg text-text shadow-card",
            isUser
              ? groupEnd
                ? "rounded-br-[5px]"
                : null
              : groupEnd
                ? "rounded-bl-[5px]"
                : null,
          )}
        >
          <span className="sr-only">{isUser ? "You said: " : `${botName} said: `}</span>
          {message.content}
        </div>
        {groupEnd ? (
          <time
            dateTime={message.createdAt}
            title={fullDateTime(message.createdAt)}
            className={cn("mt-1 px-1 font-mono text-[11px] tabular-nums text-muted", isUser ? "text-right" : "text-left")}
          >
            {isUser ? "You" : botName} · {clockTime(message.createdAt)}
          </time>
        ) : null}
      </div>
    </li>
  );
}

/** Three bouncing dots in a companion bubble while a reply is pending (4.3). */
export function TypingIndicator({ botName }: { botName: string }) {
  return (
    <li className="mb-4 flex items-end gap-2.5" role="status" aria-live="polite">
      <BotAvatar botName={botName} />
      <div className="flex h-[42px] items-center gap-1 rounded-[14px] rounded-bl-[5px] border border-border bg-bg px-4 shadow-card">
        <span className="sr-only">{botName} is typing</span>
        {[0, 160, 320].map((delay) => (
          <span
            key={delay}
            aria-hidden="true"
            className="size-1.5 animate-typing-dot rounded-full bg-muted"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </div>
    </li>
  );
}

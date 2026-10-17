"use client";

import { AppShell, useActiveProfile, useSettings } from "@/components/app";
import {
  BackupSummaryCard,
  CheckInHeroCard,
  CheckInPromptBanner,
  QuickLinksCard,
  RecentChatsCard,
  dayPart,
  useNow,
} from "@/components/home";
import { InlineAlert } from "@/components/ui";
import { localDate } from "@/core/schedule";
import { homeChatList } from "@/core/selectors";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { currentTimeZone } from "@/services/activityTracker";
import { getPreferredTime, getTodayCheckIn } from "@/services/scheduler";
import { useCallElsewhere } from "@/services/useTabState";

/** Home_Page (Req 3): greeting, today's check-in, recent conversations, backup and shortcuts. */
export default function HomePage() {
  const profile = useActiveProfile();
  const settings = useSettings();
  const repo = useRepo();
  const nowMs = useNow();
  const callElsewhere = useCallElsewhere();
  const profileId = profile.id;

  // Re-read when the local date rolls over so "today" stays correct (3.5, 20.13).
  const today = nowMs ? localDate(new Date(nowMs).toISOString(), currentTimeZone()) : "";

  const checkIn = useLiveQuery(
    async () => {
      const [preferredTime, record] = await Promise.all([getPreferredTime(profileId), getTodayCheckIn(profileId)]);
      return { preferredTime, record };
    },
    ["checkIns", "settings", "activityLogs"],
    [profileId, today],
  );

  const chats = useLiveQuery(
    async () => {
      if (!repo) return [];
      const list = await repo.listChats(profileId);
      // Only the newest message of each Chat is needed to order the list.
      const latest = await Promise.all(list.map((c) => repo.messagesByChat(c.id, { limit: 1 })));
      return homeChatList(list, latest.flat(), profileId);
    },
    ["chats", "messages"],
    [repo, profileId],
  );

  const loadFailed = Boolean(checkIn.error || chats.error);

  return (
    <AppShell>
      <CheckInPromptBanner callElsewhere={callElsewhere} />

      <header className="mb-8">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Home</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-[1.15] tracking-[-0.035em] text-text sm:text-[34px]">
          Good {nowMs ? dayPart(nowMs) : "day"}, {profile.displayName}
        </h1>
        <p className="mt-1.5 text-[15px] text-muted">{settings.botName} is here when you are.</p>
      </header>

      {loadFailed ? (
        <InlineAlert tone="danger" title="Some of your data couldn't be loaded" className="mb-6">
          Calls, chats, settings, profiles and backup are still available. Nothing stored was changed.
        </InlineAlert>
      ) : null}

      <CheckInHeroCard
        botName={settings.botName}
        preferredTime={checkIn.data?.preferredTime}
        today={checkIn.error ? null : checkIn.data?.record}
        loading={checkIn.loading}
        nowMs={nowMs}
        callElsewhere={callElsewhere}
      />

      <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_320px] md:items-start">
        <RecentChatsCard
          botName={settings.botName}
          items={chats.data}
          loading={chats.loading}
          failed={Boolean(chats.error)}
          nowMs={nowMs}
        />
        <aside aria-label="Backup and shortcuts" className="flex flex-col gap-6">
          <BackupSummaryCard nowMs={nowMs} />
          <QuickLinksCard />
        </aside>
      </div>
    </AppShell>
  );
}

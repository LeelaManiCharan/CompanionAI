import type { SVGProps } from "react";

/**
 * Inline stroke icons on a 24px grid, 1.75px stroke, `currentColor`.
 * Decorative by default (aria-hidden). Pass `title` to make one meaningful.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  title?: string;
};

function createIcon(name: string, paths: React.ReactNode) {
  function Icon({ size = 18, title, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
        {...rest}
      >
        {title ? <title>{title}</title> : null}
        {paths}
      </svg>
    );
  }
  Icon.displayName = `Icon${name}`;
  return Icon;
}

export const IconPhone = createIcon(
  "Phone",
  <path d="M5 4h3.2l1.6 4-2 1.3a11 11 0 0 0 6.9 6.9l1.3-2 4 1.6V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />,
);

export const IconPhoneOff = createIcon(
  "PhoneOff",
  <>
    <path d="M10.7 13.3a11 11 0 0 0 4 2.9l1.3-2 4 1.6V19a2 2 0 0 1-2 2 16 16 0 0 1-9.9-4.1" />
    <path d="M5.2 14.4A16 16 0 0 1 3 6a2 2 0 0 1 2-2h3.2l1.6 4-2 1.3c.3.8.7 1.6 1.2 2.3" />
    <path d="M3 21 21 3" />
  </>,
);

export const IconMic = createIcon(
  "Mic",
  <>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </>,
);

export const IconMicOff = createIcon(
  "MicOff",
  <>
    <path d="M15 10V6a3 3 0 0 0-5.7-1.3" />
    <path d="M9 9v2a3 3 0 0 0 4.9 2.3" />
    <path d="M18.5 11a6.5 6.5 0 0 1-.7 2.9M16 16.2A6.5 6.5 0 0 1 5.5 11" />
    <path d="M12 17.5V21" />
    <path d="M3 3l18 18" />
  </>,
);

export const IconMessage = createIcon(
  "Message",
  <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l.9-4.4A8 8 0 1 1 20 12Z" />,
);

export const IconSettings = createIcon(
  "Settings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </>,
);

export const IconUsers = createIcon(
  "Users",
  <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </>,
);

export const IconCloudUpload = createIcon(
  "CloudUpload",
  <>
    <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5" />
    <path d="M12 12v8" />
    <path d="m9 15 3-3 3 3" />
  </>,
);

export const IconCloudDownload = createIcon(
  "CloudDownload",
  <>
    <path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5" />
    <path d="M12 12v8" />
    <path d="m9 17 3 3 3-3" />
  </>,
);

export const IconTrash = createIcon(
  "Trash",
  <>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" />
  </>,
);

export const IconPlus = createIcon("Plus", <path d="M12 5v14M5 12h14" />);

export const IconChevronLeft = createIcon("ChevronLeft", <path d="m15 18-6-6 6-6" />);

export const IconHelp = createIcon(
  "Help",
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="3.5" />
    <path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M14.5 9.5l3.9-3.9M5.6 18.4l3.9-3.9" />
  </>,
);
/** Alias: the help icon is a life-buoy. */
export const IconLifeBuoy = IconHelp;

export const IconBrain = createIcon(
  "Brain",
  <>
    <path d="M9.5 4A2.5 2.5 0 0 0 7 6.5a3 3 0 0 0-2.5 4.2A3 3 0 0 0 5.5 16 3 3 0 0 0 9.5 19.5V4Z" />
    <path d="M14.5 4A2.5 2.5 0 0 1 17 6.5a3 3 0 0 1 2.5 4.2 3 3 0 0 1-1 5.3 3 3 0 0 1-4 3.5V4Z" />
    <path d="M9.5 4a2.5 2.5 0 0 1 5 0" />
  </>,
);
/** Alias used for the memories page. */
export const IconMemory = IconBrain;

export const IconActivity = createIcon("Activity", <path d="M3 12h4l3-8 4 16 3-8h4" />);

export const IconCheck = createIcon("Check", <path d="m5 12.5 4.5 4.5L19 7.5" />);

export const IconX = createIcon("X", <path d="M6 6l12 12M18 6 6 18" />);

export const IconSend = createIcon(
  "Send",
  <>
    <path d="M21 3 10 14" />
    <path d="m21 3-6.5 18-4.5-7-7-4.5L21 3Z" />
  </>,
);

export const IconDownload = createIcon(
  "Download",
  <>
    <path d="M12 4v11" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 19h16" />
  </>,
);

export const IconUpload = createIcon(
  "Upload",
  <>
    <path d="M12 15V4" />
    <path d="m7 9 5-5 5 5" />
    <path d="M4 19h16" />
  </>,
);

/** Status glyphs used by InlineAlert / Toast. */
export const IconInfo = createIcon(
  "Info",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <path d="M12 8h.01" />
  </>,
);

export const IconAlert = createIcon(
  "Alert",
  <>
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9.5v4" />
    <path d="M12 17h.01" />
  </>,
);

export const IconCheckCircle = createIcon(
  "CheckCircle",
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
);

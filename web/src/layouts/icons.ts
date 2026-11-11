/** Single-path icons (24x24, stroke style) — subset of the prototype set. */
const paths = {
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  inbox:
    "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
  bot: "M4 11h16v10H4zM12 5a2 2 0 1 0 0 .01M12 7v4M8 16h.01M16 16h.01",
  book: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  plug: "M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z",
  puzzle:
    "M19 13h-2.2a2 2 0 1 1-3.8 0H11V8.5a2 2 0 1 1 0-3.8V3h7v7zM5 21v-7h2.2a2 2 0 1 0 3.8 0H13v2.2a2 2 0 1 1 0 3.8V21z",
  monitor: "M2 3h20v14H2zM8 21h8M12 17v4",
  chart: "M12 20V10M18 20V4M6 20v-4",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h7M9 8h6M17 16h6",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
} as const;

export type IconName = keyof typeof paths;

export default paths;

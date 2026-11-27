import type { CronJobView } from "@/lib/api/wire";

export type ScheduleKind = "cron" | "interval" | "once";

export const TIMEZONES = [
  "Asia/Shanghai", "UTC", "Asia/Tokyo", "Asia/Singapore",
  "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles",
];

export function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  } catch {
    return "Asia/Shanghai";
  }
}

export function splitSchedule(schedule: string): { kind: ScheduleKind; value: string } {
  if (schedule.startsWith("interval:")) {
    return { kind: "interval", value: schedule.slice("interval:".length) };
  }
  if (schedule.startsWith("once:")) {
    return { kind: "once", value: schedule.slice("once:".length) };
  }
  return {
    kind: "cron",
    value: schedule.startsWith("cron:") ? schedule.slice("cron:".length) : schedule,
  };
}

export function describe(schedule: string): string {
  const { kind, value } = splitSchedule(schedule);
  if (kind === "interval") {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds <= 0) return schedule;
    if (seconds % 3600 === 0) return `每 ${seconds / 3600} 小时`;
    if (seconds % 60 === 0) return `每 ${seconds / 60} 分钟`;
    return `每 ${seconds} 秒`;
  }
  if (kind === "once") {
    const ts = Number(value);
    return Number.isFinite(ts) && ts > 0
      ? `单次 · ${new Date(ts * 1000).toLocaleString("zh-CN")}`
      : schedule;
  }
  const fields = value.trim().split(/\s+/);
  if (fields.length === 5) {
    const [minute, hour, dom, month, dow] = fields;
    if (minute === "0" && hour !== "*" && dom === "*" && month === "*" && dow === "*") {
      return `每天 ${hour.padStart(2, "0")}:00`;
    }
    if (minute === "0" && hour !== "*" && dow === "1-5") {
      return `工作日 ${hour.padStart(2, "0")}:00`;
    }
    if (minute === "0" && hour !== "*" && dow !== "*") {
      return `每周 ${dow} ${hour.padStart(2, "0")}:00`;
    }
    if (minute.startsWith("*/") && hour === "*" && dom === "*" && month === "*" && dow === "*") {
      return `每 ${minute.slice(2)} 分钟`;
    }
  }
  return `Cron ${value}`;
}

export function fmt(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("zh-CN", {
    month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function inputDate(epoch: string): string {
  const ts = Number(epoch);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const date = new Date(ts * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface FormState {
  name: string;
  kind: ScheduleKind;
  cron: string;
  interval: string;
  once: string;
  timezone: string;
  text: string;
  enabled: boolean;
}

export function formOf(job: CronJobView | null, seed?: Partial<FormState> | null): FormState {
  const base: FormState = job
    ? (() => {
        const { kind, value } = splitSchedule(job.schedule);
        return {
          name: job.name,
          kind,
          cron: kind === "cron" ? value : "0 9 * * *",
          interval: kind === "interval" ? value : "3600",
          once: kind === "once" ? inputDate(value) : "",
          timezone: job.timezone,
          text: job.text,
          enabled: job.enabled,
        };
      })()
    : {
        name: "",
        kind: "cron",
        cron: "0 9 * * *",
        interval: "3600",
        once: "",
        timezone: defaultTimezone(),
        text: "/polyopus 定时任务",
        enabled: true,
      };
  return { ...base, ...(seed ?? {}) };
}

export function scheduleOf(form: FormState): string {
  if (form.kind === "interval") {
    return `interval:${Math.max(1, Number(form.interval) || 3600)}`;
  }
  if (form.kind === "once") {
    const ms = new Date(form.once).getTime();
    return `once:${Number.isFinite(ms) ? Math.floor(ms / 1000) : 0}`;
  }
  return `cron:${form.cron.trim()}`;
}

/** Returns a field-level error message, or null when the form is valid. */
export function validateForm(form: FormState): string | null {
  if (!form.name.trim()) return "任务名称不能为空";
  if (form.kind === "cron" && form.cron.trim().split(/\s+/).length !== 5) {
    return "Cron 需要 5 段：分 时 日 月 周";
  }
  if (form.kind === "interval" && Number(form.interval) <= 0) {
    return "间隔必须大于 0 秒";
  }
  if (form.kind === "once") {
    const ts = new Date(form.once).getTime();
    if (!Number.isFinite(ts) || ts <= Date.now()) return "单次执行时间需要晚于当前时间";
  }
  if (!form.text.trim()) return "发送给智能体的指令不能为空";
  return null;
}

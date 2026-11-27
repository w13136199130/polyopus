import { useEffect, useState } from "react";
import { Button, Drawer, Switch } from "@/components/ui";
import type { CronJobView } from "@/lib/api/wire";
import {
  TIMEZONES,
  formOf,
  scheduleOf,
  validateForm,
  type FormState,
} from "@/features/automation/form";
import styles from "./AutomationPage.module.css";

export interface CronDrawerProps {
  open: boolean;
  job: CronJobView | null;
  seed?: Partial<FormState> | null;
  busy: boolean;
  onClose: () => void;
  onSave: (form: FormState) => void;
}

/** 三段式抽屉：基础信息 / 执行计划 / 任务内容 (docs/52 §5). */
export function CronDrawer({ open, job, seed, busy, onClose, onSave }: CronDrawerProps) {
  const [form, setForm] = useState<FormState>(() => formOf(job, seed));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(formOf(job, seed));
    setError(null);
  }, [open, job, seed]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit() {
    const problem = validateForm(form);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onSave(form);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={job ? "编辑定时任务" : "创建定时任务"}
      description="任务由服务端调度；错过执行时间会在容忍窗口内补跑一次。"
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button data-testid="cron-save" loading={busy} onClick={submit}>
            保存
          </Button>
        </>
      }
    >
      <div className={styles.form}>
        {error ? <div className={styles.formError}>{error}</div> : null}

        <section className={styles.formSection}>
          <h3>基础信息</h3>
          <label className={styles.field}>
            任务名称 *
            <input
              data-testid="cron-name"
              value={form.name}
              maxLength={100}
              placeholder="例如：每日科技新闻"
              onChange={(event) => set("name", event.target.value)}
            />
          </label>
          {job ? (
            <div className={styles.inline}>
              <span>启用任务</span>
              <Switch
                checked={form.enabled}
                label="启用任务"
                testId="cron-enabled"
                onChange={(next) => set("enabled", next)}
              />
            </div>
          ) : (
            <p className={styles.hint}>创建后默认启用；可在任务行开关暂停。</p>
          )}
        </section>

        <section className={styles.formSection}>
          <h3>执行计划</h3>
          <label className={styles.field}>
            调度方式 *
            <select
              data-testid="cron-kind"
              value={form.kind}
              onChange={(event) => set("kind", event.target.value as FormState["kind"])}
            >
              <option value="cron">Cron 表达式</option>
              <option value="interval">固定间隔</option>
              <option value="once">单次执行</option>
            </select>
          </label>

          {form.kind === "cron" ? (
            <label className={styles.field}>
              Cron（分 时 日 月 周）*
              <input
                data-testid="cron-expr"
                className={styles.monoInput}
                value={form.cron}
                onChange={(event) => set("cron", event.target.value)}
              />
              <span className={styles.hint}>
                示例：<code>0 9 * * *</code> 每天 09:00 · <code>0 10 * * 1</code> 每周一
                10:00 · <code>*/30 * * * *</code> 每 30 分钟
              </span>
            </label>
          ) : null}

          {form.kind === "interval" ? (
            <label className={styles.field}>
              间隔（秒）*
              <input
                data-testid="cron-interval"
                type="number"
                min="1"
                value={form.interval}
                onChange={(event) => set("interval", event.target.value)}
              />
              <span className={styles.hint}>3600 = 每小时；86400 = 每天。</span>
            </label>
          ) : null}

          {form.kind === "once" ? (
            <label className={styles.field}>
              执行时间 *
              <input
                data-testid="cron-once"
                type="datetime-local"
                value={form.once}
                onChange={(event) => set("once", event.target.value)}
              />
            </label>
          ) : null}

          <label className={styles.field}>
            时区
            <input
              data-testid="cron-timezone"
              list="cron-timezones"
              value={form.timezone}
              onChange={(event) => set("timezone", event.target.value)}
            />
            <datalist id="cron-timezones">
              {TIMEZONES.map((zone) => <option key={zone} value={zone} />)}
            </datalist>
          </label>
          <p className={styles.hint}>预计：{scheduleOf(form).replace(/^[a-z]+:/, "")}</p>
        </section>

        <section className={styles.formSection}>
          <h3>任务内容</h3>
          <label className={styles.field}>
            发送给智能体的指令 *
            <textarea
              data-testid="cron-text"
              rows={5}
              maxLength={500}
              value={form.text}
              onChange={(event) => set("text", event.target.value)}
            />
          </label>
          <label className={styles.field}>
            任务类型
            <select disabled title="任务类型与发送通道随 v1.1 接入">
              <option>文本指令</option>
            </select>
          </label>
          <div className={styles.inline}>
            <span>每次执行新会话</span>
            <Switch checked={false} disabled label="每次执行新会话（v1.1）" onChange={() => undefined} />
          </div>
          <label className={styles.field}>
            发送通道
            <select disabled title="发送通道随 v1.1 接入">
              <option>控制台（当前）</option>
            </select>
          </label>
        </section>
      </div>
    </Drawer>
  );
}

"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useState, type FormEvent } from "react";
import { OwnerPage } from "./owner-page";
import { IngestionRules } from "./ingested";
import { NotificationSettings } from "./notifications";
import { button, Panel, problem, Quiet } from "./parts";

/** The owner-wide settings: the time zone dates are read in, and when a quiet project is flagged. */

const field = "rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

export function SettingsPage() {
  return (
    <OwnerPage>
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Loaded />
      <div className="mt-12">
        <Panel title="Notifications">
          <NotificationsPanel />
        </Panel>
      </div>
      <div className="mt-12">
        <Panel title="Ingestion">
          <IngestionRules />
        </Panel>
      </div>
    </OwnerPage>
  );
}

/** Notifications need the saved quiet hours, so they wait for the settings to load. */
function NotificationsPanel() {
  const settings = useQuery(api.viewer.settings);
  if (settings === undefined) return <Quiet>Loading…</Quiet>;
  return <NotificationSettings quietFrom={settings.quietFrom} quietTo={settings.quietTo} />;
}

function Loaded() {
  const settings = useQuery(api.viewer.settings);
  if (settings === undefined) {
    return (
      <div className="mt-6">
        <Quiet>Loading…</Quiet>
      </div>
    );
  }
  return <Form key={`${settings.timeZone}/${settings.stalenessDays}`} settings={settings} />;
}

function Form({ settings }: { settings: { timeZone: string; stalenessDays: number } }) {
  const save = useMutation(api.viewer.saveSettings);
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [days, setDays] = useState(String(settings.stalenessDays));
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  // Every zone the browser knows, with the saved one first in case it is not among them.
  const zones = [...new Set([settings.timeZone, ...Intl.supportedValuesOf("timeZone")])];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNote(undefined);
    try {
      await save({ timeZone, stalenessDays: Number(days) });
      setNote({ ok: true, text: "Saved." });
    } catch (caught) {
      setNote({ ok: false, text: problem(caught) });
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-6">
      <label className="block text-sm">
        Time zone
        <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)} className={`mt-1 block w-full max-w-sm ${field}`}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-foreground/60">
          Dates Claude and you enter are read in this zone, and it decides when a day starts.
        </span>
      </label>
      <label className="block text-sm">
        Flag an active project as stale after
        <span className="mt-1 flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className={`w-24 ${field}`}
          />
          days without a status report
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className={button}>
          Save
        </button>
        {note ? <p className={`text-sm ${note.ok ? "text-foreground/60" : "text-red-700 dark:text-red-300"}`}>{note.text}</p> : null}
      </div>
    </form>
  );
}

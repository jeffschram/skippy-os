"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { button, problem, Quiet, showTime } from "./parts";

/**
 * Notifications on this device. A device asks for them here; Skippy OS then
 * sends the morning briefing's notice to every device that asked. On an
 * iPhone the browser only allows this once the site is on the Home Screen.
 */

const field = "rounded-md border border-foreground/20 bg-background px-2 py-1.5 text-sm";

const canPush = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Registers the service worker that shows notifications. Mounted on every page, so an update reaches it. */
export function ServiceWorker() {
  useEffect(() => {
    if (!canPush()) return;
    navigator.serviceWorker
      .register(new URL("../lib/service-worker.js", import.meta.url), { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // Without it the app works the same; only notifications are missing.
      });
  }, []);
  return null;
}

/** The server's public key in the form the browser wants. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

const hourLabel = (hour: number) => new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: "numeric" });

export function NotificationSettings({ quietFrom, quietTo }: { quietFrom: number; quietTo: number }) {
  const data = useQuery(api.viewer.notifications);
  const subscribe = useMutation(api.viewer.savePushSubscription);
  const unsubscribe = useMutation(api.viewer.removePushSubscription);
  const test = useMutation(api.viewer.sendTestNotification);
  const saveSettings = useMutation(api.viewer.saveSettings);
  // What this browser can do and has done, learned after the first paint.
  const [device, setDevice] = useState<{ supported: boolean; endpoint?: string; ios: boolean; installed: boolean }>();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const installed = window.matchMedia("(display-mode: standalone)").matches;
      if (!canPush()) {
        if (!cancelled) setDevice({ supported: false, ios, installed });
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (!cancelled) setDevice({ supported: true, endpoint: existing?.endpoint, ios, installed });
    })().catch(() => {
      if (!cancelled) setDevice({ supported: false, ios: false, installed: false });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function attempt(change: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNote(undefined);
    try {
      await change();
    } catch (caught) {
      setError(caught instanceof Error && !("data" in caught) ? caught.message : problem(caught));
    } finally {
      setBusy(false);
    }
  }

  const turnOn = () =>
    attempt(async () => {
      if (!data?.publicKey) throw new Error("Notifications are not set up on the server yet.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("This browser did not allow notifications. Allow them for this site in its settings, then try again.");
      const registration = await navigator.serviceWorker.ready;
      const made = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(data.publicKey) });
      const { endpoint, keys } = made.toJSON();
      if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error("The browser gave back an incomplete subscription.");
      await subscribe({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: navigator.userAgent });
      setDevice((now) => (now ? { ...now, endpoint } : now));
      setNote("Notifications are on for this device.");
    });

  const turnOff = () =>
    attempt(async () => {
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await unsubscribe({ endpoint: existing.endpoint });
        await existing.unsubscribe();
      }
      setDevice((now) => (now ? { ...now, endpoint: undefined } : now));
      setNote("Notifications are off for this device.");
    });

  const sendTest = () =>
    attempt(async () => {
      const result = await test({});
      setNote(result.status === "pending" ? "Sent. It should arrive in a few seconds." : `Not sent: ${result.reason ?? result.status}.`);
    });

  if (data === undefined || device === undefined) return <Quiet>Loading…</Quiet>;
  const on = Boolean(device.endpoint && data.devices.some((entry) => entry.endpoint === device.endpoint));
  const hours = [...Array(24).keys()];
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground/70">
        When the morning briefing is written, every device that has notifications on is told. {data.devices.length === 0 ? "No device has them on yet." : `${data.devices.length} device${data.devices.length === 1 ? " has" : "s have"} them on.`}
      </p>
      {!data.publicKey ? <p className="text-sm text-foreground/70">Notifications are not set up on the server yet.</p> : null}
      {device.ios && !device.installed ? (
        <p className="text-sm text-foreground/70">
          On an iPhone or iPad, add Skippy OS to the Home Screen first: in Safari tap Share, then Add to Home Screen. Open it from there and
          come back to this page.
        </p>
      ) : !device.supported ? (
        <p className="text-sm text-foreground/70">This browser cannot receive notifications.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {on ? (
            <>
              <button type="button" disabled={busy} onClick={sendTest} className={button}>
                Send a test
              </button>
              <button type="button" disabled={busy} onClick={turnOff} className={button}>
                Turn off on this device
              </button>
            </>
          ) : (
            <button type="button" disabled={busy || !data.publicKey} onClick={turnOn} className={`${button} disabled:opacity-50`}>
              Turn on notifications on this device
            </button>
          )}
        </div>
      )}
      {note ? <p className="text-sm text-green-800 dark:text-green-300">{note}</p> : null}
      {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Quiet from
        <select
          value={quietFrom}
          onChange={(event) => attempt(async () => void (await saveSettings({ quietFrom: Number(event.target.value) })))}
          aria-label="Quiet hours start"
          className={field}
        >
          {hours.map((hour) => (
            <option key={hour} value={hour}>
              {hourLabel(hour)}
            </option>
          ))}
        </select>
        to
        <select
          value={quietTo}
          onChange={(event) => attempt(async () => void (await saveSettings({ quietTo: Number(event.target.value) })))}
          aria-label="Quiet hours end"
          className={field}
        >
          {hours.map((hour) => (
            <option key={hour} value={hour}>
              {hourLabel(hour)}
            </option>
          ))}
        </select>
        <span className="text-foreground/60">Nothing is sent between these. The same hour twice means no quiet hours.</span>
      </div>
      {data.recent.length > 0 ? (
        <ul className="space-y-1.5">
          {data.recent.map((delivery) => (
            <li key={delivery.id} className="text-sm">
              {delivery.title}: {delivery.body}
              <span className="text-foreground/60">
                {" "}
                · {delivery.status === "skipped" || delivery.status === "failed" ? `${delivery.status}, ${delivery.reason ?? "no reason given"}` : delivery.status} ·{" "}
                {showTime(delivery.at)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

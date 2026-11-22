// Shows the notifications Skippy OS sends, and opens the app when one is tapped.
// It keeps nothing offline: the app always loads from the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let message;
  try {
    message = event.data.json();
  } catch {
    message = { title: "Skippy OS", body: event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Skippy OS", {
      body: message.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: message.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Only ever a path on this site, whatever the message said.
  const wanted = String(event.notification.data?.url || "/");
  const target = new URL(wanted.startsWith("/") ? wanted : "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) return open.focus().then(() => ("navigate" in open ? open.navigate(target) : undefined));
      return self.clients.openWindow(target);
    }),
  );
});

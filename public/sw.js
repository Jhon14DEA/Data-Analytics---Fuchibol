self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || "FUT Analytics", {
      body: data.body || "Hay una nueva alerta en un partido en vivo.",
      tag: data.url || "fut-analytics-alert",
      data: { url: data.url || "/alerts" }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data.url));
});
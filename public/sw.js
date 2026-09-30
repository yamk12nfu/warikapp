self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }
  const notification = event.data.json();
  event.waitUntil(
    self.registration.showNotification(notification.title, {
      body: notification.body,
      tag: notification.tag,
      data: { url: notification.url },
      icon: "/icon.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data.url, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const client = windowClients.find(
          (candidate) => new URL(candidate.url).origin === self.location.origin,
        );
        if (client) {
          return client.focus().then(() => client.navigate(targetUrl));
        }
        return self.clients.openWindow(targetUrl);
      }),
  );
});

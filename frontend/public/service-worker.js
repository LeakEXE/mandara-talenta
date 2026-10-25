self.addEventListener('push', (event) => {
  let notification = {};
  try {
    notification = event.data ? event.data.json() : {};
  } catch {
    notification = {};
  }

  event.waitUntil(self.registration.showNotification('Mandara Talenta', {
    body: 'Anda memiliki notifikasi baru. Buka aplikasi untuk melihatnya.',
    icon: '/icon-192.png',
    badge: '/notification-badge.png',
    tag: typeof notification.tag === 'string' ? notification.tag : 'mandara-notification',
    data: { url: '/notifications' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL('/notifications', self.location.origin).href;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});

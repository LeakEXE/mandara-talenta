import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { CircleCheck, CircleX, Clock, Bell, Inbox } from 'lucide-react';

function Notifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);

  const markAllAsRead = useCallback(async () => {
    try {
      await api.put('/approvals/notifications/read-all', {});
      const response = await api.get('/approvals/notifications/count');
      setUnreadCount(response.data.count || 0);
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  }, []);

  const fetchNotifications = async () => {
    try {
      const response = await api.get('/approvals/notifications');
      setNotifications(response.data);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      setMessage('Gagal memuat notifikasi');
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await api.get('/approvals/notifications/count');
      setUnreadCount(response.data.count || 0);
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
    markAllAsRead();
  }, [markAllAsRead, fetchUnreadCount]);

  const markAsRead = async (id) => {
    try {
      await api.put(`/approvals/notifications/${id}/read`, {});
      fetchNotifications();
      fetchUnreadCount();
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const NOTIF_ICONS = {
    approved: CircleCheck,
    rejected: CircleX,
    approval_needed: Clock
  };

  const getNotificationIcon = (type) => NOTIF_ICONS[type] || Bell;

  const getNotificationColor = (type) => {
    switch(type) {
      case 'approved': return 'var(--green-bg)';
      case 'rejected': return 'var(--danger-bg)';
      case 'approval_needed': return 'var(--amber-bg)';
      default: return 'var(--bg-tertiary)';
    }
  };

  const getNotificationTitle = (type) => {
    switch(type) {
      case 'approved': return 'Disetujui';
      case 'rejected': return 'Ditolak';
      case 'approval_needed': return 'Perlu Persetujuan';
      default: return 'Notifikasi';
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>;
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}><Bell size={22} /> Notifikasi</h2>
        {unreadCount > 0 && (
          <span className="nav-badge" style={{ minWidth: '24px', height: '24px', fontSize: '12px', padding: '0 8px' }}>
            {unreadCount}
          </span>
        )}
      </div>
      
      {message && (
        <div className="alert alert-info" style={{ marginBottom: '20px' }}>
          {message}
        </div>
      )}

      {notifications.length === 0 ? (
        <div className="card-flat" style={{
          padding: '60px 20px',
          textAlign: 'center'
        }}>
          <span style={{ display: 'inline-flex', color: 'var(--muted-light)' }}><Inbox size={64} /></span>
          <p style={{ marginTop: '20px', fontSize: '18px', color: 'var(--slate)', marginBottom: 0 }}>
            Tidak ada notifikasi
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '15px' }}>
          {notifications.map(notif => (
            <div
              key={notif.id}
              onClick={() => !notif.is_read && markAsRead(notif.id)}
              style={{
                padding: '20px',
                backgroundColor: notif.is_read ? 'var(--bg-primary)' : getNotificationColor(notif.type),
                borderRadius: '12px',
                border: notif.is_read ? '1px solid var(--border-color)' : '2px solid var(--blue)',
                cursor: notif.is_read ? 'default' : 'pointer',
                transition: 'all 0.2s',
                boxShadow: notif.is_read ? 'none' : '0 2px 8px rgba(0,0,0,0.1)'
              }}
              onMouseEnter={(e) => {
                if (!notif.is_read) {
                  e.target.style.transform = 'translateX(5px)';
                }
              }}
              onMouseLeave={(e) => {
                e.target.style.transform = 'translateX(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '15px' }}>
                {(() => { const Icon = getNotificationIcon(notif.type); return (
                <span style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--slate)' }}><Icon size={22} /></span>
                ); })()}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '4px 8px', marginBottom: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-primary)' }}>
                      {getNotificationTitle(notif.type)}
                      {!notif.is_read && (
                        <span style={{
                          marginLeft: '10px',
                          backgroundColor: 'var(--blue)',
                          color: 'white',
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 'normal'
                        }}>
                          Baru
                        </span>
                      )}
                    </h3>
                    <small style={{ color: 'var(--muted-light)', fontSize: '12px', whiteSpace: 'nowrap' }}>
                      {new Date(notif.created_at).toLocaleString('id-ID', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </small>
                  </div>
                  
                  <p style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--slate)', lineHeight: '1.5' }}>
                    {notif.message}
                  </p>
                  
                  {!notif.is_read && (
                    <small style={{ color: 'var(--blue)', fontSize: '12px' }}>
                      Klik untuk menandai sebagai dibaca
                    </small>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Notifications;

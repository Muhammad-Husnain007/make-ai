import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { isPublicPath, routes } from '../lib/routes.js';
import { getToken } from '../lib/session.js';

const REALTIME_URL = import.meta.env.VITE_API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '');

export function usePulseLive(onEvent) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  useEffect(() => {
    const socket = io(REALTIME_URL, {
      path: '/realtime',
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
    });
    socket.on('pulse:event', (payload) => callback.current(payload));
    socket.on('pulse:issue', (issue) => callback.current({ issue }));
    socket.on('pulse:notification', (notification) => callback.current({ notification }));
    socket.on('pulse:settings', (project) => callback.current({ project }));
    socket.on('pulse:forced-logout', () => {
      try { localStorage.removeItem('pulse_auth_token'); } catch {}
      if (!isPublicPath(window.location.pathname)) {
        window.location.assign(routes.signUpPending);
      }
    });
    return () => socket.disconnect();
  }, []);
}

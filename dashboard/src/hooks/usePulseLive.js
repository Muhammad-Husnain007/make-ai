import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const REALTIME_URL = import.meta.env.VITE_API_ORIGIN || 'http://127.0.0.1:8787';

export function usePulseLive(onEvent) {
  const callback = useRef(onEvent);
  callback.current = onEvent;
  useEffect(() => {
    const socket = io(REALTIME_URL, {
      path: '/realtime',
      transports: ['websocket', 'polling'],
    });
    socket.on('pulse:event', (payload) => callback.current(payload));
    socket.on('pulse:issue', (issue) => callback.current({ issue }));
    return () => socket.disconnect();
  }, []);
}

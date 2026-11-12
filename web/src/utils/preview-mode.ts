export const isLocalPreview = import.meta.env.DEV
  && import.meta.env.VITE_PREVIEW_MODE === 'true'
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

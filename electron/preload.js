const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('smolympic', {
  // Data access: forwards { method, path, body, token } to the main-process
  // router and resolves with { status, data } | { status, error }.
  api(payload) {
    return ipcRenderer.invoke('api:request', payload);
  },
  // Subscribe to hardware RFID swipe events forwarded by the main process.
  onSwipe(handler) {
    const listener = (_evt, rfidUid) => handler(rfidUid);
    ipcRenderer.on('rfid:swipe', listener);
    return () => ipcRenderer.removeListener('rfid:swipe', listener);
  },
  // Demo helper: ask main to emit a swipe as if the reader fired.
  simulateSwipe(rfidUid) {
    ipcRenderer.send('rfid:simulate', rfidUid);
  },
});

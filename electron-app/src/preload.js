const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pythonBridge', {
  getDefaults: () => ipcRenderer.invoke('python:get-defaults'),
  run: (payload) => ipcRenderer.invoke('python:run', payload),
  stop: (jobId) => ipcRenderer.invoke('python:stop', jobId),
  listJobs: () => ipcRenderer.invoke('python:list-jobs'),
  fetchQuote: (symbol) => ipcRenderer.invoke('quotes:get', { symbol }),
  setQuoteProvider: (provider) => ipcRenderer.invoke('quotes:set-provider', { provider }),
  loadFilters: () => ipcRenderer.invoke('filters:load'),
  prepareFilters: (config) => ipcRenderer.invoke('filters:prepare', config),
  saveFilters: (config) => ipcRenderer.invoke('filters:save', config),
  loadPortfolio: () => ipcRenderer.invoke('portfolio:load'),
  saveHolding: (payload) => ipcRenderer.invoke('portfolio:bought', payload),
  updateHolding: (payload) => ipcRenderer.invoke('portfolio:update', payload),
  sellHolding: (payload) => ipcRenderer.invoke('portfolio:sell', payload),
  generateChart: (symbol) => ipcRenderer.invoke('chart:generate', { symbol }),
  getReporterSettings: () => ipcRenderer.invoke('reporter:get-settings'),
  saveReporterSettings: (config) => ipcRenderer.invoke('reporter:save-settings', config),
  sendReporterTestEmail: () => ipcRenderer.invoke('reporter:send-test'),
  onOutput: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('python:output', listener);
    return () => ipcRenderer.removeListener('python:output', listener);
  },
  onExit: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on('python:exit', listener);
    return () => ipcRenderer.removeListener('python:exit', listener);
  },
});

const PANSOU = '__clouddock_pansou__';
const ORIGINAL = '__clouddock_channels_all__';

// PanSou may return partial results while its plugins continue in the background.
export function schedulePanSouRefresh(refresh, isActive, schedule = setTimeout) {
  for (const delay of [10000, 25000]) schedule(() => { if (isActive()) void refresh(); }, delay);
}

// Preserve the existing channel search, including its progressive mode.
export function createPanSouSearchAdapter(original, getCloudDock) {
  const panChannel = { id: PANSOU, name: 'PanSou', index: -1 };
  return {
    async search(keyword, channel, lastMessage, options) {
      if (channel === PANSOU || channel === 'clouddock-pansou') return { code: 0, data: lastMessage ? [] : await getCloudDock().searchPanSou(keyword, options?.signal) };
      return original.search(keyword, channel === ORIGINAL ? undefined : channel, lastMessage, options);
    },
    async searchChannels(keyword, channel, options) {
      const mode = getCloudDock()?.searchSource() || 'channels';
      if (mode === 'channels') return original.searchChannels(keyword, channel, options);
      if (mode === 'pansou') return { code: 0, data: { mode: 'progressive', channels: [panChannel], batchSize: 1 } };
      let result;
      try { result = await original.searchChannels(keyword, channel, options); } catch { /* Original all-channel search remains available. */ }
      const data = result?.code === 0 ? result.data : null;
      const channels = data?.mode === 'progressive' && Array.isArray(data.channels)
        ? data.channels.filter(item => item?.id !== PANSOU && item?.id !== ORIGINAL)
        : [{ id: ORIGINAL, name: '原有频道', index: 0 }];
      return { code: 0, data: { mode: 'progressive', channels: [panChannel, ...channels], batchSize: Math.max(2, Number(data?.batchSize) || 1) } };
    },
  };
}

module.exports = {
  "tag.list": async () => ({ tags: await PluginAPI.getAllTags() }),
  "tag.create": async (payload) => ({ tagId: await PluginAPI.addTag(payload || {}) }),
  "tag.update": async (payload) => {
    await PluginAPI.updateTag(payload.tagId, payload.data || payload);
    return { updated: true };
  },
};

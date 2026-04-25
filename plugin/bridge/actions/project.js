module.exports = {
  "project.list": async () => ({ projects: await PluginAPI.getAllProjects() }),
  "project.create": async (payload) => ({ projectId: await PluginAPI.addProject(payload || {}) }),
  "project.update": async (payload) => {
    await PluginAPI.updateProject(payload.projectId, payload.data || payload);
    return { updated: true };
  },
};

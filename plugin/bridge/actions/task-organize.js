const { typedError } = require("../errors");
const { findTask, valueOf } = require("./task-common");

async function taskAddTag(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const tagId = valueOf(payload || {}, "tagId", "tag_id");
  if (!taskId || !tagId) throw typedError("INVALID_REQUEST", "taskId and tagId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  const tagIds = task.tagIds || [];
  if (tagIds.includes(tagId)) return { added: false };
  await PluginAPI.updateTask(taskId, { tagIds: [...tagIds, tagId] });
  return { added: true };
}

async function taskRemoveTag(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const tagId = valueOf(payload || {}, "tagId", "tag_id");
  if (!taskId || !tagId) throw typedError("INVALID_REQUEST", "taskId and tagId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  const tagIds = task.tagIds || [];
  if (!tagIds.includes(tagId)) throw typedError("TAG_NOT_ON_TASK", `Tag ${tagId} not on task ${taskId}`, false);
  await PluginAPI.updateTask(taskId, { tagIds: tagIds.filter((id) => id !== tagId) });
  return { removed: true };
}

async function taskMoveToProject(payload) {
  const taskId = valueOf(payload || {}, "taskId", "task_id");
  const projectId = valueOf(payload || {}, "projectId", "project_id");
  if (!taskId || !projectId) throw typedError("INVALID_REQUEST", "taskId and projectId are required", false);
  const task = await findTask(taskId);
  if (!task) throw typedError("TASK_NOT_FOUND", `Task ${taskId} not found`, false);
  if (task.parentId) throw typedError("TASK_IS_SUBTASK", `Cannot move subtask ${taskId}`, false, { parentId: task.parentId });
  if (typeof PluginAPI.getAllProjects === "function") {
    const projects = await PluginAPI.getAllProjects();
    if (!projects.find((project) => project.id === projectId)) throw typedError("PROJECT_NOT_FOUND", `Project ${projectId} not found`, false);
  }
  await PluginAPI.updateTask(taskId, { projectId });
  return { moved: true };
}

module.exports = {
  taskAddTag,
  taskMoveToProject,
  taskRemoveTag,
};

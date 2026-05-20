const { typedError } = require("../errors");
const { parseTaskShortSyntax } = require("./task-short-syntax");
const { mergeUnique, valueOf } = require("./task-common");

async function buildTaskData(payload) {
  const parsed = await parseTaskShortSyntax(payload.title || "");
  const data = {
    title: parsed.title,
    notes: payload.notes || "",
    projectId: valueOf(payload, "projectId", "project_id") || parsed.projectId,
    parentId: valueOf(payload, "parentId", "parent_id"),
    timeEstimate: valueOf(payload, "timeEstimate", "time_estimate") ?? parsed.timeEstimate ?? 0,
    tagIds: mergeUnique(valueOf(payload, "tagIds", "tag_ids") || [], parsed.tagIds),
  };
  if (parsed.timeSpent != null) data.timeSpent = parsed.timeSpent;
  if (parsed.dueDay != null) data.dueDay = parsed.dueDay;
  if (parsed.dueWithTime != null) data.dueWithTime = parsed.dueWithTime;
  return data;
}

async function taskCreate(payload) {
  const data = await buildTaskData(payload);
  const taskId = await PluginAPI.addTask(data);
  return { taskId };
}

async function taskCreateWithSubtasks(payload) {
  if (!Array.isArray(payload?.subtasks)) {
    throw typedError("INVALID_REQUEST", "subtasks must be an array", false);
  }
  const parentData = await buildTaskData(payload);
  const parentId = await PluginAPI.addTask(parentData);
  const subtaskIds = [];
  for (const subtask of payload.subtasks) {
    const childData = await buildTaskData({ ...subtask, parentId });
    const childId = await PluginAPI.addTask(childData);
    subtaskIds.push(childId);
  }
  return { parentId, subtaskIds };
}

module.exports = {
  taskCreate,
  taskCreateWithSubtasks,
};

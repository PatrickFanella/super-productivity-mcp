const { typedError } = require("../errors");

async function findTask(taskId) {
  const tasks = await PluginAPI.getTasks();
  return tasks.find((t) => t.id === taskId) || null;
}

async function taskCreate(payload) {
  const data = {
    title: payload.title || "",
    notes: payload.notes || "",
    projectId: payload.projectId,
    parentId: payload.parentId,
    timeEstimate: payload.timeEstimate || 0,
    tagIds: payload.tagIds || [],
  };

  if (
    data.parentId &&
    typeof data.title === "string" &&
    (data.title.includes("@") || data.title.includes("#") || data.title.includes("+"))
  ) {
    const titleWithoutSyntax = data.title
      .replace(/@[\w-]+/g, "")
      .replace(/#[\w-]+/g, "")
      .replace(/\+[\w-]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const taskId = await PluginAPI.addTask({ ...data, title: titleWithoutSyntax });
    await PluginAPI.updateTask(taskId, { title: data.title });
    return { taskId };
  }

  const taskId = await PluginAPI.addTask(data);
  return { taskId };
}

async function taskList(payload) {
  const includeDone = payload?.includeDone !== false;
  const tasks = await PluginAPI.getTasks();
  if (includeDone) {
    return { tasks };
  }
  return { tasks: tasks.filter((t) => !t.isDone) };
}

async function taskGet(payload) {
  const task = await findTask(payload.taskId);
  if (!task) {
    throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
  }
  return { task };
}

async function taskUpdate(payload) {
  if (!payload.taskId) {
    throw typedError("INVALID_REQUEST", "taskId is required", false);
  }
  const updates = { ...payload };
  delete updates.taskId;
  await PluginAPI.updateTask(payload.taskId, updates);
  return { updated: true };
}

async function taskComplete(payload) {
  await PluginAPI.updateTask(payload.taskId, { isDone: true, doneOn: Date.now() });
  return { completed: true };
}

async function taskUncomplete(payload) {
  await PluginAPI.updateTask(payload.taskId, { isDone: false, doneOn: null });
  return { uncompleted: true };
}

async function taskArchive(payload) {
  await PluginAPI.updateTask(payload.taskId, { isDone: true, doneOn: Date.now() });
  return { archived: false, note: "Plugin API has no explicit archive endpoint; marked done" };
}

async function taskAddTime(payload) {
  const task = await findTask(payload.taskId);
  if (!task) {
    throw typedError("TASK_NOT_FOUND", `Task ${payload.taskId} not found`, false);
  }
  const add = Number(payload.timeMs || 0);
  await PluginAPI.updateTask(payload.taskId, { timeSpent: (task.timeSpent || 0) + add });
  return { timeSpent: (task.timeSpent || 0) + add };
}

async function taskReorder(payload) {
  if (typeof PluginAPI.reorderTasks !== "function") {
    return { reordered: false, note: "reorderTasks not supported by this plugin runtime" };
  }
  await PluginAPI.reorderTasks(payload.taskIds || [], payload.contextId, payload.contextType);
  return { reordered: true };
}

module.exports = {
  "task.create": taskCreate,
  "task.list": taskList,
  "task.get": taskGet,
  "task.update": taskUpdate,
  "task.complete": taskComplete,
  "task.uncomplete": taskUncomplete,
  "task.archive": taskArchive,
  "task.addTime": taskAddTime,
  "task.reorder": taskReorder,
};

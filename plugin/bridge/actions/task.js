const create = require("./task-create");
const read = require("./task-read");
const mutate = require("./task-mutate");
const recurrence = require("./task-recurrence");
const schedule = require("./task-schedule");
const organize = require("./task-organize");

module.exports = {
  "task.create": create.taskCreate,
  "task.createWithSubtasks": create.taskCreateWithSubtasks,
  "task.list": read.taskList,
  "task.listArchived": read.taskArchivedList,
  "task.listCurrentContext": read.taskCurrentContextList,
  "task.get": read.taskGet,
  "task.update": mutate.taskUpdate,
  "task.setRecurrence": recurrence.taskSetRecurrence,
  "task.updateRecurrence": recurrence.taskUpdateRecurrence,
  "task.deleteRecurrence": recurrence.taskDeleteRecurrence,
  "task.complete": mutate.taskComplete,
  "task.uncomplete": mutate.taskUncomplete,
  "task.archive": mutate.taskArchive,
  "task.restore": mutate.taskRestore,
  "task.delete": mutate.taskDelete,
  "task.addTime": mutate.taskAddTime,
  "task.reorder": mutate.taskReorder,
  "task.reorderTasks": mutate.taskReorder,
  "task.start": mutate.taskStart,
  "task.stop": mutate.taskStop,
  "task.current": mutate.taskCurrent,
  "task.bulkComplete": mutate.taskBulkComplete,
  "task.bulkUpdate": mutate.taskBulkUpdate,
  "task.bulkReschedule": mutate.taskBulkReschedule,
  "task.clearScheduleForDay": schedule.taskClearScheduleForDay,
  "task.scheduleHealth": schedule.taskScheduleHealth,
  "task.scheduleRange": schedule.taskScheduleRange,
  "task.findStaleSchedule": schedule.taskFindStaleSchedule,
  "task.findUnscheduledActive": schedule.taskFindUnscheduledActive,
  "task.makePlannedAt": schedule.taskMakePlannedAt,
  "task.autoSchedule": schedule.taskAutoSchedule,
  "task.compactNotes": schedule.taskCompactNotes,
  "task.planToday": mutate.taskPlanToday,
  "task.addTag": organize.taskAddTag,
  "task.removeTag": organize.taskRemoveTag,
  "task.moveToProject": organize.taskMoveToProject,
  "task.worklog": mutate.taskWorklog,
};

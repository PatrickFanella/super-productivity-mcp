// Standalone notes (project notes and notes pinned to Today) read from the
// plugin's app state. The MCP server reads Local REST /notes instead when it
// is configured, and only lets these tools run with the read and notes
// scopes. Mirrors noteView in internal/bridge/notes.go.
const { typedError } = require("../errors");

function noteView(note) {
  const out = {
    id: note.id,
    content: note.content,
    projectId: note.projectId ?? null,
    isPinnedToToday: note.isPinnedToToday === true,
  };
  if (note.created !== undefined) out.created = note.created;
  if (note.modified !== undefined) out.modified = note.modified;
  return out;
}

async function readNotes() {
  if (typeof PluginAPI.getAppState !== "function") {
    throw typedError("UNSUPPORTED_ACTION", "Reading notes needs Local REST or PluginAPI.getAppState, which this Super Productivity runtime lacks", false);
  }
  const state = await PluginAPI.getAppState();
  return Object.values((state && state.notes) || {}).filter(Boolean);
}

module.exports = {
  "note.list": async (payload) => {
    const projectId = payload?.projectId || payload?.project_id;
    const notes = (await readNotes())
      .filter((note) => !projectId || note.projectId === projectId)
      .filter((note) => payload?.pinnedToToday !== true || note.isPinnedToToday === true);
    return { notes: notes.map(noteView), via: "plugin" };
  },
  "note.get": async (payload) => {
    const id = payload?.noteId || payload?.note_id || payload?.id;
    if (!id) throw typedError("INVALID_REQUEST", "noteId is required", false);
    const note = (await readNotes()).find((candidate) => candidate.id === id);
    if (!note) throw typedError("NOTE_NOT_FOUND", `Note ${id} not found`, false);
    return { note: noteView(note), via: "plugin" };
  },
};

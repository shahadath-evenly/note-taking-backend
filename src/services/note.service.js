const ApiError = require('../utils/ApiError');
const noteRepository = require('../repositories/note.repository');
const { buildListQuery, buildPaginationMeta } = require('../utils/pagination');
const { NOTE_SORT_FIELDS } = require('../constants/sortFields');

const SEARCHABLE_FIELDS = ['title', 'content'];
const DEFAULT_SORT = { createdAt: -1, _id: -1 };

async function listNotes(userId, query) {
  const { page, limit, skip, sort, searchFilter } = buildListQuery(query, {
    allowedSortFields: NOTE_SORT_FIELDS,
    defaultSort: DEFAULT_SORT,
    searchableFields: SEARCHABLE_FIELDS,
  });

  const filter = { userId, ...(searchFilter || {}) };

  const [docs, total] = await Promise.all([
    noteRepository.findMany({ filter, sort, skip, limit }),
    noteRepository.count(filter),
  ]);

  return {
    notes: docs.map((doc) => doc.toJSON()),
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

async function createNote(userId, data) {
  const note = await noteRepository.create({ ...data, userId });
  return note.toJSON();
}

async function getNote(userId, id) {
  const note = await noteRepository.findOneOwned(id, userId);
  if (!note) {
    throw ApiError.notFound('Note not found');
  }
  return note.toJSON();
}

async function updateNote(userId, id, data) {
  const note = await noteRepository.updateOneOwned(id, userId, data);
  if (!note) {
    throw ApiError.notFound('Note not found');
  }
  return note.toJSON();
}

async function deleteNote(userId, id) {
  const note = await noteRepository.deleteOneOwned(id, userId);
  if (!note) {
    throw ApiError.notFound('Note not found');
  }
}

module.exports = { listNotes, createNote, getNote, updateNote, deleteNote };

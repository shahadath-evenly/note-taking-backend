const noteRepository = require('../repositories/note.repository');
const { buildListQuery, buildPaginationMeta } = require('../utils/pagination');
const { NOTE_SORT_FIELDS } = require('../constants/sortFields');

const SEARCHABLE_FIELDS = ['title', 'content'];
const DEFAULT_SORT = { createdAt: -1, _id: -1 };

// Reshapes a populated note into { ...note, userId: <id>, owner: {...} } so
// `userId` always stays a plain id (consistent with every other note
// response), and the joined owner summary is its own clearly-named field.
function toSafeNoteWithOwner(doc) {
  const { userId, ...note } = doc.toJSON();
  const owner = userId && typeof userId === 'object' ? userId : null;

  return {
    ...note,
    userId: owner ? owner._id : userId,
    owner: owner ? { _id: owner._id, firstName: owner.firstName, lastName: owner.lastName, email: owner.email } : null,
  };
}

async function listAllNotes(query) {
  const { page, limit, skip, sort, searchFilter } = buildListQuery(query, {
    allowedSortFields: NOTE_SORT_FIELDS,
    defaultSort: DEFAULT_SORT,
    searchableFields: SEARCHABLE_FIELDS,
  });

  const filter = searchFilter || {};

  const [docs, total] = await Promise.all([
    noteRepository.findManyWithOwner({ filter, sort, skip, limit }),
    noteRepository.count(filter),
  ]);

  return {
    notes: docs.map(toSafeNoteWithOwner),
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

module.exports = { listAllNotes };

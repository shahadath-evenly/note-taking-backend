const postRepository = require('../repositories/post.repository');
const { buildListQuery, buildPaginationMeta } = require('../utils/pagination');
const { POST_SORT_FIELDS } = require('../constants/sortFields');

const SEARCHABLE_FIELDS = ['title', 'content'];
const DEFAULT_SORT = { createdAt: -1, _id: -1 };

async function listPosts(query) {
  const { page, limit, skip, sort, searchFilter } = buildListQuery(query, {
    allowedSortFields: POST_SORT_FIELDS,
    defaultSort: DEFAULT_SORT,
    searchableFields: SEARCHABLE_FIELDS,
  });

  const filter = searchFilter || {};

  const [docs, total] = await Promise.all([
    postRepository.findMany({ filter, sort, skip, limit }),
    postRepository.count(filter),
  ]);

  return {
    posts: docs.map((doc) => doc.toJSON()),
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

async function createPost(userId, data) {
  const post = await postRepository.create({ ...data, userId });
  return post.toJSON();
}

module.exports = { listPosts, createPost };

const userRepository = require('../repositories/user.repository');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

async function groupUsersByInterests(query) {
  const { page, limit, skip } = parsePagination(query);

  const [result] = await userRepository.groupByInterests({ skip, limit });

  const groups = (result && result.data) || [];
  const total = (result && result.totalCount[0] && result.totalCount[0].count) || 0;

  return {
    groups,
    pagination: buildPaginationMeta({ page, limit, total }),
  };
}

module.exports = { groupUsersByInterests };

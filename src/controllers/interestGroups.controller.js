const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const interestGroupService = require('../services/interestGroup.service');

const getGroupedByInterests = asyncHandler(async (req, res) => {
  const { groups, pagination } = await interestGroupService.groupUsersByInterests(req.query);
  new ApiResponse(200, 'Records retrieved successfully', groups, pagination).send(res);
});

module.exports = { getGroupedByInterests };

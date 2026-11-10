class ApiResponse {
  constructor(statusCode = 200, message = 'Request completed successfully', data = null, pagination) {
    this.statusCode = statusCode;
    this.success = true;
    this.message = message;
    this.data = data;
    if (pagination) {
      this.pagination = pagination;
    }
  }

  send(res) {
    const { statusCode, ...body } = this;
    return res.status(statusCode).json(body);
  }
}

module.exports = ApiResponse;

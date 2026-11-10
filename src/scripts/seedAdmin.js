const config = require('../config/env');
const { connectDB, disconnectDB } = require('../config/database');
const User = require('../models/User');
const { ROLES } = require('../constants/roles');

async function run() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, ADMIN_LAST_NAME } = process.env;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !ADMIN_FIRST_NAME || !ADMIN_LAST_NAME) {
    console.error(
      'Admin bootstrap requires ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_FIRST_NAME, and ADMIN_LAST_NAME to be set.'
    );
    process.exitCode = 1;
    return;
  }

  await connectDB(config.mongoUri);

  const email = ADMIN_EMAIL.trim().toLowerCase();
  const existing = await User.findOne({ email });

  if (existing) {
    console.log(`Admin bootstrap skipped: a user with email ${email} already exists.`);
  } else {
    await User.create({
      firstName: ADMIN_FIRST_NAME,
      lastName: ADMIN_LAST_NAME,
      email,
      password: ADMIN_PASSWORD,
      role: ROLES.ADMIN,
    });
    console.log(`Admin user created: ${email}`);
  }

  await disconnectDB();
}

run().catch((error) => {
  console.error(`Admin bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});

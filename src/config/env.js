require('dotenv').config();
const yup = require('yup');

const envSchema = yup.object({
  NODE_ENV: yup
    .string()
    .oneOf(['development', 'test', 'production'])
    .default('development'),
  PORT: yup.number().integer().positive().default(5001),
  MONGO_URI: yup.string().required('MONGO_URI is required'),
  CORS_ORIGIN: yup.string().required('CORS_ORIGIN is required'),
  BODY_LIMIT: yup.string().default('100kb'),
});

let validatedEnv;

try {
  validatedEnv = envSchema.validateSync(process.env, {
    abortEarly: false,
    stripUnknown: true,
  });
} catch (error) {
  const details = error.errors ? error.errors.join('; ') : error.message;
  console.error(`Invalid environment configuration: ${details}`);
  process.exit(1);
}

const config = Object.freeze({
  nodeEnv: validatedEnv.NODE_ENV,
  port: validatedEnv.PORT,
  mongoUri: validatedEnv.MONGO_URI,
  corsOrigin: validatedEnv.CORS_ORIGIN,
  bodyLimit: validatedEnv.BODY_LIMIT,
});

module.exports = config;

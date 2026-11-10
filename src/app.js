const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const config = require("./config/env");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const adminUsersRoutes = require("./routes/adminUsers.routes");
const adminNotesRoutes = require("./routes/adminNotes.routes");
const notesRoutes = require("./routes/notes.routes");
const userPostsRoutes = require("./routes/userPosts.routes");
const postsRoutes = require("./routes/posts.routes");
const notFound = require("./middlewares/notFound");
const errorHandler = require("./middlewares/errorHandler");

const app = express();

app.use(helmet());
// Open to any origin: auth is a bearer JWT in the Authorization header, not a
// cookie, so there's no session to leak cross-origin — `credentials: true`
// is deliberately omitted since it's both unused and incompatible with a
// wildcard origin (browsers reject that combination outright).
app.use(cors());
app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

app.use("/health", healthRoutes);
app.use("/api/auth", authRoutes);

app.use("/api/admin/users", adminUsersRoutes);
app.use("/api/admin/notes", adminNotesRoutes);
app.use("/api/notes", notesRoutes);
app.use("/api/users", userPostsRoutes);
app.use("/api/posts", postsRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;

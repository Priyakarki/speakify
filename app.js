const express = require("express");
const dotenv = require("dotenv");
const authRoutes = require("./routes/authroute");

const connectDB = require("./config/db");

const storyroutes = require("./routes/storyroute");
const progressRoutes = require("./routes/progressroute");
const speakingRoutes = require("./routes/speakingroute");
const aiRoutes = require("./routes/airoute");
const ReadingProgress = require("./models/readingprogressmodel");

dotenv.config();

const app = express();

app.use(express.json());
app.use("/api/stories", storyroutes);
app.use("/api/auth", authRoutes);
app.use("/api/progress", progressRoutes);
app.use("/api/speaking", speakingRoutes);
app.use("/api/ai", aiRoutes);

// The unique { user, story } index can't be built while old duplicate
// progress records exist. The API already prevents new duplicates, and
// "npm run fix:progress" cleans up the old ones.
ReadingProgress.on("index", (error) => {
    if (error) {
        console.warn(
            "ReadingProgress unique index not created (duplicate records exist). Run: npm run fix:progress"
        );
    }
});

connectDB();

app.get("/", (req, res) => {
    res.send("BoloBuddy backend is working!");
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});